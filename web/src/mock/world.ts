/**
 * mock 世界 —— 一个按周构契约(src/contract/types.ts)运转的小系统。
 *
 * 三条设计原则:
 *   1. **结构 = 契约**。所有返回值都用 `satisfies` 压在 @contract 类型上,
 *      字段名错一个、少一个 null,`npm run typecheck` 当场红。换真数据只换数据源。
 *   2. **像真系统一样走时间**。时钟由外面注入(默认 Date.now):战斗耗时会涨、
 *      战绩有加载相位(battles_loaded=false → 数秒后补齐),不是一张静态截图。
 *   3. **七种状态、断链、多线作战、空装备栏这些「难看的真相」全都要有** ——
 *      mock 的职责是把真系统会出现的形态都演出来,验收才走查得到。
 *
 * 人物直接取苏绘名册(@pixel/sprites/roster.js)的真实 agent id,
 * 立绘按 id 就能对上号,不用做映射。
 */
import { ROSTER } from '@pixel/sprites/roster.js';
import type {
  Actor, AgentDetail, AgentStats, Battle, BattleChain, BattleChainNode, BattleState,
  BattleStatus, CampaignMap, CampaignStage, IssueRef, Lineage, ProjectRef, QuestLevel,
  QuestNode, QuestStatus, Roster, RosterEntry, SkillSlot,
} from '@contract';
import { BATTLE_STATES } from '@contract';

/** 开机后多久战绩补齐(许界、梁运两人演加载相位)。 */
export const LOAD_DELAY_MS = 6000;

/* ─────────────── 小工具 ─────────────── */

/** 把可读种子变成稳定的 UUID 形状串 —— 契约规定 id 是小写 UUID。 */
function uid(seed: string): string {
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + seed.charCodeAt(i) * (i + 7), 0x85ebca6b) >>> 0;
  }
  const hex = (n: number, w: number) => n.toString(16).padStart(w, '0').slice(0, w);
  const a = hex(h1, 8), b = hex(h2, 8), c = hex(h1 ^ h2, 8);
  return `${a}-${b.slice(0, 4)}-4${b.slice(4, 7)}-8${c.slice(0, 3)}-${hex(Math.imul(h1, h2) >>> 0, 8)}${c.slice(3, 7)}`;
}

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();

/** 跳回本体的占位模板(真环境由 COCKPIT_ISSUE_URL_TEMPLATE 配)。 */
const LINK_BASE = 'https://multica.example/mtmwork';
const issueLink = (identifier: string | null) => (identifier ? `${LINK_BASE}/issue/${identifier}` : null);

const HEORY: Actor = { id: uid('member-heory'), name: 'heory', kind: 'member', avatar_url: null };
const agentActor = (key: string): Actor => {
  const c = ROSTER.find((r) => r.key === key);
  if (!c) throw new Error(`名册里没有 ${key}`);
  return { id: c.agentId, name: c.name + '｜' + c.title, kind: 'agent', avatar_url: null };
};

/* ─────────────── 项目与关卡种子 ─────────────── */

interface IssueSeed {
  identifier: string;
  title: string;
  status: QuestStatus;
  level: QuestLevel;
  project: string;
  stage: number | null;
  assignee: string | null; // 名册 key 或 'heory'
  parent: string | null;   // identifier
  /** deep_link 为 null 的演示位(没配模板时按钮要消失) */
  noLink?: boolean;
}

const PROJECTS: Array<{ id: string; title: string; icon: string | null; status: string | null }> = [
  { id: uid('proj-cockpit'), title: 'AetherLab 指挥舱', icon: '🛰️', status: 'active' },
  { id: uid('proj-pipeline'), title: '工坊 CI 流水线', icon: '⚙️', status: 'active' },
  { id: uid('proj-site'), title: '官网改版', icon: '🌐', status: 'done' },
];
const PROJ = Object.fromEntries(PROJECTS.map((p) => [p.title, p.id])) as Record<string, string>;

const ISSUES: IssueSeed[] = [
  // ── AetherLab 指挥舱(镜像真实推进节奏)──
  { identifier: 'MTM-274', title: 'AetherLab 指挥舱:像素风智能体工作中心(一期)', status: 'in_progress', level: 'high', project: 'AetherLab 指挥舱', stage: null, assignee: 'shen', parent: null },
  { identifier: 'MTM-275', title: '指挥舱地基:技术栈、数据契约与仓库骨架', status: 'done', level: 'high', project: 'AetherLab 指挥舱', stage: 1, assignee: 'zhou', parent: 'MTM-274' },
  { identifier: 'MTM-276', title: '指挥舱像素视觉:定风格 + 13 角色 4 态立绘', status: 'done', level: 'high', project: 'AetherLab 指挥舱', stage: 1, assignee: 'su', parent: 'MTM-274' },
  { identifier: 'MTM-277', title: '指挥舱前端初版:能点能走的五屏骨架', status: 'in_progress', level: 'high', project: 'AetherLab 指挥舱', stage: 2, assignee: 'ce', parent: 'MTM-274' },
  { identifier: 'MTM-278', title: '指挥舱真数据聚合 + 派活/喊话写操作', status: 'todo', level: 'high', project: 'AetherLab 指挥舱', stage: 3, assignee: 'han', parent: 'MTM-274' },
  { identifier: 'MTM-279', title: '指挥舱一期收口:五场景走查与验收', status: 'todo', level: 'medium', project: 'AetherLab 指挥舱', stage: 3, assignee: 'gu', parent: 'MTM-274' },
  { identifier: 'MTM-281', title: '像素中文字体候选调研(Zpix / Fusion / Ark)', status: 'in_review', level: 'low', project: 'AetherLab 指挥舱', stage: null, assignee: 'su', parent: 'MTM-274' },
  { identifier: 'MTM-270', title: '[发现池] 指挥舱一期', status: 'backlog', level: 'none', project: 'AetherLab 指挥舱', stage: null, assignee: null, parent: null, noLink: true },
  { identifier: 'MTM-259', title: '指挥舱需求梳理:游戏映射与五场景', status: 'done', level: 'medium', project: 'AetherLab 指挥舱', stage: null, assignee: 'lin', parent: null },
  // ── 工坊 CI 流水线(失败与卡死的演示位)──
  { identifier: 'MTM-262', title: '移动端构建机接入流水线', status: 'in_progress', level: 'urgent', project: '工坊 CI 流水线', stage: 1, assignee: 'tang', parent: null },
  { identifier: 'MTM-263', title: 'CI 缓存层修复:命中率掉到 3 成', status: 'in_progress', level: 'high', project: '工坊 CI 流水线', stage: 1, assignee: 'han', parent: null },
  { identifier: 'MTM-264', title: '流水线密钥轮换自动化', status: 'blocked', level: 'high', project: '工坊 CI 流水线', stage: 2, assignee: 'liang', parent: null },
  { identifier: 'MTM-265', title: '构建产物签名校验', status: 'todo', level: 'medium', project: '工坊 CI 流水线', stage: 2, assignee: null, parent: null },
  { identifier: 'MTM-269', title: '工坊冒烟走查:主流程回归', status: 'in_progress', level: 'medium', project: '工坊 CI 流水线', stage: null, assignee: 'gu', parent: null },
  { identifier: 'MTM-260', title: 'v0.2.0 发版收尾', status: 'done', level: 'medium', project: '工坊 CI 流水线', stage: null, assignee: 'liang', parent: null },
  { identifier: 'MTM-261', title: '旧构建脚本清理(方案作废)', status: 'cancelled', level: 'low', project: '工坊 CI 流水线', stage: null, assignee: null, parent: null },
  // ── 官网改版(全通关的演示位)──
  { identifier: 'MTM-240', title: '首页视觉与文案重写', status: 'done', level: 'high', project: '官网改版', stage: 1, assignee: 'su', parent: null },
  { identifier: 'MTM-241', title: '产品页信息架构梳理', status: 'done', level: 'medium', project: '官网改版', stage: 1, assignee: 'lin', parent: null },
  { identifier: 'MTM-242', title: '前端实现与响应式适配', status: 'done', level: 'high', project: '官网改版', stage: 2, assignee: 'xu', parent: null },
  { identifier: 'MTM-243', title: '上线检查单与 DNS 切换', status: 'done', level: 'medium', project: '官网改版', stage: null, assignee: 'liang', parent: null },
  // ── 跨项目杂项(Mika 的多线作战)──
  { identifier: 'MTM-272', title: '跨项目排期对齐:九月里程碑', status: 'in_progress', level: 'medium', project: '工坊 CI 流水线', stage: null, assignee: 'mika', parent: null },
  { identifier: 'MTM-271', title: '九月第一周里程碑周报', status: 'in_progress', level: 'low', project: 'AetherLab 指挥舱', stage: null, assignee: 'qin', parent: 'MTM-274' },
];

const issueByIdent = Object.fromEntries(ISSUES.map((s) => [s.identifier, s]));

function issueRef(identifier: string): IssueRef {
  const s = issueByIdent[identifier];
  if (!s) throw new Error(`mock 里没有 issue ${identifier}`);
  return {
    issue_id: uid(s.identifier),
    identifier: s.identifier,
    title: s.title,
    status: s.status,
    status_raw: s.status,
    level: s.level,
    project_id: PROJ[s.project] ?? null,
    deep_link: s.noLink ? null : issueLink(s.identifier),
  } satisfies IssueRef;
}

/* ─────────────── 战斗种子 ─────────────── */

interface BattleSeed {
  key: string;               // 稳定种子,uid() 变 task_id
  agent: string;             // 名册 key
  status: BattleStatus;
  issue: string | null;      // identifier;chat 等无怪战斗为 null
  kind?: Battle['kind'];
  /** 相对 origin 的开打时刻(毫秒,负数=过去) */
  startAgo: number;
  /** 已结束战斗的时长;running 时不填 */
  durationMs?: number;
  attempt?: number;
  maxAttempts?: number;
  failureReason?: string;
  errorText?: string;
  output?: string;
  outputTruncated?: boolean;
  deliveredComments?: number;
  from?: string | null;      // 上一棒 BattleSeed.key;'ghost:' 前缀 = 查不到的老数据
  lineage?: Partial<Lineage>;
  initiator?: Actor;
}

const BATTLES: BattleSeed[] = [
  /* ── MTM-277 主接力链(战斗回放的招牌样例)── */
  {
    key: 'lin-259-a1', agent: 'lin', status: 'won', issue: 'MTM-259', startAgo: -3 * DAY, durationMs: 22 * MIN,
    output: '梳理完毕:游戏映射表(角色=智能体、关卡=issue、章节=项目)与五个验收场景已写入 MTM-274,黑盒焦虑是第一目标。',
    deliveredComments: 2, from: null, initiator: HEORY,
    lineage: { source: 'direct_human', source_raw: 'direct_human', evidence_kind: 'issue_assignment' },
  },
  {
    key: 'shen-274-a1', agent: 'shen', status: 'won', issue: 'MTM-274', startAgo: -2.8 * DAY, durationMs: 18 * MIN,
    output: '一期拆成四拍串行:①周构定契约与骨架 ②苏绘定皮肤立绘 ③策衡出前端初版 ④韩程接真数据与写操作。第 1 拍已派出。',
    deliveredComments: 1, from: 'lin-259-a1',
  },
  {
    key: 'zhou-275-a1', agent: 'zhou', status: 'won', issue: 'MTM-275', startAgo: -2.5 * DAY, durationMs: 3 * HOUR + 12 * MIN,
    output: '交付:数据契约 src/contract/types.ts + BFF 骨架(/api/roster 真数据,其余 501)+ 分档轮询 + 安全闸。93 条单测全绿。',
    outputTruncated: true, deliveredComments: 1, from: 'shen-274-a1',
  },
  {
    key: 'su-276-a1', agent: 'su', status: 'won', issue: 'MTM-276', startAgo: -1.2 * DAY, durationMs: 5 * HOUR + 4 * MIN,
    output: '交付:主题 A「深空指挥舱」定稿 + 13 角色 × 4 态立绘(代码生成,零图片文件)+ 像素 UI 皮肤与样张页。对比度补到 WCAG AA。',
    deliveredComments: 2, from: 'zhou-275-a1',
  },
  {
    key: 'ce-277-a1', agent: 'ce', status: 'running', issue: 'MTM-277', startAgo: -47 * MIN,
    from: 'su-276-a1', maxAttempts: 2,
  },

  /* ── 顾检:失败可重试(卡住)+ 断链样例 ── */
  {
    key: 'gu-269-a2', agent: 'gu', status: 'lost', issue: 'MTM-269', startAgo: -55 * MIN, durationMs: 30 * MIN,
    attempt: 1, maxAttempts: 2, failureReason: 'agent_error.unknown',
    errorText: 'Run 在走查第 41 步时中断:上游没有返回可解析的结果(agent_error.unknown)。平台将在冷却后重试。',
    from: 'ghost:gu-269-a0',
    lineage: { source: 'owner_fallback', source_raw: 'owner_fallback', precise: false, evidence_kind: 'unknown' },
  },
  { key: 'gu-268-a1', agent: 'gu', status: 'won', issue: 'MTM-260', startAgo: -1.5 * DAY, durationMs: 41 * MIN, output: '发版检查单 21 项全过,tag v0.2.0 验收 PASS。', deliveredComments: 1, from: null },
  { key: 'gu-267-a1', agent: 'gu', status: 'won', issue: 'MTM-242', startAgo: -4 * DAY, durationMs: 58 * MIN, output: '官网改版验收 PASS:响应式断点与可访问性抽查通过。', deliveredComments: 1, from: null },
  { key: 'gu-266-a1', agent: 'gu', status: 'aborted', issue: 'MTM-241', startAgo: -6 * DAY, from: null },

  /* ── 唐端:重试用尽(失败)── */
  {
    key: 'tang-262-a3', agent: 'tang', status: 'lost', issue: 'MTM-262', startAgo: -2.5 * HOUR, durationMs: 25 * MIN,
    attempt: 3, maxAttempts: 3, failureReason: 'agent_error.provider_quota_limit',
    errorText: '模型配额触顶(agent_error.provider_quota_limit),3 次重试用尽。需要人工确认配额或改派。',
    from: null,
  },
  { key: 'tang-262-a2', agent: 'tang', status: 'lost', issue: 'MTM-262', startAgo: -4 * HOUR, durationMs: 22 * MIN, attempt: 2, maxAttempts: 3, failureReason: 'agent_error.provider_quota_limit', errorText: '模型配额触顶,自动重试中。', from: null },
  { key: 'tang-250-a1', agent: 'tang', status: 'won', issue: 'MTM-243', startAgo: -8 * DAY, durationMs: 33 * MIN, output: '上线前移动端回归完成。', from: null },

  /* ── 战斗中的三条 + Mika 双线 ── */
  { key: 'han-263-a1', agent: 'han', status: 'running', issue: 'MTM-263', startAgo: -12 * MIN, maxAttempts: 3 },
  { key: 'qin-271-a1', agent: 'qin', status: 'running', issue: 'MTM-271', startAgo: -8 * MIN },
  { key: 'mika-272-a1', agent: 'mika', status: 'running', issue: 'MTM-272', startAgo: -93 * MIN },
  {
    key: 'mika-chat-a1', agent: 'mika', status: 'running', issue: null, kind: 'chat', startAgo: -4 * MIN,
    initiator: HEORY, lineage: { source: 'direct_human', source_raw: 'direct_human', evidence_kind: 'chat' },
  },

  /* ── 已收工者的最近一战 ── */
  { key: 'han-263-a0', agent: 'han', status: 'won', issue: 'MTM-263', startAgo: -1 * DAY, durationMs: 66 * MIN, output: '缓存键规则修正,命中率回到 92%。', deliveredComments: 1, from: null },
  { key: 'xu-242-a1', agent: 'xu', status: 'won', issue: 'MTM-242', startAgo: -5 * DAY, durationMs: 4 * HOUR, output: '官网前端实现完成,四个断点走查通过。', deliveredComments: 1, from: null },
  { key: 'liang-260-a1', agent: 'liang', status: 'won', issue: 'MTM-260', startAgo: -2 * DAY, durationMs: 52 * MIN, output: 'v0.2.0 打 tag 并部署,回滚脚本演练通过。', deliveredComments: 1, from: null },
  { key: 'qin-271-a0', agent: 'qin', status: 'won', issue: 'MTM-271', startAgo: -7 * DAY, durationMs: 21 * MIN, output: '八月周报归档。', from: null },
  { key: 'mika-old-a1', agent: 'mika', status: 'won', issue: null, kind: 'quick_create', startAgo: -3 * DAY, durationMs: 9 * MIN, output: '日程冲突已协调。', from: null, initiator: HEORY, lineage: { source: 'direct_human', source_raw: 'direct_human', evidence_kind: 'chat' } },
  { key: 'help-old-a1', agent: 'help', status: 'won', issue: null, kind: 'quick_create', startAgo: -9 * DAY, durationMs: 3 * MIN, output: '工作区初始化引导完成。', from: null, initiator: HEORY, lineage: { source: 'direct_human', source_raw: 'direct_human', evidence_kind: 'chat' } },
  { key: 'shen-273-a1', agent: 'shen', status: 'won', issue: 'MTM-274', startAgo: -10 * HOUR, durationMs: 11 * MIN, output: '第 1 拍收口:契约与皮肤都在主干,放行第 2 拍(策衡)。', deliveredComments: 1, from: null },
  { key: 'zhou-old-a1', agent: 'zhou', status: 'won', issue: 'MTM-263', startAgo: -6 * DAY, durationMs: 44 * MIN, output: '缓存层边界评审意见已回。', from: null },
  { key: 'su-240-a1', agent: 'su', status: 'won', issue: 'MTM-240', startAgo: -9 * DAY, durationMs: 3 * HOUR, output: '首页视觉定稿。', from: null },
  { key: 'lin-241-a1', agent: 'lin', status: 'won', issue: 'MTM-241', startAgo: -9 * DAY, durationMs: 90 * MIN, output: '产品页信息架构梳理完成。', from: null },
  { key: 'ce-old-a1', agent: 'ce', status: 'won', issue: 'MTM-240', startAgo: -10 * DAY, durationMs: 2 * HOUR, output: '首页文案与信息层级初版。', from: null },
];

/* ─────────────── 角色档案(状态编排 + 技能 + 战绩) ─────────────── */

interface AgentSeed {
  key: string;
  state: BattleState | 'loading'; // loading = 开机相位 battles_loaded=false
  reason: string;
  classDesc: string;
  model: string;
  currentKeys: string[];
  lastKey: string | null;
  /** win_rate 与 last_active_at 由世界现算,种子里只给原始计数 */
  stats: Omit<AgentStats, 'mana' | 'win_rate' | 'last_active_at'>;
  skills: Array<[name: string, desc: string]>;
  runtime?: 'main' | 'helper';
  noLink?: boolean;
}

const SKILL_COMMON: Array<[string, string]> = [
  ['multica-platform', '平台协作契约:issue / PR / 交接的队规'],
  ['git-workflow', 'AetherLab 的 git 协作与收尾规矩'],
];

const AGENTS: AgentSeed[] = [
  {
    key: 'shen', state: 'waiting', reason: '名下 MTM-274 的子任务都在推进,活派下去了,等接力回来',
    classDesc: '总指挥:拆解任务、派棒、收口合并;全队唯一有合并权的人。', model: 'claude-fable-5',
    currentKeys: [], lastKey: 'shen-273-a1',
    stats: { total: 344, won: 313, lost: 31, aborted: 0, running: 0, retried: 12 },
    skills: [...SKILL_COMMON, ['dispatch-playbook', '拆拍与派单的判断手册']],
  },
  {
    key: 'ce', state: 'fighting', reason: '正在打 MTM-277(指挥舱前端初版)',
    classDesc: '产品官:把需求直接做成能演示、能操作的前端初版。', model: 'claude-fable-5',
    currentKeys: ['ce-277-a1'], lastKey: 'ce-old-a1',
    stats: { total: 41, won: 37, lost: 3, aborted: 1, running: 1, retried: 2 },
    skills: [...SKILL_COMMON, ['design-taste-frontend', '反模板化的前端品味'], ['verification-before-completion', '先验证再宣布完成'], ['full-output-enforcement', '禁止截断与占位输出']],
  },
  {
    key: 'lin', state: 'idle', reason: '手上没有在跑的战斗',
    classDesc: '需求官:把一句话的想法问成可执行的验收标准。', model: 'claude-opus-5',
    currentKeys: [], lastKey: 'lin-259-a1',
    stats: { total: 58, won: 54, lost: 2, aborted: 2, running: 0, retried: 1 },
    skills: [...SKILL_COMMON, ['requirement-interview', '需求访谈与场景走查']],
  },
  {
    key: 'zhou', state: 'idle', reason: '手上没有在跑的战斗',
    classDesc: '架构师:定边界、定契约,谁能碰谁说了算。', model: 'claude-fable-5',
    currentKeys: [], lastKey: 'zhou-275-a1',
    stats: { total: 77, won: 71, lost: 4, aborted: 2, running: 0, retried: 3 },
    skills: [...SKILL_COMMON, ['architecture-review', '边界与依赖方向评审']],
  },
  {
    key: 'han', state: 'fighting', reason: '正在打 MTM-263(CI 缓存层修复)',
    classDesc: '后端:数据聚合、接口实现、性能兜底。', model: 'claude-fable-5',
    currentKeys: ['han-263-a1'], lastKey: 'han-263-a0',
    stats: { total: 96, won: 88, lost: 6, aborted: 2, running: 1, retried: 4 },
    skills: [...SKILL_COMMON, ['verification-before-completion', '先验证再宣布完成']],
  },
  {
    key: 'xu', state: 'loading', reason: '战斗数据这一轮还没拉到(温档轮询中)',
    classDesc: '前端:把界面写到像素级还原。', model: 'claude-sonnet-5',
    currentKeys: [], lastKey: 'xu-242-a1',
    stats: { total: 63, won: 59, lost: 3, aborted: 1, running: 0, retried: 2 },
    skills: [...SKILL_COMMON, ['design-taste-frontend', '反模板化的前端品味']],
  },
  {
    key: 'su', state: 'idle', reason: '手上没有在跑的战斗',
    classDesc: 'UI/UX:视觉风格与体验的把关人。', model: 'claude-opus-5',
    currentKeys: [], lastKey: 'su-276-a1',
    stats: { total: 49, won: 46, lost: 2, aborted: 1, running: 0, retried: 1 },
    skills: [...SKILL_COMMON, ['design-taste-frontend', '反模板化的前端品味'], ['redesign-existing-projects', '存量界面的高端化改造']],
  },
  {
    key: 'tang', state: 'defeated', reason: '最近一战失败,3 次重试已用尽(agent_error.provider_quota_limit)',
    classDesc: '移动端:双端构建与真机适配。', model: 'claude-sonnet-5',
    currentKeys: [], lastKey: 'tang-262-a3',
    stats: { total: 52, won: 44, lost: 6, aborted: 2, running: 0, retried: 5 },
    skills: [...SKILL_COMMON, ['mobile-build', '双端流水线与签名']],
  },
  {
    key: 'gu', state: 'stalled', reason: '最近一战失败,等第 2 次重试(agent_error.unknown)',
    classDesc: '质量官:验收的最后一道闸,PASS 才放行合并。', model: 'claude-fable-5',
    currentKeys: [], lastKey: 'gu-269-a2',
    stats: { total: 121, won: 109, lost: 8, aborted: 4, running: 0, retried: 6 },
    skills: [...SKILL_COMMON, ['verification-before-completion', '先验证再宣布完成'], ['acceptance-checklist', '验收清单与回归走查']],
  },
  {
    key: 'liang', state: 'loading', reason: '战斗数据这一轮还没拉到(温档轮询中)',
    classDesc: '运维:发版、监控、回滚,生产永远能退回上一步。', model: 'claude-sonnet-5',
    currentKeys: [], lastKey: 'liang-260-a1',
    stats: { total: 70, won: 66, lost: 2, aborted: 2, running: 0, retried: 1 },
    skills: [...SKILL_COMMON, ['release-runbook', '发版手册与回滚演练']],
  },
  {
    key: 'qin', state: 'fighting', reason: '正在打 MTM-271(里程碑周报)',
    classDesc: '项目经理:排期、里程碑、风险台账。', model: 'claude-sonnet-5',
    currentKeys: ['qin-271-a1'], lastKey: 'qin-271-a0',
    stats: { total: 88, won: 84, lost: 2, aborted: 2, running: 1, retried: 1 },
    skills: [...SKILL_COMMON, ['milestone-tracking', '里程碑与依赖追踪']],
  },
  {
    key: 'mika', state: 'fighting', reason: '同时在打 2 场:MTM-272 + heory 的即时问答',
    classDesc: 'Chief of Staff:跨项目协调与 heory 的第一接口人。', model: 'claude-fable-5',
    currentKeys: ['mika-272-a1', 'mika-chat-a1'], lastKey: 'mika-old-a1',
    stats: { total: 132, won: 126, lost: 3, aborted: 3, running: 2, retried: 2 },
    skills: [...SKILL_COMMON, ['cross-project-sync', '跨项目信息同步']],
  },
  {
    key: 'help', state: 'offline', reason: '所在运行时「Multica 内置沙盒」不在线',
    classDesc: '内置助手:平台自带的引导与答疑机体。', model: 'claude-haiku-4-5',
    currentKeys: [], lastKey: 'help-old-a1',
    stats: { total: 12, won: 12, lost: 0, aborted: 0, running: 0, retried: 0 },
    skills: [['platform-guide', '平台功能引导']],
    runtime: 'helper', noLink: true,
  },
];

/* ─────────────── 世界本体 ─────────────── */

export interface MockWorld {
  roster(): Roster;
  agent(id: string): AgentDetail | null;
  projects(): ProjectRef[];
  campaign(projectId: string): CampaignMap | null;
  chain(taskId: string): BattleChain | null;
  /** 按 issue 查战斗(mock 世界里战斗本来就挂在关卡上,直接过滤)。 */
  issueBattles(issueId: string): Battle[];
  /** 重新演一遍「战绩加载中」相位(演示用)。 */
  resetLoading(): void;
}

export function createWorld(now: () => number = Date.now): MockWorld {
  const origin = now();
  let loadStart = origin;

  const seedByKey = Object.fromEntries(BATTLES.map((b) => [b.key, b]));

  /** 种子 → 契约 Battle。running 的耗时按注入时钟现算,所以它会一直涨。 */
  function materialize(seed: BattleSeed): Battle {
    const startedAt = origin + seed.startAgo;
    const completedAt = seed.status === 'running' || seed.durationMs == null ? null : startedAt + seed.durationMs;
    const statusRaw: Record<BattleStatus, string> = { running: 'running', won: 'completed', lost: 'failed', aborted: 'cancelled', unknown: 'unknown' };
    const attempt = seed.attempt ?? 1;
    const fromGhost = seed.from?.startsWith('ghost:') ?? false;
    const fromKey = fromGhost ? null : (seed.from ?? null);
    const lineage: Lineage = {
      source: 'delegation',
      source_raw: 'delegation',
      precise: true,
      from_task_id: fromGhost ? uid(seed.from!.slice('ghost:'.length)) : (fromKey ? uid(fromKey) : null),
      from_resolved: fromGhost ? false : fromKey != null,
      evidence_kind: 'issue_assignment',
      evidence_kind_raw: null,
      evidence_ref_id: seed.issue ? uid(seed.issue) : null,
      initiator: seed.initiator ?? agentActor('shen'),
      originator: HEORY,
      ...seed.lineage,
    };
    if (fromKey == null && !fromGhost && !seed.lineage?.source) {
      lineage.source = 'direct_human';
      lineage.source_raw = 'direct_human';
      lineage.initiator = seed.initiator ?? HEORY;
    }
    return {
      task_id: uid(seed.key),
      agent_id: ROSTER.find((r) => r.key === seed.agent)!.agentId,
      status: seed.status,
      status_raw: statusRaw[seed.status],
      kind: seed.kind ?? 'issue',
      kind_raw: seed.kind ?? 'issue',
      issue: seed.issue ? issueRef(seed.issue) : null,
      attempt,
      max_attempts: seed.maxAttempts ?? 2,
      retries: attempt - 1,
      created_at: iso(startedAt - 30_000),
      started_at: seed.status === 'aborted' && seed.durationMs == null ? null : iso(startedAt),
      completed_at: completedAt == null ? null : iso(completedAt),
      elapsed_ms:
        seed.status === 'aborted' && seed.durationMs == null ? null
          : seed.status === 'running' ? Math.max(0, now() - startedAt)
            : seed.durationMs ?? null,
      failure_reason: seed.failureReason ?? null,
      failure_kind: seed.failureReason ? (seed.failureReason.startsWith('agent_error.') ? 'agent' : 'runtime') : null,
      error_text: seed.errorText ?? null,
      output_excerpt: seed.status === 'won' ? seed.output ?? null : null,
      output_truncated: seed.outputTruncated ?? false,
      pr_url: null,
      delivered_comment_ids: Array.from({ length: seed.deliveredComments ?? 0 }, (_, i) => uid(`${seed.key}-c${i}`)),
      lineage,
    } satisfies Battle;
  }

  const loadingDone = () => now() >= loadStart + LOAD_DELAY_MS;

  function rosterEntry(seed: AgentSeed): RosterEntry {
    const c = ROSTER.find((r) => r.key === seed.key)!;
    const loading = seed.state === 'loading' && !loadingDone();
    const state: BattleState = seed.state === 'loading' ? (loading ? 'unknown' : 'idle') : seed.state;
    const last = seed.lastKey ? materialize(seedByKey[seed.lastKey]!) : null;
    const stats: AgentStats | null = loading ? null : {
      total: seed.stats.total,
      won: seed.stats.won,
      lost: seed.stats.lost,
      aborted: seed.stats.aborted,
      running: seed.stats.running,
      win_rate: seed.stats.won + seed.stats.lost === 0 ? null : seed.stats.won / (seed.stats.won + seed.stats.lost),
      retried: seed.stats.retried,
      last_active_at: last?.completed_at ?? last?.started_at ?? null,
      mana: null, // 契约:一期恒 null,token 摊不到人头
    };
    return {
      agent_id: c.agentId,
      name: `${c.name}｜${c.title}`,
      display_name: c.name,
      role_title: c.title,
      avatar_url: null,
      class_desc: seed.classDesc,
      model: seed.model,
      runtime_id: seed.runtime === 'helper' ? uid('rt-helper') : uid('rt-main'),
      runtime_status: seed.state === 'offline' ? 'offline' : 'online',
      state,
      state_reason: loading ? '战斗数据这一轮还没拉到(温档轮询中)' : (seed.state === 'loading' ? '手上没有在跑的战斗' : seed.reason),
      battles_loaded: !loading,
      current_battles: loading ? [] : seed.currentKeys.map((k) => materialize(seedByKey[k]!)),
      last_battle: loading ? null : last,
      stats,
      deep_link: seed.noLink ? null : `${LINK_BASE}/agent/${c.agentId}`,
    } satisfies RosterEntry;
  }

  function buildRoster(): Roster {
    const entries = AGENTS.map(rosterEntry);
    const counts = Object.fromEntries(BATTLE_STATES.map((s) => [s, 0])) as Record<BattleState, number>;
    for (const e of entries) counts[e.state] += 1;
    return { entries, counts } satisfies Roster;
  }

  function agentDetail(id: string): AgentDetail | null {
    const seed = AGENTS.find((a) => ROSTER.find((r) => r.key === a.key)!.agentId === id);
    if (!seed) return null;
    const entry = rosterEntry(seed);
    const mine = BATTLES
      .filter((b) => b.agent === seed.key)
      .map(materialize)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 20);
    const skills: SkillSlot[] = seed.skills.map(([name, description]) => ({
      skill_id: uid(`skill-${name}`),
      name,
      description,
      enabled: true,
      source: 'workspace',
    }));
    return {
      ...entry,
      skills,
      equipment: [], // 复刻实测:13 人零 MCP。界面必须画得出「装备栏空着」。
      recent_battles: entry.battles_loaded ? mine : [],
      squad_ids: seed.key === 'help' ? [] : [uid('squad-aetherlab')],
    } satisfies AgentDetail;
  }

  function projectRefs(): ProjectRef[] {
    return PROJECTS.map((p) => {
      const mine = ISSUES.filter((s) => s.project === p.title);
      return {
        project_id: p.id,
        title: p.title,
        icon: p.icon,
        status: p.status,
        issue_count: mine.length,
        done_count: mine.filter((s) => s.status === 'done').length,
        deep_link: `${LINK_BASE}/project/${p.id}`,
      } satisfies ProjectRef;
    });
  }

  function questNode(seed: IssueSeed): QuestNode {
    const assigneeSeed = seed.assignee ? AGENTS.find((a) => a.key === seed.assignee) ?? null : null;
    const assignee: Actor | null =
      seed.assignee === 'heory' ? HEORY : assigneeSeed ? agentActor(assigneeSeed.key) : null;
    const battleState = assigneeSeed ? rosterEntry(assigneeSeed).state : null;
    const created = origin - 6 * DAY;
    return {
      issue_id: uid(seed.identifier),
      identifier: seed.identifier,
      title: seed.title,
      status: seed.status,
      status_raw: seed.status,
      status_category: seed.status,
      level: seed.level,
      level_raw: seed.level,
      stage: seed.stage,
      parent_issue_id: seed.parent ? uid(seed.parent) : null,
      assignee,
      assignee_battle_state: assignee?.kind === 'agent' ? battleState : null,
      created_at: iso(created),
      updated_at: iso(origin - 2 * HOUR),
      last_activity_at: iso(origin - 20 * MIN),
      deep_link: seed.noLink ? null : issueLink(seed.identifier),
    } satisfies QuestNode;
  }

  function campaign(projectId: string): CampaignMap | null {
    const p = PROJECTS.find((x) => x.id === projectId);
    if (!p) return null;
    const nodes = ISSUES.filter((s) => s.project === p.title).map(questNode);
    const staged = nodes.filter((n) => n.stage != null);
    const stageNums = [...new Set(staged.map((n) => n.stage!))].sort((a, b) => a - b);
    const stages: CampaignStage[] = stageNums.map((num) => {
      const quests = staged.filter((n) => n.stage === num);
      return {
        stage: num,
        total: quests.length,
        done: quests.filter((q) => q.status_category === 'done').length,
        quests,
      };
    });
    const all = nodes;
    const failed = all.filter((q) => q.status_category === 'blocked' || q.assignee_battle_state === 'defeated').length;
    const ref = projectRefs().find((r) => r.project_id === projectId)!;
    return {
      project: ref,
      stages,
      unstaged: nodes.filter((n) => n.stage == null),
      totals: {
        total: all.length,
        done: all.filter((q) => q.status_category === 'done').length,
        failed,
        in_progress: all.filter((q) => q.status_category === 'in_progress').length,
      },
    } satisfies CampaignMap;
  }

  function chain(taskId: string): BattleChain | null {
    const focusSeed = BATTLES.find((b) => uid(b.key) === taskId);
    if (!focusSeed) return null;
    // 从 focus 往上追到链首(或断口),再正序输出
    const up: BattleSeed[] = [focusSeed];
    let broken = false;
    let cur = focusSeed;
    for (let i = 0; i < 30; i++) {
      if (!cur.from) break;
      if (cur.from.startsWith('ghost:')) { broken = true; break; }
      const prev = seedByKey[cur.from];
      if (!prev) { broken = true; break; }
      up.push(prev);
      cur = prev;
    }
    up.reverse();
    const nodes: BattleChainNode[] = up.map((seed, depth) => {
      const b = materialize(seed);
      const c = ROSTER.find((r) => r.key === seed.agent)!;
      return {
        battle: b,
        agent: { agent_id: c.agentId, name: `${c.name}｜${c.title}`, avatar_url: null },
        depth,
        handoff_comment_ids: b.delivered_comment_ids,
      } satisfies BattleChainNode;
    });
    return {
      focus_task_id: taskId,
      nodes,
      broken,
      truncated: false,
    } satisfies BattleChain;
  }

  function issueBattles(issueId: string): Battle[] {
    return BATTLES
      .filter((b) => b.issue && uid(b.issue) === issueId)
      .map(materialize);
  }

  return {
    roster: buildRoster,
    agent: agentDetail,
    projects: projectRefs,
    campaign,
    chain,
    issueBattles,
    resetLoading: () => { loadStart = now(); },
  };
}
