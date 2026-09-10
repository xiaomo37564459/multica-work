/**
 * AetherLab 指挥舱 —— 前端直接消费的数据契约。
 *
 * 这个文件是契约的唯一权威定义。docs/data-contract.md 讲人话,这里是可编译的真身。
 * 改这里 = 改合同,必须先在 MTM-275 上说一声。
 *
 * ## 全局空值与格式约定(所有类型一律遵守)
 *
 * 1. 字段永远存在。缺失 / 不适用一律 `null`,不用空字符串、不用 0、不用省略。
 *    —— 防止前端写出 `if (x.foo)` 把合法的 0 和 "" 当成缺失。
 * 2. 列表缺失一律 `[]`,不用 null。
 *    —— 防止前端每处 `.map()` 前都要判空。
 * 3. 时间一律 RFC3339 UTC 带 Z,例 `2026-09-04T07:56:39Z`。
 * 4. 时长一律毫秒整数,字段名以 `_ms` 结尾。
 * 5. ID 一律 UUID 字符串(小写);issue 另有人读的编号 `identifier`,例 `MTM-275`。
 * 6. 枚举遇到没见过的值,归一成 `'unknown'`,原值放进同名 `*_raw` 字段。
 *    —— 平台以后加状态,指挥舱不能白屏。前端必须能渲染 `unknown`。
 */

/* ────────────────────────────── 通用信封 ────────────────────────────── */

/** 每个 GET 接口都返回这个形状,没有例外。 */
export type ApiEnvelope<T> =
  | { ok: true; data: T; meta: ApiMeta }
  | { ok: false; error: ApiError; meta: ApiMeta };

export interface ApiMeta {
  /** 这份数据实际从 multica 拉到的时刻。不是本次 HTTP 响应时刻。 */
  fetched_at: string | null;
  /** 距 fetched_at 过了多久。首次还没拉到时为 null。 */
  age_ms: number | null;
  /** age_ms 超过该资源的 max_age 时为 true。前端据此显示「数据可能过期」。 */
  stale: boolean;
  /** 本轮哪些数据源拉失败了(用 SourceName)。空数组 = 全绿。 */
  degraded: string[];
  /** 服务器当前时刻。前端算「已耗时」必须用它,不要用浏览器本地时钟。 */
  server_time: string;
}

export interface ApiError {
  code: ErrorCode;
  /** 中文人话,可以直接显示给 heory 看。 */
  message: string;
  retryable: boolean;
}

export const ERROR_CODES = [
  'not_implemented',      // 骨架阶段占位,韩程那一棒填
  'upstream_failed',      // multica CLI 调用失败
  'upstream_timeout',     // multica CLI 超时
  'not_found',            // 请求的 agent / issue / project 不存在
  'bad_request',          // 入参不合法
  'forbidden',            // 被写操作白名单拒绝
  'rate_limited',         // 写操作触发限流
  'internal',             // 兜底
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** 缓存里的每个数据源。meta.degraded 里出现的就是这些名字。 */
export const SOURCE_NAMES = [
  'agent_list',
  'agent_tasks',
  'issue_active',
  'issue_all',
  'issue_children',
  'project_list',
  'squad_list',
  'runtime_list',
  'runtime_usage',
  'runtime_activity',
] as const;
export type SourceName = (typeof SOURCE_NAMES)[number];

/* ────────────────────────────── 基础引用类型 ────────────────────────────── */

export type ActorKind = 'member' | 'agent' | 'unknown';

export interface Actor {
  id: string;
  name: string;
  kind: ActorKind;
  avatar_url: string | null;
}

export interface IssueRef {
  issue_id: string;
  /** 人读的编号,例 MTM-275。 */
  identifier: string | null;
  title: string | null;
  status: QuestStatus;
  status_raw: string | null;
  level: QuestLevel;
  project_id: string | null;
  /** 跳回 Multica 本体的地址。没配 app_url 时为 null,前端要能不显示这个按钮。 */
  deep_link: string | null;
}

export interface ProjectRef {
  project_id: string;
  title: string;
  icon: string | null;
  status: string | null;
  issue_count: number;
  done_count: number;
  deep_link: string | null;
}

/* ────────────────────────────── 枚举:角色战斗状态 ────────────────────────────── */

/**
 * 角色卡上的状态灯。判定规则见 src/aggregate/battle-state.ts,
 * 规则是纯函数且有单测 —— 改规则必须同步改测试。
 *
 * 判定顺序自上而下,先命中先算:
 *   offline  —— 该 agent 所在 runtime 不在线
 *   fighting —— 有 status=running 的 task
 *   defeated —— 最近一条 task failed 且 attempt >= max_attempts(重试用尽)
 *   stalled  —— 最近一条 task failed 但还能重试;或名下有 in_progress/blocked 的 issue 却没有 running task,
 *               **且这些 issue 底下也没有活着的子任务**
 *   waiting  —— 待接力:活都派下去了,子任务有人在推进,本人在等接力回来
 *   idle     —— 其它
 *
 * 关于 waiting(产品口径由策衡定,2026-09-04):
 *   指挥官把子任务派出去以后,他本人当然没有在跑的战斗 —— 这既不是卡住,也不是空闲。
 *   画成卡住 = 「卡住」这盏灯有已知误报,场景 1 就立不住;
 *   画成空闲 = 说他可以接新活,那是另一种说谎。所以单独一种状态。
 *   界面一期不加第五张立绘:待接力 = 空闲立绘 + 一个角标。
 */
export const BATTLE_STATES = ['fighting', 'stalled', 'defeated', 'waiting', 'idle', 'offline', 'unknown'] as const;
export type BattleState = (typeof BATTLE_STATES)[number];

export type RuntimeStatus = 'online' | 'offline' | 'unknown';

/* ────────────────────────────── 枚举:一场战斗(= 一条 task) ────────────────────────────── */

/** 归一后的战斗结局。原值放在 status_raw(running/completed/failed/cancelled)。 */
export const BATTLE_STATUSES = ['running', 'won', 'lost', 'aborted', 'unknown'] as const;
export type BattleStatus = (typeof BATTLE_STATUSES)[number];

/** 这场仗是怎么被打起来的。对应 multica task.kind。 */
export const BATTLE_KINDS = ['issue', 'chat', 'quick_create', 'comment', 'autopilot', 'unknown'] as const;
export type BattleKind = (typeof BATTLE_KINDS)[number];

/**
 * 失败归因的大类,由 failure_reason 前缀推出来。
 *   agent   —— 智能体/模型侧出的问题(failure_reason 以 `agent_error.` 开头)
 *   runtime —— 运行时/调度侧(runtime_offline / runtime_reconnect_timeout / idle_watchdog / queued_expired)
 * 分开是因为界面上要区别对待:agent 类值得 heory 看一眼,runtime 类通常重试就好。
 */
export const FAILURE_KINDS = ['agent', 'runtime', 'unknown'] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

/** 实测到的全部 failure_reason 取值(2026-09-04,1191 条 task 样本)。仅供界面做中文映射,不要当成封闭枚举。 */
export const KNOWN_FAILURE_REASONS = [
  'agent_error.model_not_found_or_unavailable',
  'agent_error.provider_network',
  'agent_error.provider_capacity_or_rate_limit',
  'agent_error.provider_server_error',
  'agent_error.provider_quota_limit',
  'agent_error.process_failure',
  'agent_error.unknown',
  'runtime_offline',
  'runtime_reconnect_timeout',
  'idle_watchdog',
  'queued_expired',
] as const;

/* ────────────────────────────── 枚举:怪物 / 关卡(= issue) ────────────────────────────── */

export const QUEST_STATUSES = [
  'todo', 'in_progress', 'in_review', 'done', 'blocked', 'backlog', 'cancelled', 'unknown',
] as const;
export type QuestStatus = (typeof QUEST_STATUSES)[number];

/** 怪物等级 = issue 优先级。 */
export const QUEST_LEVELS = ['urgent', 'high', 'medium', 'low', 'none', 'unknown'] as const;
export type QuestLevel = (typeof QUEST_LEVELS)[number];

/* ────────────────────────────── 血缘 / 接力 ────────────────────────────── */

export const LINEAGE_SOURCES = [
  'direct_human',   // 人直接派的
  'delegation',     // 上一棒智能体传下来的
  'owner_fallback', // 平台兜底记到 workspace owner 头上
  'trigger_owner',  // 触发器(autopilot 等)的归属人
  'unknown',
] as const;
export type LineageSource = (typeof LINEAGE_SOURCES)[number];

export const EVIDENCE_KINDS = ['issue_assignment', 'comment', 'chat', 'autopilot_run', 'unknown'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface Lineage {
  source: LineageSource;
  source_raw: string | null;
  /** 平台自己标的置信度。false = 平台是猜的,界面上别把接力链画成实线。 */
  precise: boolean;
  /** 上一棒的 task id。整条链的起点为 null。 */
  from_task_id: string | null;
  /**
   * 上一棒能不能在当前数据里找到。
   * 实测:855 条有 from_task_id 的记录里有 99 条找不到上一棒(都是 2026-08-25 之前的老数据)。
   * 所以 **接力链一定要能渲染断链**,不能假设一路能走到根。
   */
  from_resolved: boolean;
  evidence_kind: EvidenceKind;
  evidence_kind_raw: string | null;
  /** 证据对应的 issue id / comment id / chat id,按 evidence_kind 解释。 */
  evidence_ref_id: string | null;
  /** 直接把这一棒交出去的人或智能体。 */
  initiator: Actor | null;
  /** 整条链最初的发起人。 */
  originator: Actor | null;
}

/* ────────────────────────────── 一场战斗 ────────────────────────────── */

export interface Battle {
  task_id: string;
  agent_id: string;
  status: BattleStatus;
  /** multica 原值:running / completed / failed / cancelled。 */
  status_raw: string;
  kind: BattleKind;
  kind_raw: string;

  /**
   * 打的哪只怪。
   * chat / quick_create / autopilot 类型的 task 没有 issue,这里为 null
   * (multica 原始返回是空字符串 "",本层已归一成 null)。
   */
  issue: IssueRef | null;

  /** 第几次打这只怪,1-based。重试 = 平台新建一条 attempt+1 的 task,不是原地改。 */
  attempt: number;
  max_attempts: number;
  /** = attempt - 1。角色卡上的「重试次数」直接用这个。 */
  retries: number;

  created_at: string;
  /** 从来没开打过(排队超时 / 被取消)时为 null。实测 1191 条里有 115 条是 null。 */
  started_at: string | null;
  completed_at: string | null;
  /**
   * 已耗时。
   *   running  —— server_time - started_at
   *   已结束    —— completed_at - started_at
   *   started_at 为 null —— null
   */
  elapsed_ms: number | null;

  /** 仅 status=lost 时非空。实测:failed 的 156 条全都有 failure_reason 和 error_text。 */
  failure_reason: string | null;
  failure_kind: FailureKind | null;
  error_text: string | null;

  /** 仅 status=won 时非空。取 result.output 前 OUTPUT_EXCERPT_MAX 字符。 */
  output_excerpt: string | null;
  /** 是否被截断了。true 时前端可以给个「看全文」入口(走 /api/battles/:id)。 */
  output_truncated: boolean;
  /**
   * result.pr_url。原值为空串时归一成 null。
   * 实测:本 workspace 1191 条 task 里 pr_url 全为空 —— 界面不要依赖它有值。
   */
  pr_url: string | null;

  /** 这一棒交付了哪几条评论。战斗回放靠它找「每棒交付了什么」。实测 614/1191 条非空。 */
  delivered_comment_ids: string[];

  lineage: Lineage;
}

export const OUTPUT_EXCERPT_MAX = 800;

/* ────────────────────────────── 主视图:全员角色状态 ────────────────────────────── */

export interface RosterEntry {
  agent_id: string;
  /** multica 里的全名,例 「周构｜架构师」。 */
  name: string;
  /** 全角竖线前半段,例 「周构」。切不出来时 = name。 */
  display_name: string;
  /** 全角竖线后半段,例 「架构师」。切不出来时 null。 */
  role_title: string | null;
  avatar_url: string | null;
  /** 职业定位 = agent.description。 */
  class_desc: string | null;
  model: string | null;

  runtime_id: string | null;
  runtime_status: RuntimeStatus;

  state: BattleState;
  /** 为什么是这个状态,中文一句话。界面做 tooltip,顾检验收时对着它核规则。 */
  state_reason: string;

  /**
   * 这个角色的战斗历史这一轮拉到了没有。
   *
   * 为什么要这个字段:`agent tasks` 属于温档/巡档,不是每轮全拉(原因见 docs/polling.md)。
   * 刚开页面时会有一批角色还没轮到,此时 stats 是 null、current_battles 是空。
   * **false 时界面要画骨架屏或「战绩加载中」,绝不能把它渲染成「0 胜 0 败」** —— 那是在骗人。
   */
  battles_loaded: boolean;

  /**
   * 正在打的怪,可能不止一只。
   * agent.max_concurrent_tasks 实测取值 3 / 6,所以这里是数组不是单值 —— 界面别写死「一个角色一场仗」。
   * battles_loaded 为 false 时恒为 []。
   */
  current_battles: Battle[];
  /** 最近一场已结束的战斗。全新 agent 或 battles_loaded=false 时为 null。 */
  last_battle: Battle | null;

  /** battles_loaded 为 false 时是 null。见 battles_loaded 的注释。 */
  stats: AgentStats | null;
  deep_link: string | null;
}

export interface Roster {
  entries: RosterEntry[];
  counts: Record<BattleState, number>;
}

/* ────────────────────────────── 角色详情 ────────────────────────────── */

export interface SkillSlot {
  skill_id: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  /** workspace = 在 Multica 里显式装配的;runtime = 运行时自带的。一期只拿得到 workspace。 */
  source: 'workspace' | 'runtime' | 'unknown';
}

/**
 * 装备栏(MCP)。
 * 实测(2026-09-04):13 个 agent 的 `agent mcp list` 全部返回 [],`agent list` 的 mcp_config 全为 null。
 * 接口是通的,只是这个 workspace 现在没人挂 MCP —— 界面要能画「装备栏空着」这一态。
 */
export interface EquipmentSlot {
  name: string;
  enabled: boolean;
}

export interface AgentStats {
  total: number;
  won: number;
  lost: number;
  aborted: number;
  running: number;
  /** won / (won + lost)。分母为 0 时 null,不要返回 0。 */
  win_rate: number | null;
  /** attempt > 1 的场次数。 */
  retried: number;
  last_active_at: string | null;
  /**
   * 人均蓝条 —— **一期恒为 null**。
   * 平台的 token 用量只到 runtime 粒度(`runtime usage <runtime-id>`),
   * 而 13 个 agent 全跑在同一个 runtime 上,摊不到人头。全局蓝条见 RuntimeVitals。
   */
  mana: null;
}

export interface AgentDetail extends RosterEntry {
  skills: SkillSlot[];
  equipment: EquipmentSlot[];
  /** 最近 N 场战斗,时间倒序。N 见 RECENT_BATTLES_LIMIT。 */
  recent_battles: Battle[];
  squad_ids: string[];
}

export const RECENT_BATTLES_LIMIT = 20;

/* ────────────────────────────── 战役地图:项目关卡树 ────────────────────────────── */

export interface QuestNode {
  issue_id: string;
  identifier: string | null;
  title: string;
  status: QuestStatus;
  status_raw: string;
  /** 平台的状态大类。自定义状态时会和 status 不一样,界面上色用这个。 */
  status_category: QuestStatus;
  level: QuestLevel;
  level_raw: string;
  /** 第几关。不分关的为 null。 */
  stage: number | null;
  parent_issue_id: string | null;
  /** 出击角色。没人认领为 null。 */
  assignee: Actor | null;
  /** 出击角色当前的战斗状态,便于在关卡节点上挂状态灯。assignee 为 null 或不是 agent 时 null。 */
  assignee_battle_state: BattleState | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  deep_link: string | null;
}

export interface CampaignStage {
  stage: number;
  total: number;
  done: number;
  quests: QuestNode[];
}

export interface CampaignMap {
  project: ProjectRef;
  /** 按 stage 升序。 */
  stages: CampaignStage[];
  /** stage 为 null 的关卡。实测 254 条 issue 里有 142 条不分关,所以这一堆不小。 */
  unstaged: QuestNode[];
  totals: {
    total: number;
    done: number;
    /**
     * 「失败/卡死」的判定口径(MTM-278,沈执 2026-09-09 拍板,与前端 mock 同口径):
     * status_category=blocked 的关卡,或出击角色当前状态灯是 defeated 的 in_progress/in_review 关卡。
     * 实现在 src/aggregate/detail.ts 的 isFailedQuest,别再猜第二遍。
     */
    failed: number;
    /** status_category 为 in_progress 或 in_review。 */
    in_progress: number;
  };
}

/* ────────────────────────────── 战斗回放:接力链 ────────────────────────────── */

export interface BattleChainNode {
  battle: Battle;
  agent: { agent_id: string; name: string; avatar_url: string | null };
  /** 从链首起第几棒,0-based。 */
  depth: number;
  /** 这一棒交付的评论 id(= battle.delivered_comment_ids,提到顶层方便时间轴渲染)。 */
  handoff_comment_ids: string[];
}

export interface BattleChain {
  /** 请求的那一棒。 */
  focus_task_id: string;
  /** 时间正序,depth 0 在前。 */
  nodes: BattleChainNode[];
  /**
   * 链条是否断过 —— 有 from_task_id 但在数据里找不到上一棒。
   * true 时界面要画成「往上还有,但查不到了」,不要假装这就是起点。
   */
  broken: boolean;
  /** 为了防环和防爆,最多往上追 CHAIN_MAX_DEPTH 棒;追满了置 true。 */
  truncated: boolean;
}

export const CHAIN_MAX_DEPTH = 30;

/**
 * 按 issue 查战斗(MTM-278 新增,B 案 —— 不改既有类型,多一个接口):
 *   GET /api/issues/:id/battles → Battle[](时间正序)
 * 战役地图节点直开回放用:前端从返回列表里取最新一场开回放。
 */
export const ISSUE_BATTLES_PATH = '/api/issues/:id/battles';

/* ────────────────────────────── 全局蓝条 / 运行时 ────────────────────────────── */

export interface ManaStats {
  window_days: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  /** 上面四项之和。 */
  total_tokens: number;
  by_model: Array<{
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    total_tokens: number;
  }>;
  /**
   * 花费 —— **一期恒为 null**。
   * 平台返回的 cost_usd_ticks 实测全为 0,当不了真。
   */
  cost_usd: null;
}

export interface HourBucket {
  /** 0..23。 */
  hour: number;
  count: number;
}

export interface RuntimeVitals {
  runtime_id: string;
  name: string;
  status: RuntimeStatus;
  status_raw: string;
  last_seen_at: string | null;
  provider: string | null;
  device_info: string | null;
  mana: ManaStats;
  /** 24 条,hour 0..23。注意:平台给的是按小时聚合的桶,没有日期维度。 */
  activity_24h: HourBucket[];
}

/* ────────────────────────────── 写操作:派活 / 喊话 ────────────────────────────── */

/** POST /api/commands/dispatch —— 派活。 */
export interface DispatchRequest {
  title: string;
  description: string;
  assignee_agent_id: string;
  project_id?: string | null;
  priority?: QuestLevel | null;
  parent_issue_id?: string | null;
  stage?: number | null;
}

export interface DispatchResult {
  issue_id: string;
  identifier: string | null;
  deep_link: string | null;
}

/** POST /api/commands/shout —— 阵中喊话。 */
export interface ShoutRequest {
  issue_id: string;
  content: string;
  parent_comment_id?: string | null;
}

export interface ShoutResult {
  comment_id: string;
  issue_id: string;
}

/** 写操作只有这两种。除此之外一律拒绝,见 src/server/guard.ts。 */
export const ALLOWED_WRITE_COMMANDS = ['dispatch', 'shout'] as const;
export type WriteCommand = (typeof ALLOWED_WRITE_COMMANDS)[number];

/* ────────────────────────────── 自检 ────────────────────────────── */

export interface Health {
  ok: boolean;
  version: string;
  /** 服务实际绑定的地址,永远应该是 127.0.0.1。 */
  bind: string;
  /** multica CLI 是否可用,以及版本。 */
  cli: { available: boolean; version: string | null };
  workspace_id: string | null;
  /** deep_link 用的模板。null = 没配,前端不要画跳转按钮。 */
  deep_link_template: string | null;
  sources: Array<{
    name: SourceName;
    fetched_at: string | null;
    age_ms: number | null;
    stale: boolean;
    consecutive_failures: number;
    last_error: string | null;
  }>;
  server_time: string;
}
