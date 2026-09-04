/**
 * multica CLI `--output json` 的原始返回形状。
 *
 * 这里的每一个字段都是 2026-09-04 在 heory 本机上实跑出来的,不是猜的。
 * 采样量:13 个 agent / 1191 条 task / 254 条 issue / 6 个 project / 3 个 runtime。
 * 字段对应哪条命令,见 docs/data-sources.md。
 *
 * 规矩:**只有这个文件可以出现 multica 的原始字段名。**
 * 越过 aggregate/ 直接把 raw 类型漏给 server/ 或前端,等于把平台的字段变动直接捅到界面上。
 */

/* ── multica agent list ── */
export interface RawAgent {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  model: string | null;
  runtime_id: string | null;
  runtime_mode: string | null;
  max_concurrent_tasks: number;
  status: string | null;
  archived_at: string | null;
  workspace_id: string;
  /** agent list 里已经内联了完整技能栏 —— 不用再逐个调 `agent skills list`。 */
  skills: RawAgentSkill[];
  disabled_runtime_skills: string[];
  /** 实测 13 个 agent 全为 null。装备栏(MCP)要另调 `agent mcp list`。 */
  mcp_config: unknown | null;
  created_at: string;
  updated_at: string;
}

export interface RawAgentSkill {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
}

/* ── multica agent mcp list <id> ── */
export interface RawAgentMcp {
  name: string;
  enabled?: boolean;
}

/* ── multica agent tasks <id> ──
 * 返回数组,按 created_at 倒序(实测 356 条全序验证通过)。
 * 没有 limit / offset 参数 —— 一次返回全部历史,这是全局最大的性能瓶颈,见 docs/polling.md。
 */
export interface RawTask {
  id: string;
  agent_id: string;
  /** running | completed | failed | cancelled(1191 条样本穷举) */
  status: string;
  /** chat | quick_create | comment | direct | autopilot */
  kind: string;
  /** **注意是空字符串不是 null**:chat/quick_create/autopilot 类型没有 issue,实测 108 条为 ""。 */
  issue_id: string;
  attempt: number;
  max_attempts: number;
  /** 0..4 的整数,与 issue 的 priority 字符串不是一回事,一期不用。 */
  priority: number;
  created_at: string;
  dispatched_at: string | null;
  /** 从未开打的 task 为 null(实测 115 条:cancelled 111 / failed 4)。 */
  started_at: string | null;
  completed_at: string | null;
  /** 仅 status=failed 时非 null,是**字符串**不是对象。 */
  error: string | null;
  /** 仅 status=failed 时存在(156/156 命中),其余情况这个 key 直接不出现。 */
  failure_reason?: string;
  /** 仅 status=completed 时非 null(911/911 命中)。 */
  result: RawTaskResult | null;
  delivered_comment_ids: string[];
  attribution: RawAttribution | null;
  runtime_id: string | null;
  workspace_id: string;
  work_dir: string | null;
  relative_work_dir: string | null;
}

export interface RawTaskResult {
  output: string;
  /** 实测本 workspace 全为空串。 */
  pr_url: string;
  session_id: string;
  work_dir: string;
}

export interface RawAttribution {
  /** direct_human | delegation | owner_fallback | trigger_owner */
  source: string;
  precise: boolean;
  /** 上一棒的 task id。实测 855/1191 条有值,其中 99 条指向的 task 已经查不到了。 */
  delegated_from_task_id?: string;
  evidence?: {
    /** issue_assignment | comment | chat | autopilot_run */
    kind: string;
    ref_id: string;
  };
  initiator?: RawActor;
  originator?: RawActor;
}

export interface RawActor {
  id: string;
  name: string;
  email?: string;
  avatar_url?: string | null;
}

/* ── multica issue list ──
 * 注意返回的是**信封对象**不是数组;--limit 服务端上限 100(传 500 会被截到 100)。
 */
export interface RawIssueListResponse {
  issues: RawIssue[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface RawIssue {
  id: string;
  /** 人读编号,例 MTM-275。 */
  identifier: string;
  number: number;
  title: string;
  /** 完整正文。全量 254 条加起来约 420KB —— 主视图别整包拉,见 docs/polling.md。 */
  description: string | null;
  /** todo | in_progress | in_review | done | blocked | backlog | cancelled */
  status: string;
  status_category: string;
  /** 自定义状态的显示名,实测全为空串。 */
  status_name: string;
  /** urgent | high | medium | low | none */
  priority: string;
  /** 第几关。不分关为 null(实测 254 条里 142 条为 null)。 */
  stage: number | null;
  parent_issue_id: string | null;
  project_id: string | null;
  assignee_id: string | null;
  /** agent | member | squad | null */
  assignee_type: string | null;
  creator_id: string | null;
  creator_type: string | null;
  labels: unknown[];
  metadata: Record<string, unknown>;
  properties: Record<string, unknown>;
  position: number;
  revision: number;
  start_date: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  workspace_id: string;
}

/* ── multica issue children <id> ── */
export interface RawIssueChildren {
  stages: Array<{
    stage: number;
    total: number;
    done: number;
    issues: RawIssue[];
  }>;
  unstaged: RawIssue[];
  total: number;
}

/* ── multica project list ── */
export interface RawProject {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  status: string | null;
  priority: string | null;
  issue_count: number;
  done_count: number;
  resource_count: number;
  lead_id: string | null;
  lead_type: string | null;
  start_date: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  workspace_id: string;
}

/* ── multica squad list ── */
export interface RawSquad {
  id: string;
  name: string;
  description: string | null;
  leader_id: string | null;
  member_count: number;
  /** 只有前几个成员,不是全量 —— 想要全量得 `squad get`。 */
  member_preview: Array<{ member_id: string; member_type: string; role: string }>;
  archived_at: string | null;
  workspace_id: string;
}

/* ── multica runtime list ── */
export interface RawRuntime {
  id: string;
  name: string;
  custom_name: string | null;
  /** online | offline(实测只见过 online) */
  status: string;
  provider: string | null;
  runtime_mode: string | null;
  device_info: string | null;
  last_seen_at: string | null;
  daemon_id: string | null;
  metadata: Record<string, unknown> | null;
  workspace_id: string;
}

/* ── multica runtime usage <runtime-id> ──
 * 返回数组,一行 = 一个 (date, model) 组合。**粒度是 runtime,不是 agent。**
 */
export interface RawRuntimeUsage {
  runtime_id: string;
  /** YYYY-MM-DD */
  date: string;
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  /** 实测恒为 0,当不了真 —— 一期不做花费。 */
  cost_usd_ticks: number;
  uncosted_input_tokens: number;
  uncosted_output_tokens: number;
  uncosted_cache_read_tokens: number;
  uncosted_cache_write_tokens: number;
}

/* ── multica runtime activity <runtime-id> ──
 * 固定 24 条,只有小时桶,没有日期维度。
 */
export interface RawRuntimeActivity {
  hour: number;
  count: number;
}

/* ── multica issue create / comment add 的返回 ── */
export interface RawCreatedIssue {
  id: string;
  identifier?: string;
  [k: string]: unknown;
}

export interface RawCreatedComment {
  id: string;
  issue_id?: string;
  [k: string]: unknown;
}
