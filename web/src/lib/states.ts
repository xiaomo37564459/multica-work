/**
 * 七种契约状态(BattleState)→ 界面语义的唯一映射表。
 * 全站只许从这里取状态的中文名、灯样式、卡片修饰 —— 散写到组件里就会出现
 * 「同一状态两处叫法不一样」这种验收必挂的问题。
 *
 * 产品口径(docs/data-contract.md 已锁):
 *   - waiting(待接力)不算「卡住」:告警计数只含 defeated / stalled
 *   - waiting 一期不加第五张立绘 —— 空闲立绘 + 角标
 *   - 没见过的状态一律按 unknown 渲染,绝不白屏
 */
import type { BattleState, BattleStatus, QuestLevel, QuestStatus } from '@contract';

export interface StateUi {
  /** 中文状态名(全站唯一叫法) */
  label: string;
  /** 状态灯 class(pixel/components.css 的 pc-lamp--*) */
  lamp: string;
  /** 角色卡修饰 class(pc-unit--*;waiting 的样式由 web 侧 app.css 补) */
  card: string;
  /** 是否在立绘旁挂「待接力」角标 */
  badge: boolean;
}

export const STATE_UI: Record<BattleState, StateUi> = {
  fighting: { label: '战斗中', lamp: 'pc-lamp--working', card: 'pc-unit--working', badge: false },
  stalled: { label: '卡住', lamp: 'pc-lamp--stuck', card: 'pc-unit--stuck', badge: false },
  defeated: { label: '失败', lamp: 'pc-lamp--failed', card: 'pc-unit--failed', badge: false },
  waiting: { label: '待接力', lamp: 'pc-lamp--waiting', card: 'pc-unit--waiting', badge: true },
  idle: { label: '空闲', lamp: 'pc-lamp--idle', card: 'pc-unit--idle', badge: false },
  offline: { label: '离线', lamp: 'pc-lamp--offline', card: 'pc-unit--offline', badge: false },
  unknown: { label: '状态未知', lamp: 'pc-lamp--unknown', card: 'pc-unit--unknown', badge: false },
};

/** 任何值都能换到一份 UI 语义 —— 契约明说平台以后可能加状态。 */
export function stateUi(state: BattleState | string): StateUi {
  return STATE_UI[state as BattleState] ?? STATE_UI.unknown;
}

/** 场景 1 的「卡住」告警口径:只数这两种。waiting 明确不算。 */
export const ALARM_STATES: readonly BattleState[] = ['defeated', 'stalled'];

/** 主视图排序:需要人出手的排前面,拿不到消息的排最后。 */
export const ATTENTION_ORDER: readonly BattleState[] = [
  'defeated', 'stalled', 'fighting', 'waiting', 'unknown', 'idle', 'offline',
];

/** 按注意力顺序稳定排序(同状态保持传入顺序)。 */
export function sortEntries<T extends { state: BattleState }>(entries: readonly T[]): T[] {
  const rank = (s: BattleState) => {
    const i = ATTENTION_ORDER.indexOf(s);
    return i === -1 ? ATTENTION_ORDER.length : i;
  };
  return entries
    .map((e, i) => [e, i] as const)
    .sort((a, b) => rank(a[0].state) - rank(b[0].state) || a[1] - b[1])
    .map(([e]) => e);
}

/* ─────────────── 怪物等级(= issue 优先级) ─────────────── */

const LEVEL_UI: Record<QuestLevel, { pips: number; urgent: boolean; label: string }> = {
  urgent: { pips: 4, urgent: true, label: '紧急' },
  high: { pips: 3, urgent: false, label: '高' },
  medium: { pips: 2, urgent: false, label: '中' },
  low: { pips: 1, urgent: false, label: '低' },
  none: { pips: 0, urgent: false, label: '无' },
  unknown: { pips: 0, urgent: false, label: '未知' },
};

export function levelPips(level: QuestLevel | string): { pips: number; urgent: boolean; label: string } {
  return LEVEL_UI[level as QuestLevel] ?? LEVEL_UI.unknown;
}

/* ─────────────── 关卡节点(战役地图) ─────────────── */

/**
 * 节点样式:done 点亮 / 进行中发光 / blocked 或出击者全灭标红 / cancelled 封锁纹。
 * 用 status_category(平台状态大类)判,自定义状态不至于走丢。
 */
export function questNodeUi(
  statusCategory: QuestStatus | string,
  assigneeBattleState: BattleState | null,
): { cls: string; mark: string; label: string } {
  if (statusCategory === 'done') return { cls: 'pc-node--done', mark: '✓', label: '已通关' };
  if (statusCategory === 'blocked' || assigneeBattleState === 'defeated') {
    return { cls: 'pc-node--failed', mark: '✕', label: statusCategory === 'blocked' ? '被卡死' : '出击失败' };
  }
  if (statusCategory === 'in_progress' || statusCategory === 'in_review') {
    return { cls: 'pc-node--active', mark: '▶', label: statusCategory === 'in_review' ? '待验收' : '进行中' };
  }
  if (statusCategory === 'cancelled') return { cls: 'pc-node--locked', mark: '—', label: '已取消' };
  if (statusCategory === 'backlog') return { cls: '', mark: '·', label: '待排期' };
  if (statusCategory === 'todo') return { cls: '', mark: '·', label: '待出击' };
  return { cls: '', mark: '?', label: '未知' };
}

/** issue 状态的中文(详情面板用)。 */
export function questStatusLabel(status: QuestStatus | string): string {
  const map: Record<string, string> = {
    todo: '待出击', in_progress: '进行中', in_review: '待验收', done: '已通关',
    blocked: '被卡住', backlog: '待排期', cancelled: '已取消', unknown: '未知',
  };
  return map[status] ?? '未知';
}

/* ─────────────── 头像兜底(avatar_url 三种形态) ─────────────── */

export type AvatarSource =
  | { kind: 'emoji'; value: string }
  | { kind: 'image'; value: string }
  | { kind: 'none' };

/** 契约实测:`emoji:🦋` / `data:image/...` / `https://...` 三种都可能。 */
export function parseAvatarUrl(url: string | null): AvatarSource {
  if (!url) return { kind: 'none' };
  if (url.startsWith('emoji:')) return { kind: 'emoji', value: url.slice('emoji:'.length) };
  return { kind: 'image', value: url };
}

/* ─────────────── 战斗结局 ─────────────── */

export type Tone = 'done' | 'failed' | 'active' | 'muted';

const BATTLE_STATUS_UI: Record<BattleStatus, { label: string; tone: Tone }> = {
  running: { label: '进行中', tone: 'active' },
  won: { label: '胜', tone: 'done' },
  lost: { label: '败', tone: 'failed' },
  aborted: { label: '中止', tone: 'muted' },
  unknown: { label: '未知', tone: 'muted' },
};

export function battleStatusUi(status: BattleStatus | string): { label: string; tone: Tone } {
  return BATTLE_STATUS_UI[status as BattleStatus] ?? BATTLE_STATUS_UI.unknown;
}

/** 失败归因:agent 侧值得人看一眼,runtime 侧通常重试就好(契约注释的原话)。 */
export function failureKindLabel(kind: string | null): string | null {
  if (kind === 'agent') return '智能体侧问题,值得看一眼';
  if (kind === 'runtime') return '运行时侧问题,通常重试即可';
  if (kind === 'unknown') return '原因不明';
  return null;
}
