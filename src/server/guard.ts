/**
 * 本地安全边界的执行体。规则的人话版在 docs/security.md,这里是可运行的那一份。
 *
 * 威胁模型说白了就一句:**指挥舱手里握着能指挥全队的凭据。**
 * 它被人从外面碰到 = 任何人都能用 heory 的身份派活、发评论。所以:
 *   - 监听内网(heory 2026-09-11 拍板 C 案,MTM-274 评论区;想收回本机设 COCKPIT_HOST=127.0.0.1)(N1)
 *   - 校验 Host:回环 + RFC1918 内网放行,公网/域名一律拒,挡 DNS rebinding(N2)
 *   - 不发 CORS 头 + 校验 Origin,同上按内外网放行,挡浏览器里的恶意页面(N3)
 *   - 写操作只有两种,白名单硬编码(W1)
 *   - 写操作限流,挡住失控的循环(W2)
 *
 * 「内网开放」不等于「公网开放」:RFC1918 之外的一切(公网 IP、任何域名)仍然 403。
 * 这条红线见 docs/security.md。
 */

import type { ApiError, DispatchRequest, ShoutRequest } from '../contract/types.ts';

export const LOOPBACK_HOST = '127.0.0.1';

/**
 * C 案(内网开放)的「内」到底指哪一段:回环 + RFC1918 三段私网。
 * 判据是**字面 IP**,不是域名 —— 任何 hostname 解析出来的名字(evil.com、内网里的机器名)
 * 都不是内网 IP 字面量,一律不算内网。这条性质让 DNS rebinding 在 N2/N3 面前依然失效。
 */
export function isLanHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (o.some((n) => n > 255)) return false;
  if (o[0] === 10) return true; // 10.0.0.0/8
  if (o[0] === 172 && o[1]! >= 16 && o[1]! <= 31) return true; // 172.16.0.0/12
  if (o[0] === 192 && o[1] === 168) return true; // 192.168.0.0/16
  return false;
}

/** N2:允许的 Host 头。必须是内网/回环 IP 字面量;带了端口必须对得上,不带端口也认。 */
export function isAllowedHost(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;
  const h = hostHeader.trim().toLowerCase();
  if (h === '') return false;
  // 拆出 hostname 并顺手校验端口。IPv6 字面量自带方括号,单独处理。
  let hostname: string;
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    if (end === -1) return false;
    const rest = h.slice(end + 1);
    if (rest !== '' && rest !== `:${port}`) return false;
    hostname = h.slice(0, end + 1);
  } else {
    const colon = h.indexOf(':');
    if (colon === -1) {
      hostname = h;
    } else {
      if (h.slice(colon + 1) !== String(port)) return false;
      hostname = h.slice(0, colon);
    }
  }
  return isLanHost(hostname);
}

/**
 * N3:允许的 Origin。
 * 同源请求(直接开页面)通常不带 Origin,所以 undefined 放行;
 * 一旦带了 Origin 就必须是:本机(回环 + 开发端口例外)或内网 IP 字面量(C 案)。
 * 公网来源、任何域名 —— 一律拒。
 *
 * `devPorts` 是给前端开发期(Vite 跑在另一个端口)开的口子,**默认空**。
 * 关键在于它只收端口号、不收整条 Origin:配置项再怎么被误用,
 * 也只能放行 http://127.0.0.1:<port> 和 http://localhost:<port>,
 * 永远变不出一个外部域名来。见 docs/security.md 规则 N3。
 */
export function isAllowedOrigin(
  origin: string | undefined,
  port: number,
  devPorts: readonly number[] = [],
): boolean {
  if (origin == null) return true;
  const o = origin.toLowerCase();
  const allowed = new Set<string>();
  for (const p of [port, ...devPorts]) {
    allowed.add(`http://${LOOPBACK_HOST}:${p}`);
    allowed.add(`http://localhost:${p}`);
    allowed.add(`http://[::1]:${p}`);
  }
  if (allowed.has(o)) return true;
  // C 案:内网来源放行。浏览器里看到的指挥舱地址就是 http://<内网IP>:<端口>,Origin 长这样。
  // 只认 http + 字面地址;指挥舱不提供 https,更不存在公网来源。
  const m = /^http:\/\/([^/]+?)(?::(\d+))?$/.exec(o);
  if (!m) return false;
  const h = m[1]!;
  // 回环地址走老闸门:端口必须在 {port, ...devPorts} 里 —— 开发端口默认不放行的规则不变。
  // (不带端口的写法浏览器不会发,这里也顺带拒掉。)
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]') {
    const p = m[2] == null ? null : Number(m[2]);
    return p != null && [port, ...devPorts].includes(p);
  }
  // 内网 IP 字面量(C 案):端口不设限,浏览器发的就是真实端口。
  return isLanHost(h);
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
