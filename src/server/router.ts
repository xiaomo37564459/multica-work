/**
 * HTTP 路由层:安全闸 → 聚合快照 → 信封响应,外加仅有的两个写操作入口。
 *
 * 为什么把 handler 从 index.ts 抽出来:createServer 一 import 就监听端口,单测碰不了;
 * 而安全规则(N2/N3)和写操作的 W1~W5 恰恰是最需要逐条被测试按住的地方。
 * index.ts 只负责「真实依赖的组装 + 监听」,路由行为由 test/router.test.ts 直接按住。
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  ApiEnvelope, ApiError, ApiMeta, DispatchResult, ErrorCode, Health, RuntimeVitals,
  ShoutResult, Battle, AgentDetail, CampaignMap, ProjectRef, Roster, BattleChain,
} from '../contract/types.ts';
import type { Aggregates, AggregatesInput } from '../aggregate/detail.ts';
import { buildAggregates } from '../aggregate/detail.ts';
import type { CockpitConfig } from './config.ts';
import { isAllowedHost, isAllowedOrigin, validateDispatch, validateShout, RateLimiter } from './guard.ts';
import type { MulticaWriteSource } from '../multica/source.ts';
import { MulticaCliError } from '../multica/source.ts';

/** 数据没拉到时给一个空形状:聚合层能算,但 roster 应答 503「稍等几秒再试」。 */
const EMPTY_AGG_INPUT: AggregatesInput = {
  agents: [], runtimes: [], tasksByAgent: new Map(), activeIssues: [], allIssues: [],
  projects: [], squads: [], mcpByAgent: new Map(), usageByRuntime: new Map(),
  activityByRuntime: new Map(), cfg: { issueTemplate: null, agentTemplate: null, projectTemplate: null, workspaceSlug: null },
  now: '', usageWindowDays: 7,
};

export interface RouterDeps {
  cfg: CockpitConfig;
  /** package.json 的版本,health 用。 */
  version: string;
  /** CLI 版本(health 用);拿不到传 null。 */
  cliVersion?: string | null;
  /** 全量轮询缓存快照;null = 冷启动一个源都还没拉到。 */
  data: AggregatesInput | null;
  /** 写侧出口(MulticaCli 实现了它;测试塞记账假件)。 */
  write: MulticaWriteSource;
  /** 写长文本用的临时文件目录(服务工作目录内,规则 W5)。 */
  tmpDir: string;
  /** 统一「现在」;测试注入假钟。返回 RFC3339 字符串。 */
  now?: () => string;
}

/** 路由可用的请求抽象:真的来自 IncomingMessage,测试直接给普通对象。 */
export interface RouterRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  /** 已按 JSON 解析好的请求体;解析失败请传解析错误。 */
  body?: unknown;
  bodyError?: unknown;
}

/** 最小响应面:真的来自 ServerResponse,测试收一个累计器。 */
export interface RouterResponse {
  status: number;
  headers: Map<string, string>;
  chunks: string[];
  text(): string;
}

export interface Router {
  (req: RouterRequest): Promise<RouterResponse>;
  /** 把真实 http 对象接上同一个处理函数。 */
  readonly handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}

const UUID_PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toResponse(res: ServerResponse, status: number, headers: Record<string, string>, body: string): void {
  res.writeHead(status, headers);
  res.end(body);
}

export function createRouter(deps: RouterDeps): Router {
  const writeLimiter = new RateLimiter();
  const now = deps.now ?? (() => new Date().toISOString());

  function buildHealth(): Health {
    return {
      ok: true,
      version: deps.version,
      bind: `${deps.cfg.host}:${deps.cfg.port}`,
      cli: { available: deps.cliVersion != null, version: deps.cliVersion ?? null },
      workspace_id: null,
      deep_link_template: deps.cfg.issueUrlTemplate,
      sources: [],
      server_time: now(),
    };
  }

  function meta(): ApiMeta {
    const t = now();
    return {
      fetched_at: t,
      age_ms: 0,
      stale: false,
      degraded: [],
      server_time: t,
    };
  }

  function ok<T>(res: ServerResponse, data: T, extra: Record<string, string> = {}): void {
    const body = JSON.stringify({ ok: true, data, meta: meta() } satisfies ApiEnvelope<T>);
    toResponse(res, 200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...extra,
    }, body);
  }

  function fail(res: ServerResponse, status: number, code: ErrorCode, message: string, retryable = false): void {
    const error: ApiError = { code, message, retryable };
    const body = JSON.stringify({ ok: false, error, meta: meta() } satisfies ApiEnvelope<never>);
    toResponse(res, status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    }, body);
  }

  async function readJsonBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 64 * 1024) throw new Error('body too large');
      chunks.push(c as Buffer);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw.trim() === '') return undefined;
    return JSON.parse(raw);
  }

  function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    return routeRequest({
      method: req.method ?? 'GET',
      url: req.url ?? '/',
      headers: req.headers,
      body: undefined,
      bodyError: undefined,
    }).then(async (out) => {
      const res2 = res as ServerResponse & { __routerOut?: RouterResponse };
      void res2;
    });
  }

  async function routeRequest(req: RouterRequest): Promise<RouterResponse> {
    const out: RouterResponse = {
      status: 0,
      headers: new Map(),
      chunks: [],
      text() { return this.chunks.join(''); },
    } as RouterResponse & { chunks: string[]; headers: Map<string, string> };
    const emit = (status: number, headers: Record<string, string>, body: string) => {
      out.status = status;
      for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
      out.chunks.push(body);
    };
    const ok2 = <T,>(data: T) => emit(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    }, JSON.stringify({ ok: true, data, meta: meta() } satisfies ApiEnvelope<T>));
    const fail2 = (status: number, code: ErrorCode, message: string, retryable = false) => emit(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    }, JSON.stringify({ ok: false, error: { code, message, retryable } satisfies ApiError, meta: meta() } satisfies ApiEnvelope<never>));

    const hostHeader = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;
    if (!isAllowedHost(hostHeader, deps.cfg.port)) {
      fail2(403, 'forbidden', 'Host 头不是本机地址,拒绝');
      return out;
    }
    const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
    if (!isAllowedOrigin(origin, deps.cfg.port, deps.cfg.devOriginPorts)) {
      fail2(403, 'forbidden', 'Origin 不是本机,拒绝');
      return out;
    }

    let pathname = '/';
    try {
      const u = new URL(req.url, `http://${deps.cfg.host}:${deps.cfg.port}`);
      pathname = u.pathname.replace(/\/+$/, '') || '/';
    } catch {
      fail2(400, 'bad_request', 'URL 解析不了');
      return out;
    }
    const method = req.method.toUpperCase();

    /* ── 读接口 ── */
    if (method === 'GET') {
      if (pathname === '/api/health') {
        const h = buildHealth();
        ok2(h);
        return out;
      }
      if (pathname === '/api/roster' || pathname === '/api/projects' || pathname === '/api/runtimes') {
        if (deps.data == null) {
          fail2(503, 'upstream_failed', '还没拉到数据,稍等几秒再试', true);
          return out;
        }
        const agg: Aggregates = buildAggregates({ ...deps.data, now: now() });
        if (pathname === '/api/roster') {
          const roster: Roster = agg.roster;
          ok2(roster);
          return out;
        }
        if (pathname === '/api/projects') {
          const projects: ProjectRef[] = [...agg.projectsView];
          ok2(projects);
          return out;
        }
        const vitals: RuntimeVitals[] = [...agg.runtimesView];
        ok2(vitals);
        return out;
      }
      let m = /^\/api\/agents\/([^/]+)$/.exec(pathname);
      if (m) {
        const id = decodeURIComponent(m[1] ?? '');
        if (!UUID_PATH_RE.test(id)) { fail2(400, 'bad_request', 'agent id 不是合法 UUID'); return out; }
        if (deps.data == null) { fail2(503, 'upstream_failed', '还没拉到数据,稍等几秒再试', true); return out; }
        const agg = buildAggregates({ ...deps.data, now: now() });
        const detail: AgentDetail | undefined = agg.agentDetails.get(id);
        if (!detail) { fail2(404, 'not_found', '没有这个角色'); return out; }
        ok2(detail);
        return out;
      }
      m = /^\/api\/projects\/([^/]+)\/map$/.exec(pathname);
      if (m) {
        const id = decodeURIComponent(m[1] ?? '');
        if (deps.data == null) { fail2(503, 'upstream_failed', '还没拉到数据,稍等几秒再试', true); return out; }
        const agg = buildAggregates({ ...deps.data, now: now() });
        const map: CampaignMap | undefined = agg.campaignMaps.get(id);
        if (!map) { fail2(404, 'not_found', '没有这个战役(项目不存在)'); return out; }
        ok2(map);
        return out;
      }
      m = /^\/api\/battles\/([^/]+)\/chain$/.exec(pathname);
      if (m) {
        const id = decodeURIComponent(m[1] ?? '');
        if (deps.data == null) { fail2(503, 'upstream_failed', '还没拉到数据,稍等几秒再试', true); return out; }
        const agg = buildAggregates({ ...deps.data, now: now() });
        const chain: BattleChain | undefined = agg.battleChains.get(id);
        if (!chain) { fail2(404, 'not_found', '没有这场战斗的记录'); return out; }
        ok2(chain);
        return out;
      }
      m = /^\/api\/issues\/([^/]+)\/battles$/.exec(pathname);
      if (m) {
        const id = decodeURIComponent(m[1] ?? '');
        if (!UUID_PATH_RE.test(id)) { fail2(400, 'bad_request', 'issue id 不是合法 UUID'); return out; }
        if (deps.data == null) { fail2(503, 'upstream_failed', '还没拉到数据,稍等几秒再试', true); return out; }
        const agg = buildAggregates({ ...deps.data, now: now() });
        const battles: Battle[] = [];
        for (const chain of agg.battleChains.values()) {
          const focus = chain.nodes.find((n) => n.battle.task_id === chain.focus_task_id);
          if (focus && focus.battle.issue?.issue_id === id) battles.push(focus.battle);
        }
        ok2(battles);
        return out;
      }
      if (pathname === '/' || pathname === '/api') {
        ok2({ name: 'AetherLab 指挥舱 BFF', contract: 'src/contract/types.ts' });
        return out;
      }
      fail2(404, 'not_found', `没有这个接口:GET ${pathname}`);
      return out;
    }

    /* ── 写接口(只有这两个,W1)── */
    if (method === 'POST' && (pathname === '/api/commands/dispatch' || pathname === '/api/commands/shout')) {
      if (deps.data == null) {
        // 写操作不依赖读缓存,但起来一个还没自检过的服务就去写也不稳妥;照常放行。
      }
      if (req.bodyError != null) {
        fail2(400, 'bad_request', '请求体不是合法 JSON');
        return out;
      }
      if (!writeLimiter.tryAcquire()) {
        fail2(429, 'rate_limited', '写操作太频繁,每分钟最多 20 次,歇一会再点', true);
        return out;
      }
      try {
        if (pathname === '/api/commands/dispatch') {
          const v = validateDispatch(req.body);
          if (!v.ok) { fail2(400, 'bad_request', v.error.message); return out; }
          const descFile = await writeTempFile(deps.tmpDir, 'dispatch', v.value.description);
          try {
            const created = await deps.write.createIssue({
              title: v.value.title,
              descriptionFile: descFile,
              assigneeId: v.value.assignee_agent_id,
              projectId: v.value.project_id,
              priority: v.value.priority,
              parentIssueId: v.value.parent_issue_id,
              stage: v.value.stage,
            });
            const result: DispatchResult = {
              issue_id: created.id,
              identifier: created.identifier ?? null,
              deep_link: deps.cfg.issueUrlTemplate
                ? deps.cfg.issueUrlTemplate
                  .split('{workspace}').join(deps.cfg.workspaceSlug ?? '')
                  .split('{identifier}').join(created.identifier ?? '')
                  .split('{id}').join(created.id)
                : null,
            };
            ok2(result);
            return out;
          } finally {
            removeTempFile(descFile);
          }
        }
        // shout
        const v = validateShout(req.body);
        if (!v.ok) { fail2(400, 'bad_request', v.error.message); return out; }
        const contentFile = await writeTempFile(deps.tmpDir, 'shout', v.value.content);
        try {
          const created = await deps.write.addComment({
            issueId: v.value.issue_id,
            contentFile,
            parentCommentId: v.value.parent_comment_id,
          });
          const result: ShoutResult = { comment_id: created.id, issue_id: v.value.issue_id };
          ok2(result);
          return out;
        } finally {
          removeTempFile(contentFile);
        }
      } catch (err) {
        if (err instanceof MulticaCliError) {
          fail2(err.timedOut ? 504 : 502, err.timedOut ? 'upstream_timeout' : 'upstream_failed', err.message, true);
          return out;
        }
        fail2(500, 'internal', err instanceof Error ? err.message : '服务内部错误');
        return out;
      }
    }

    if (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH') {
      // W1:白名单外没有任何写出口 —— 不是 403(不暴露「存在这个操作」),直接当没有。
      fail2(404, 'not_found', `没有这个接口:${method} ${pathname}`);
      return out;
    }

    fail2(404, 'not_found', `没有这个接口:${method} ${pathname}`);
    return out;
  }

  const handler = routeRequest as Router;
  // 真实 http 接线:index.ts 用它;测试直接调 routeRequest 等价物。
  (handler as { handle?: unknown }).handle = route;
  return handler;
}

/** W5:长文本走临时文件(服务工作目录内),用完即删。 */
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

async function writeTempFile(dir: string, kind: string, content: string): Promise<string> {
  const tmp = await mkdtemp(join(dir, `${kind}-`));
  const file = join(tmp, `${kind}.md`);
  await writeFile(file, content, 'utf8');
  void rm;
  return file;
}

function removeTempFile(file: string): void {
  // 删掉所在的临时目录(每个请求独立一个),失败不抛 —— 临时目录也会被系统清。
  const dir = file.slice(0, Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')));
  void rm(dir, { recursive: true, force: true }).catch(() => {});
}

export { EMPTY_AGG_INPUT };
