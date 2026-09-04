/**
 * 数据源边界:**整个服务只有这一个文件可以碰 multica CLI,也只有它可以出网。**
 *
 * 为什么划这条线:
 *   1. 出网口只有一个,安全边界(docs/security.md)才审得动 —— 白名单、超时、并发闸全在这里。
 *   2. 以后要换传输(比如直接打 HTTP API 省掉每次 57ms 的进程启动),只换这个文件的实现,
 *      MulticaSource 接口不动,aggregate/ 和 server/ 一行都不用改。
 *
 * 硬规矩:
 *   - 永远用 execFile + argv 数组,**永远不用 shell、不拼命令字符串**。
 *   - 参数全部经过 assertSafeArg:不允许以 `-` 开头(防参数注入),不允许控制字符。
 *   - 服务自己**从不接触凭据**。multica CLI 读它自己的配置,token 不进程序内存、不进日志。
 */

import { execFile } from 'node:child_process';
import type {
  RawAgent, RawAgentMcp, RawTask, RawIssue, RawIssueListResponse, RawIssueChildren,
  RawProject, RawSquad, RawRuntime, RawRuntimeUsage, RawRuntimeActivity,
  RawCreatedIssue, RawCreatedComment,
} from './raw.ts';

/** CLI 单次调用超时。实测最慢一次是 2.4s(agent tasks / 356 条历史),留 6 倍余量。 */
export const CLI_TIMEOUT_MS = 15_000;

/** issue list 的服务端硬上限。传更大会被静默截断,别指望一次拉完。 */
export const ISSUE_PAGE_SIZE = 100;

export class MulticaCliError extends Error {
  readonly argv: readonly string[];
  readonly timedOut: boolean;

  constructor(message: string, argv: readonly string[], timedOut: boolean) {
    super(message);
    this.name = 'MulticaCliError';
    this.argv = argv;
    this.timedOut = timedOut;
  }
}

/**
 * 参数安全闸。
 * 以 `-` 开头的值会被 CLI 当成 flag —— 那就等于让调用方任意追加参数,必须挡死。
 */
export function assertSafeArg(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new MulticaCliError(`${label} 不能为空`, [], false);
  }
  if (value.startsWith('-')) {
    throw new MulticaCliError(`${label} 不允许以 - 开头(会被当成命令行参数)`, [], false);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new MulticaCliError(`${label} 含控制字符`, [], false);
  }
  return value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, label: string): string {
  assertSafeArg(value, label);
  if (!UUID_RE.test(value)) {
    throw new MulticaCliError(`${label} 不是合法 UUID`, [], false);
  }
  return value.toLowerCase();
}

/**
 * 读侧数据源。aggregate/ 只认这个接口。
 * 一期只用得到这些方法;要加方法先在 MTM-275 上说一声,因为每加一个都是一个出网口。
 */
export interface MulticaSource {
  version(): Promise<string>;
  agentList(): Promise<RawAgent[]>;
  agentMcp(agentId: string): Promise<RawAgentMcp[]>;
  agentTasks(agentId: string): Promise<RawTask[]>;
  issuesByStatus(status: string): Promise<RawIssue[]>;
  issuesPage(offset: number): Promise<RawIssueListResponse>;
  issuesByProject(projectId: string): Promise<RawIssue[]>;
  issueChildren(issueId: string): Promise<RawIssueChildren>;
  projectList(): Promise<RawProject[]>;
  squadList(): Promise<RawSquad[]>;
  runtimeList(): Promise<RawRuntime[]>;
  runtimeUsage(runtimeId: string, days: number): Promise<RawRuntimeUsage[]>;
  runtimeActivity(runtimeId: string): Promise<RawRuntimeActivity[]>;
}

/** 写侧。**只有这两个方法,不许再加。** 见 docs/security.md 规则 W1。 */
export interface MulticaWriteSource {
  createIssue(input: {
    title: string;
    descriptionFile: string;
    assigneeId: string;
    projectId?: string | null;
    priority?: string | null;
    parentIssueId?: string | null;
    stage?: number | null;
  }): Promise<RawCreatedIssue>;
  addComment(input: {
    issueId: string;
    contentFile: string;
    parentCommentId?: string | null;
  }): Promise<RawCreatedComment>;
}

/**
 * 全局并发闸。
 * 定 4 是实测结论:26 次调用从并发 4 提到 12 只快了 22%(6.4s → 5.0s),
 * 而 16 并发开始抖(出现过 9.2s)。指挥舱还得和 heory 本机上真在干活的智能体抢资源,
 * 所以宁可慢一点也不要把 CLI 打爆。
 */
export const DEFAULT_MAX_CONCURRENCY = 4;

class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

export interface CliOptions {
  binary?: string;
  timeoutMs?: number;
  maxConcurrency?: number;
  /** 调试用:把每次调用的 argv 和耗时打出来。**永远不打输出内容**(里面有 issue 正文)。 */
  onCall?: (argv: readonly string[], ms: number, ok: boolean) => void;
}

export class MulticaCli implements MulticaSource, MulticaWriteSource {
  private readonly binary: string;
  private readonly timeoutMs: number;
  private readonly gate: Semaphore;
  private readonly onCall: CliOptions['onCall'];

  constructor(opts: CliOptions = {}) {
    this.binary = opts.binary ?? 'multica';
    this.timeoutMs = opts.timeoutMs ?? CLI_TIMEOUT_MS;
    this.gate = new Semaphore(opts.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
    this.onCall = opts.onCall;
  }

  private exec(argv: string[]): Promise<string> {
    return this.gate.run(
      () =>
        new Promise<string>((resolve, reject) => {
          const started = Date.now();
          execFile(
            this.binary,
            argv,
            {
              // 32MB:实测单次最大返回是 agent tasks 的 1.28MB,但历史会长,留足。
              maxBuffer: 32 * 1024 * 1024,
              timeout: this.timeoutMs,
              windowsHide: true,
              // 明确不走 shell —— 这是整条链最重要的一行。
              shell: false,
              encoding: 'utf8',
            },
            (err, stdout, stderr) => {
              const ms = Date.now() - started;
              if (err) {
                this.onCall?.(argv, ms, false);
                const timedOut = (err as NodeJS.ErrnoException).code === 'ETIMEDOUT'
                  || /killed/i.test(String((err as { signal?: string }).signal ?? ''));
                // stderr 可能带上下文,但也可能带 issue 正文片段,截断后再抛。
                const detail = String(stderr ?? '').trim().slice(0, 400);
                reject(new MulticaCliError(
                  `multica ${argv[0] ?? ''} ${argv[1] ?? ''} 调用失败${timedOut ? '(超时)' : ''}${detail ? `: ${detail}` : ''}`,
                  argv,
                  timedOut,
                ));
                return;
              }
              this.onCall?.(argv, ms, true);
              resolve(stdout);
            },
          );
        }),
    );
  }

  private async json<T>(argv: string[]): Promise<T> {
    const out = await this.exec(argv);
    try {
      return JSON.parse(out) as T;
    } catch {
      throw new MulticaCliError(`multica ${argv.join(' ')} 返回的不是合法 JSON`, argv, false);
    }
  }

  version(): Promise<string> {
    return this.exec(['version']).then((s) => s.trim().split('\n')[0] ?? '');
  }

  agentList(): Promise<RawAgent[]> {
    return this.json(['agent', 'list', '--output', 'json']);
  }

  agentMcp(agentId: string): Promise<RawAgentMcp[]> {
    return this.json(['agent', 'mcp', 'list', assertUuid(agentId, 'agent_id'), '--output', 'json']);
  }

  agentTasks(agentId: string): Promise<RawTask[]> {
    return this.json(['agent', 'tasks', assertUuid(agentId, 'agent_id'), '--output', 'json']);
  }

  async issuesByStatus(status: string): Promise<RawIssue[]> {
    const res = await this.json<RawIssueListResponse>([
      'issue', 'list', '--status', assertSafeArg(status, 'status'),
      '--limit', String(ISSUE_PAGE_SIZE), '--output', 'json',
    ]);
    return res.issues ?? [];
  }

  issuesPage(offset: number): Promise<RawIssueListResponse> {
    if (!Number.isInteger(offset) || offset < 0) {
      throw new MulticaCliError('offset 必须是非负整数', [], false);
    }
    return this.json([
      'issue', 'list', '--limit', String(ISSUE_PAGE_SIZE),
      '--offset', String(offset), '--output', 'json',
    ]);
  }

  async issuesByProject(projectId: string): Promise<RawIssue[]> {
    const res = await this.json<RawIssueListResponse>([
      'issue', 'list', '--project', assertUuid(projectId, 'project_id'),
      '--limit', String(ISSUE_PAGE_SIZE), '--output', 'json',
    ]);
    return res.issues ?? [];
  }

  issueChildren(issueId: string): Promise<RawIssueChildren> {
    return this.json(['issue', 'children', assertUuid(issueId, 'issue_id'), '--output', 'json']);
  }

  projectList(): Promise<RawProject[]> {
    return this.json(['project', 'list', '--output', 'json']);
  }

  squadList(): Promise<RawSquad[]> {
    return this.json(['squad', 'list', '--output', 'json']);
  }

  runtimeList(): Promise<RawRuntime[]> {
    return this.json(['runtime', 'list', '--output', 'json']);
  }

  runtimeUsage(runtimeId: string, days: number): Promise<RawRuntimeUsage[]> {
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new MulticaCliError('days 必须是 1..365 的整数', [], false);
    }
    return this.json([
      'runtime', 'usage', assertUuid(runtimeId, 'runtime_id'),
      '--days', String(days), '--output', 'json',
    ]);
  }

  runtimeActivity(runtimeId: string): Promise<RawRuntimeActivity[]> {
    return this.json(['runtime', 'activity', assertUuid(runtimeId, 'runtime_id'), '--output', 'json']);
  }

  /* ── 写侧,只有两个 ── */

  createIssue(input: Parameters<MulticaWriteSource['createIssue']>[0]): Promise<RawCreatedIssue> {
    const argv = [
      'issue', 'create',
      '--title', assertSafeArg(input.title, 'title'),
      // 正文一律走文件:Windows 下管道会把非 ASCII 变成 ?,而 --description 会解转义序列。
      '--description-file', assertSafeArg(input.descriptionFile, 'description_file'),
      '--assignee-id', assertUuid(input.assigneeId, 'assignee_agent_id'),
      '--output', 'json',
    ];
    if (input.projectId) argv.push('--project', assertUuid(input.projectId, 'project_id'));
    if (input.priority) argv.push('--priority', assertSafeArg(input.priority, 'priority'));
    if (input.parentIssueId) argv.push('--parent', assertUuid(input.parentIssueId, 'parent_issue_id'));
    if (input.stage != null) {
      if (!Number.isInteger(input.stage) || input.stage < 1) {
        throw new MulticaCliError('stage 必须是 >=1 的整数', [], false);
      }
      argv.push('--stage', String(input.stage));
    }
    return this.json(argv);
  }

  addComment(input: Parameters<MulticaWriteSource['addComment']>[0]): Promise<RawCreatedComment> {
    const argv = [
      'issue', 'comment', 'add', assertUuid(input.issueId, 'issue_id'),
      '--content-file', assertSafeArg(input.contentFile, 'content_file'),
      '--output', 'json',
    ];
    if (input.parentCommentId) {
      argv.push('--parent', assertUuid(input.parentCommentId, 'parent_comment_id'));
    }
    return this.json(argv);
  }
}
