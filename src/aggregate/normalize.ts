/**
 * raw(multica 原始字段)→ contract(前端契约)的归一层。
 *
 * 这一层的存在意义就一条:**平台改字段的时候,只有这个文件会疼。**
 * 所以规矩是 —— 未知枚举值一律降级成 'unknown' 并保留原值,绝不抛异常。
 * 界面宁可显示一个「未知状态」的灰灯,也不能整块白屏。
 */

import type {
  RawAgent, RawActor, RawAttribution, RawIssue, RawProject, RawRuntime,
  RawRuntimeActivity, RawRuntimeUsage, RawSquad, RawTask,
} from '../multica/raw.ts';
import {
  BATTLE_KINDS, BATTLE_STATUSES, EVIDENCE_KINDS, FAILURE_KINDS, LINEAGE_SOURCES,
  OUTPUT_EXCERPT_MAX, QUEST_LEVELS, QUEST_STATUSES,
} from '../contract/types.ts';
import type {
  Actor, ActorKind, Battle, BattleKind, BattleStatus, EvidenceKind, FailureKind,
  HourBucket, IssueRef, Lineage, LineageSource, ManaStats, ProjectRef, QuestLevel,
  QuestNode, QuestStatus, RuntimeStatus, RuntimeVitals, SkillSlot,
} from '../contract/types.ts';

/** 把可能不存在 / 空串的值统一成 null。空串是 multica 表示「没有」的方式之一(见 task.issue_id)。 */
export function nullish(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length === 0 ? null : v;
}

function oneOf<T extends string>(allowed: readonly T[], raw: string | null | undefined, fallback: T): T {
  if (raw != null && (allowed as readonly string[]).includes(raw)) return raw as T;
  return fallback;
}

/** 时间戳归一成 RFC3339 UTC。解析不了就返回 null,不要往下游传垃圾。 */
export function toIso(v: string | null | undefined): string | null {
  const s = nullish(v);
  if (s == null) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function msBetween(from: string | null, to: string | null): number | null {
  if (from == null || to == null) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, b - a);
}

/* ────────────────────────────── 深链 ────────────────────────────── */

/**
 * deep_link 模板。`{id}` / `{identifier}` / `{workspace}` 会被替换。
 *
 * ⚠️ 这是整份契约里**唯一一个没有实测过的值** —— 需要在浏览器里打开一个真实 issue,
 * 把地址栏 URL 的形状填进环境变量 COCKPIT_ISSUE_URL_TEMPLATE 核对一次。
 * 没配 / 配错时所有 deep_link 都是 null,界面不画跳转按钮即可,不影响其它功能。
 */
export interface DeepLinkConfig {
  issueTemplate: string | null;
  agentTemplate: string | null;
  projectTemplate: string | null;
  workspaceSlug: string | null;
}

export const NO_DEEP_LINKS: DeepLinkConfig = {
  issueTemplate: null, agentTemplate: null, projectTemplate: null, workspaceSlug: null,
};

function fill(template: string | null, vars: Record<string, string | null>): string | null {
  if (!template) return null;
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    if (v == null) return null; // 变量缺失就别给半截链接
    out = out.split(`{${k}}`).join(encodeURIComponent(v));
  }
  return out.includes('{') ? null : out;
}

export function issueDeepLink(cfg: DeepLinkConfig, issueId: string, identifier: string | null): string | null {
  return fill(cfg.issueTemplate, { id: issueId, identifier, workspace: cfg.workspaceSlug });
}
export function agentDeepLink(cfg: DeepLinkConfig, agentId: string): string | null {
  return fill(cfg.agentTemplate, { id: agentId, workspace: cfg.workspaceSlug });
}
export function projectDeepLink(cfg: DeepLinkConfig, projectId: string): string | null {
  return fill(cfg.projectTemplate, { id: projectId, workspace: cfg.workspaceSlug });
}

/* ────────────────────────────── Actor ────────────────────────────── */

export function toActor(raw: RawActor | undefined | null, agentIds: ReadonlySet<string>): Actor | null {
  if (!raw?.id) return null;
  const kind: ActorKind = agentIds.has(raw.id) ? 'agent' : 'member';
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    kind,
    // email 是 PII,契约里刻意不带 —— 指挥舱不需要它。
    avatar_url: nullish(raw.avatar_url ?? null),
  };
}

export function actorFromAssignee(
  issue: RawIssue,
  agentsById: ReadonlyMap<string, RawAgent>,
): Actor | null {
  if (!issue.assignee_id) return null;
  const agent = agentsById.get(issue.assignee_id);
  const kind: ActorKind = issue.assignee_type === 'agent'
    ? 'agent'
    : issue.assignee_type === 'member'
      ? 'member'
      : 'unknown';
  return {
    id: issue.assignee_id,
    name: agent?.name ?? issue.assignee_id,
    kind,
    avatar_url: nullish(agent?.avatar_url ?? null),
  };
}

/* ────────────────────────────── issue / quest ────────────────────────────── */

export function toQuestStatus(raw: string | null | undefined): QuestStatus {
  return oneOf(QUEST_STATUSES, raw, 'unknown');
}

export function toQuestLevel(raw: string | null | undefined): QuestLevel {
  return oneOf(QUEST_LEVELS, raw, 'unknown');
}

export function toIssueRef(issue: RawIssue, cfg: DeepLinkConfig): IssueRef {
  return {
    issue_id: issue.id,
    identifier: nullish(issue.identifier),
    title: nullish(issue.title),
    status: toQuestStatus(issue.status),
    status_raw: nullish(issue.status),
    level: toQuestLevel(issue.priority),
    project_id: nullish(issue.project_id),
    deep_link: issueDeepLink(cfg, issue.id, nullish(issue.identifier)),
  };
}

export function toQuestNode(
  issue: RawIssue,
  cfg: DeepLinkConfig,
  agentsById: ReadonlyMap<string, RawAgent>,
  assigneeState: (agentId: string) => QuestNode['assignee_battle_state'],
): QuestNode {
  const assignee = actorFromAssignee(issue, agentsById);
  return {
    issue_id: issue.id,
    identifier: nullish(issue.identifier),
    title: issue.title ?? '',
    status: toQuestStatus(issue.status),
    status_raw: issue.status ?? '',
    status_category: toQuestStatus(issue.status_category),
    level: toQuestLevel(issue.priority),
    level_raw: issue.priority ?? '',
    stage: issue.stage ?? null,
    parent_issue_id: nullish(issue.parent_issue_id),
    assignee,
    assignee_battle_state: assignee?.kind === 'agent' ? assigneeState(assignee.id) : null,
    created_at: toIso(issue.created_at) ?? issue.created_at,
    updated_at: toIso(issue.updated_at) ?? issue.updated_at,
    last_activity_at: toIso(issue.last_activity_at) ?? issue.last_activity_at,
    deep_link: issueDeepLink(cfg, issue.id, nullish(issue.identifier)),
  };
}

/* ────────────────────────────── task / battle ────────────────────────────── */

const STATUS_MAP: Record<string, BattleStatus> = {
  running: 'running',
  completed: 'won',
  failed: 'lost',
  cancelled: 'aborted',
};

export function toBattleStatus(raw: string | null | undefined): BattleStatus {
  const mapped = raw != null ? STATUS_MAP[raw] : undefined;
  return mapped ?? oneOf(BATTLE_STATUSES, raw, 'unknown');
}

export function toBattleKind(raw: string | null | undefined): BattleKind {
  // multica 的 `direct` = 从 issue 派下来的一棒,契约里叫 issue,读起来才对得上游戏语义。
  if (raw === 'direct') return 'issue';
  return oneOf(BATTLE_KINDS, raw, 'unknown');
}

export function toFailureKind(reason: string | null): FailureKind | null {
  if (reason == null) return null;
  if (reason.startsWith('agent_error.')) return 'agent';
  if (
    reason === 'runtime_offline' || reason === 'runtime_reconnect_timeout'
    || reason === 'idle_watchdog' || reason === 'queued_expired'
  ) return 'runtime';
  return oneOf(FAILURE_KINDS, null, 'unknown');
}

export function toLineage(
  attr: RawAttribution | null | undefined,
  knownTaskIds: ReadonlySet<string>,
  agentIds: ReadonlySet<string>,
): Lineage {
  const from = nullish(attr?.delegated_from_task_id ?? null);
  return {
    source: oneOf<LineageSource>(LINEAGE_SOURCES, attr?.source, 'unknown'),
    source_raw: nullish(attr?.source ?? null),
    precise: attr?.precise === true,
    from_task_id: from,
    from_resolved: from != null && knownTaskIds.has(from),
    evidence_kind: oneOf<EvidenceKind>(EVIDENCE_KINDS, attr?.evidence?.kind, 'unknown'),
    evidence_kind_raw: nullish(attr?.evidence?.kind ?? null),
    evidence_ref_id: nullish(attr?.evidence?.ref_id ?? null),
    initiator: toActor(attr?.initiator, agentIds),
    originator: toActor(attr?.originator, agentIds),
  };
}

export interface BattleContext {
  cfg: DeepLinkConfig;
  /** 本次数据里已知的全部 task id,用来判断接力链断没断。 */
  knownTaskIds: ReadonlySet<string>;
  agentIds: ReadonlySet<string>;
  issuesById: ReadonlyMap<string, RawIssue>;
  /** 算 running 战斗已耗时用的基准时刻,由 server 统一注入,保证一屏内口径一致。 */
  now: string;
}

export function toBattle(task: RawTask, ctx: BattleContext): Battle {
  const status = toBattleStatus(task.status);
  const startedAt = toIso(task.started_at);
  const completedAt = toIso(task.completed_at);
  const issueId = nullish(task.issue_id);
  const issue = issueId != null ? ctx.issuesById.get(issueId) : undefined;
  const failureReason = status === 'lost' ? nullish(task.failure_reason ?? null) : null;
  const output = status === 'won' ? nullish(task.result?.output ?? null) : null;

  return {
    task_id: task.id,
    agent_id: task.agent_id,
    status,
    status_raw: task.status ?? '',
    kind: toBattleKind(task.kind),
    kind_raw: task.kind ?? '',
    issue: issue
      ? toIssueRef(issue, ctx.cfg)
      : issueId != null
        // issue 不在本次缓存里(例如已归档)。给一个只有 id 的壳,界面照样能跳。
        ? {
            issue_id: issueId, identifier: null, title: null,
            status: 'unknown' as QuestStatus, status_raw: null,
            level: 'unknown' as QuestLevel, project_id: null,
            deep_link: issueDeepLink(ctx.cfg, issueId, null),
          }
        : null,
    attempt: task.attempt ?? 1,
    max_attempts: task.max_attempts ?? 1,
    retries: Math.max(0, (task.attempt ?? 1) - 1),
    created_at: toIso(task.created_at) ?? task.created_at,
    started_at: startedAt,
    completed_at: completedAt,
    elapsed_ms: status === 'running'
      ? msBetween(startedAt, ctx.now)
      : msBetween(startedAt, completedAt),
    failure_reason: failureReason,
    failure_kind: toFailureKind(failureReason),
    error_text: status === 'lost' ? nullish(task.error) : null,
    output_excerpt: output != null ? output.slice(0, OUTPUT_EXCERPT_MAX) : null,
    output_truncated: output != null && output.length > OUTPUT_EXCERPT_MAX,
    pr_url: nullish(task.result?.pr_url ?? null),
    delivered_comment_ids: task.delivered_comment_ids ?? [],
    lineage: toLineage(task.attribution, ctx.knownTaskIds, ctx.agentIds),
  };
}

/* ────────────────────────────── agent 名字拆分 ────────────────────────────── */

/** "周构｜架构师" → { display: "周构", role: "架构师" }。切不出来时 role 为 null。 */
export function splitAgentName(name: string): { display: string; role: string | null } {
  const parts = name.split('｜');
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return { display: parts[0].trim(), role: parts.slice(1).join('｜').trim() };
  }
  return { display: name, role: null };
}

/* ────────────────────────────── skills / project / squad / runtime ────────────────────────────── */

export function toSkillSlots(agent: RawAgent): SkillSlot[] {
  return (agent.skills ?? []).map((s) => ({
    skill_id: nullish(s.id),
    name: s.name,
    description: nullish(s.description),
    enabled: s.enabled !== false,
    source: 'workspace' as const,
  }));
}

export function toProjectRef(p: RawProject, cfg: DeepLinkConfig): ProjectRef {
  return {
    project_id: p.id,
    title: p.title,
    icon: nullish(p.icon),
    status: nullish(p.status),
    issue_count: p.issue_count ?? 0,
    done_count: p.done_count ?? 0,
    deep_link: projectDeepLink(cfg, p.id),
  };
}

export function toRuntimeStatus(raw: string | null | undefined): RuntimeStatus {
  if (raw === 'online') return 'online';
  if (raw === 'offline') return 'offline';
  return 'unknown';
}

export function toMana(rows: readonly RawRuntimeUsage[], windowDays: number): ManaStats {
  const byModel = new Map<string, ManaStats['by_model'][number]>();
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;

  for (const r of rows) {
    input += r.input_tokens ?? 0;
    output += r.output_tokens ?? 0;
    cacheRead += r.cache_read_tokens ?? 0;
    cacheWrite += r.cache_write_tokens ?? 0;

    const key = r.model ?? 'unknown';
    const acc = byModel.get(key) ?? {
      model: key, input_tokens: 0, output_tokens: 0,
      cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 0,
    };
    acc.input_tokens += r.input_tokens ?? 0;
    acc.output_tokens += r.output_tokens ?? 0;
    acc.cache_read_tokens += r.cache_read_tokens ?? 0;
    acc.cache_write_tokens += r.cache_write_tokens ?? 0;
    acc.total_tokens = acc.input_tokens + acc.output_tokens + acc.cache_read_tokens + acc.cache_write_tokens;
    byModel.set(key, acc);
  }

  return {
    window_days: windowDays,
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    total_tokens: input + output + cacheRead + cacheWrite,
    by_model: [...byModel.values()].sort((a, b) => b.total_tokens - a.total_tokens),
    cost_usd: null,
  };
}

export function toHourBuckets(rows: readonly RawRuntimeActivity[]): HourBucket[] {
  const byHour = new Map(rows.map((r) => [r.hour, r.count ?? 0]));
  return Array.from({ length: 24 }, (_, hour) => ({ hour, count: byHour.get(hour) ?? 0 }));
}

export function toRuntimeVitals(
  rt: RawRuntime,
  usage: readonly RawRuntimeUsage[],
  activity: readonly RawRuntimeActivity[],
  windowDays: number,
): RuntimeVitals {
  return {
    runtime_id: rt.id,
    name: nullish(rt.custom_name) ?? rt.name,
    status: toRuntimeStatus(rt.status),
    status_raw: rt.status ?? '',
    last_seen_at: toIso(rt.last_seen_at),
    provider: nullish(rt.provider),
    device_info: nullish(rt.device_info),
    mana: toMana(usage, windowDays),
    activity_24h: toHourBuckets(activity),
  };
}

export function squadIdsForAgent(squads: RawSquad[], agentId: string): string[] {
  // member_preview 只有前几个人 —— 只能作为提示,拿不全。想要全量得走 `squad get`,一期不做。
  return squads
    .filter((s) => s.leader_id === agentId || s.member_preview?.some((m) => m.member_id === agentId))
    .map((s) => s.id);
}
