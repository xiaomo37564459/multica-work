/**
 * 本地安全边界的执行体。规则的人话版在 docs/security.md,这里是可运行的那一份。
 *
 * 威胁模型说白了就一句:**指挥舱手里握着能指挥全队的凭据。**
 * 它被人从外面碰到 = 任何人都能用 heory 的身份派活、发评论。所以:
 *   - 只监听 127.0.0.1(N1)
 *   - 校验 Host,挡 DNS rebinding(N2)
 *   - 不发 CORS 头 + 校验 Origin,挡浏览器里的恶意页面(N3)
 *   - 写操作只有两种,白名单硬编码(W1)
 *   - 写操作限流,挡住失控的循环(W2)
 */

import type { ApiError, DispatchRequest, ShoutRequest } from '../contract/types.ts';

export const LOOPBACK_HOST = '127.0.0.1';

/** N2:允许的 Host 头。带端口和不带端口两种写法都得认。 */
export function isAllowedHost(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;
  const allowed = new Set([
    `${LOOPBACK_HOST}:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
    LOOPBACK_HOST,
    'localhost',
  ]);
  return allowed.has(hostHeader.toLowerCase());
}

/**
 * N3:允许的 Origin。
 * 同源请求(直接开页面)通常不带 Origin,所以 undefined 放行;
 * 一旦带了 Origin 就必须是本机 —— 别的网站的 JS 打过来一律拒。
 */
export function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  if (origin == null) return true;
  const allowed = new Set([
    `http://${LOOPBACK_HOST}:${port}`,
    `http://localhost:${port}`,
    // 前端开发期 Vite 默认端口,只在 dev 模式下才该出现。
    'http://localhost:5173',
    `http://${LOOPBACK_HOST}:5173`,
  ]);
  return allowed.has(origin.toLowerCase());
}

/** W2:写操作限流。派活和喊话都是人手点出来的,每分钟 20 次绰绰有余,足够挡住失控循环。 */
export const WRITE_RATE_LIMIT = { max: 20, windowMs: 60_000 } as const;

export class RateLimiter {
  private hits: number[] = [];
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(
    max: number = WRITE_RATE_LIMIT.max,
    windowMs: number = WRITE_RATE_LIMIT.windowMs,
    now: () => number = Date.now,
  ) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** 允许则记一次并返回 true。 */
  tryAcquire(): boolean {
    const t = this.now();
    this.hits = this.hits.filter((h) => t - h < this.windowMs);
    if (this.hits.length >= this.max) return false;
    this.hits.push(t);
    return true;
  }
}

/* ────────────────────────────── 入参校验 ────────────────────────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LIMITS = {
  titleMax: 200,
  descriptionMax: 20_000,
  commentMax: 10_000,
} as const;

const PRIORITIES = new Set(['urgent', 'high', 'medium', 'low', 'none']);

export type Validated<T> = { ok: true; value: T } | { ok: false; error: ApiError };

function bad(message: string): { ok: false; error: ApiError } {
  return { ok: false, error: { code: 'bad_request', message, retryable: false } };
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** 派活入参。校验通过的结果可以直接交给 MulticaCli.createIssue。 */
export function validateDispatch(body: unknown): Validated<Required<DispatchRequest>> {
  if (typeof body !== 'object' || body === null) return bad('请求体必须是 JSON 对象');
  const b = body as Record<string, unknown>;

  const title = str(b.title)?.trim();
  if (!title) return bad('title 不能为空');
  if (title.length > LIMITS.titleMax) return bad(`title 超过 ${LIMITS.titleMax} 字`);
  // 标题会作为命令行参数传给 CLI,以 - 开头会被当成 flag。
  if (title.startsWith('-')) return bad('title 不能以 - 开头');

  const description = str(b.description) ?? '';
  if (description.length > LIMITS.descriptionMax) return bad(`description 超过 ${LIMITS.descriptionMax} 字`);

  const assignee = str(b.assignee_agent_id);
  if (!assignee || !UUID_RE.test(assignee)) return bad('assignee_agent_id 必须是合法 UUID');

  const projectId = str(b.project_id);
  if (projectId && !UUID_RE.test(projectId)) return bad('project_id 必须是合法 UUID');

  const parentId = str(b.parent_issue_id);
  if (parentId && !UUID_RE.test(parentId)) return bad('parent_issue_id 必须是合法 UUID');

  const priority = str(b.priority);
  if (priority && !PRIORITIES.has(priority)) return bad('priority 取值非法');

  let stage: number | null = null;
  if (b.stage != null) {
    if (typeof b.stage !== 'number' || !Number.isInteger(b.stage) || b.stage < 1) {
      return bad('stage 必须是 >=1 的整数');
    }
    stage = b.stage;
  }

  return {
    ok: true,
    value: {
      title,
      description,
      assignee_agent_id: assignee.toLowerCase(),
      project_id: projectId ? projectId.toLowerCase() : null,
      priority: (priority as Required<DispatchRequest>['priority']) ?? null,
      parent_issue_id: parentId ? parentId.toLowerCase() : null,
      stage,
    },
  };
}

/** 喊话入参。 */
export function validateShout(body: unknown): Validated<Required<ShoutRequest>> {
  if (typeof body !== 'object' || body === null) return bad('请求体必须是 JSON 对象');
  const b = body as Record<string, unknown>;

  const issueId = str(b.issue_id);
  if (!issueId || !UUID_RE.test(issueId)) return bad('issue_id 必须是合法 UUID');

  const content = str(b.content)?.trim();
  if (!content) return bad('content 不能为空');
  if (content.length > LIMITS.commentMax) return bad(`content 超过 ${LIMITS.commentMax} 字`);

  const parent = str(b.parent_comment_id);
  if (parent && !UUID_RE.test(parent)) return bad('parent_comment_id 必须是合法 UUID');

  return {
    ok: true,
    value: {
      issue_id: issueId.toLowerCase(),
      content,
      parent_comment_id: parent ? parent.toLowerCase() : null,
    },
  };
}

/**
 * W1:写操作白名单。
 * 服务对 Multica 的写权限**只有这两条**,而且是按名字查表,不是把路径拼进命令。
 * 想加第三条 → 改这个常量 + 过一次架构评审。这条是硬底线,理由见 docs/security.md。
 */
export const WRITE_ALLOWLIST = Object.freeze({
  dispatch: 'issue create',
  shout: 'issue comment add',
} as const);

export function isAllowedWrite(name: string): name is keyof typeof WRITE_ALLOWLIST {
  return Object.hasOwn(WRITE_ALLOWLIST, name);
}
