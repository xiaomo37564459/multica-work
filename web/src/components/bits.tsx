/**
 * 小零件:立绘 / 头像兜底 / 状态灯 / 等级点 / 跳回本体 / 骨架屏 / 空态错误态。
 * 全部只用苏绘皮肤(pc-*)+ 少量 app.css 布局胶水,不写死任何色值。
 */
import type { ReactNode } from 'react';
import type { ApiError, BattleState, QuestLevel } from '@contract';
import { byAgentId } from '@pixel/sprites/roster.js';
import { levelPips, parseAvatarUrl, stateUi } from '../lib/states.ts';

/* ─────────── 立绘与头像 ─────────── */

/**
 * 像素立绘。agent 传 Multica 的 agent_id(苏绘的自定义元素两种都认)。
 * 不在名册里的角色(以后新加的人立绘还没画)→ 退回 avatar_url 的三种形态。
 */
export function Sprite(props: {
  agentId: string;
  state: BattleState | string;
  scale?: number;
  avatarUrl?: string | null;
  animate?: boolean;
}) {
  const known = Boolean(byAgentId[props.agentId]);
  if (known) {
    return (
      <pixel-avatar
        agent={props.agentId}
        state={props.state}
        scale={props.scale ?? 4}
        animate={props.animate === false ? 'false' : undefined}
      />
    );
  }
  const src = parseAvatarUrl(props.avatarUrl ?? null);
  if (src.kind === 'emoji') return <span className="app-avatar-fallback" role="img">{src.value}</span>;
  if (src.kind === 'image') return <img className="app-avatar-fallback" src={src.value} alt="" />;
  return <span className="app-avatar-fallback" role="img" aria-label="未知角色">?</span>;
}

/** 头像片:整张立绘塞进小窗口只露头(苏绘 pc-face 的用法)。 */
export function Face(props: { agentId: string; state?: BattleState | string; sm?: boolean; className?: string }) {
  const cls = ['pc-face', props.sm ? 'pc-face--sm' : '', props.className ?? ''].filter(Boolean).join(' ');
  return (
    <span className={cls}>
      <Sprite agentId={props.agentId} state={props.state ?? 'idle'} animate={false} />
    </span>
  );
}

/* ─────────── 状态灯 / 状态胶囊 ─────────── */

export function Lamp(props: { state: BattleState | string; title?: string }) {
  const ui = stateUi(props.state);
  return <span className={`pc-lamp ${ui.lamp}`} title={props.title} aria-label={ui.label} />;
}

export function StatePill(props: { state: BattleState | string; title?: string }) {
  const ui = stateUi(props.state);
  const tone = ui.lamp.replace('pc-lamp--', 'pc-status--');
  return (
    <span className={`pc-status ${tone}`} title={props.title}>
      <span className={`pc-lamp ${ui.lamp}`} aria-hidden />
      {ui.label}
    </span>
  );
}

/* ─────────── 怪物等级 ─────────── */

export function LevelPips(props: { level: QuestLevel | string; withLabel?: boolean }) {
  const { pips, urgent, label } = levelPips(props.level);
  return (
    <span className={`pc-lv ${urgent ? 'pc-lv--urgent' : ''}`} title={`怪物等级:${label}`}>
      {props.withLabel !== false && <span>等级</span>}
      {[1, 2, 3, 4].map((i) => (
        <i key={i} className={`pc-lv__pip ${i <= pips ? 'pc-lv__pip--on' : ''}`} />
      ))}
    </span>
  );
}

/* ─────────── 跳回本体 ─────────── */

/** deep_link 为 null(没配跳转模板)时什么都不画 —— 契约硬要求,不给死按钮。 */
export function DeepLink(props: { href: string | null; children?: ReactNode; small?: boolean }) {
  if (!props.href) return null;
  return (
    <a
      className={`pc-btn pc-btn--ghost ${props.small === false ? '' : 'pc-btn--sm'}`}
      data-deeplink
      href={props.href}
      target="_blank"
      rel="noreferrer"
      title="跳回 Multica 本体"
    >
      {props.children ?? '↗ 跳回本体'}
    </a>
  );
}

/* ─────────── 骨架 / 空态 / 错误态 ─────────── */

export function SkelLine(props: { w?: string }) {
  return <span className="pc-skel app-skel-line" style={props.w ? { width: props.w } : undefined} aria-hidden />;
}

export function EmptyBox(props: { children: ReactNode }) {
  return <div className="pc-empty">{props.children}</div>;
}

/**
 * 错误态。501 not_implemented 单独一种口吻:那不是坏了,是下一棒(MTM-278)还没接。
 */
export function ErrorBox(props: { error: ApiError; onRetry?: () => void; homeLink?: boolean }) {
  const notImpl = props.error.code === 'not_implemented';
  return (
    <div className={notImpl ? 'pc-empty' : 'pc-error'} role="alert">
      <div>{notImpl ? '⛏ 这个操作在演示数据下不可用' : `✕ ${props.error.message}`}</div>
      {notImpl && <div className="pc-dim">{props.error.message}</div>}
      {notImpl && <div className="pc-dim">切顶栏「切真数据」后再用;读接口在真数据模式下全部可用。</div>}
      <div className="app-row">
        {props.onRetry && props.error.retryable && (
          <button type="button" className="pc-btn pc-btn--sm" onClick={props.onRetry}>再试一次</button>
        )}
        {props.homeLink && <a className="pc-btn pc-btn--sm" href="#/">回主视图</a>}
      </div>
    </div>
  );
}
