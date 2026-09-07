/**
 * 角色卡 —— 场景 1 的最小单元:一眼读出这个人「在干嘛、干多久了、顺不顺」。
 *
 * 状态各有各的中栏,不共用一套模板:
 *   fighting  每一场战斗一行(current_battles 是数组!):在打的怪 + 等级 + 已耗时 + 重试
 *   stalled   最近一败 + 还能重试几次
 *   defeated  最近一败 + 重试用尽,该人出手了
 *   waiting   活派下去了 —— 空闲立绘 + 「待接力」角标(pc-flag)
 *   idle      上一战战果
 *   offline   整卡压暗(皮肤 pc-unit--offline 自带斜纹)
 *   unknown   战绩还没拉到 → 骨架屏,绝不显示 0 胜 0 败
 */
import type { CSSProperties } from 'react';
import type { Battle, RosterEntry } from '@contract';
import { byAgentId } from '@pixel/sprites/roster.js';
import { hashOf } from '../router.ts';
import { elapsedOf, fmtAgo, fmtDuration, fmtPercent } from '../lib/format.ts';
import { battleStatusUi, stateUi } from '../lib/states.ts';
import { DeepLink, Lamp, LevelPips, SkelLine, Sprite } from './bits.tsx';

function questLabel(b: Battle): string {
  if (b.issue) return `${b.issue.identifier ?? '—'} ${b.issue.title ?? ''}`;
  const kind: Record<string, string> = { chat: '即时对话', quick_create: '快速任务', comment: '评论唤醒', autopilot: '自动巡逻' };
  return kind[b.kind] ?? '无关卡战斗';
}

function CurrentBattle(props: { b: Battle; serverTime: string }) {
  const { b, serverTime } = props;
  return (
    <div data-battle className="app-battle">
      <div className="pc-unit__quest" title={questLabel(b)}>{questLabel(b)}</div>
      <div className="app-row">
        {b.issue && <LevelPips level={b.issue.level} withLabel={false} />}
        <span className="pc-unit__stats">
          <span>已耗时 <b className="pc-num pc-hi">{fmtDuration(elapsedOf(b, serverTime))}</b></span>
          <span>重试 <b className="pc-num pc-hi">{b.retries}</b> 次</span>
        </span>
      </div>
      <div className="pc-bar pc-bar--indeterminate" aria-hidden><div className="pc-bar__fill" /></div>
      <div className="app-row app-row--end">
        <a className="pc-btn pc-btn--sm pc-btn--ghost" href={hashOf({ screen: 'replay', taskId: b.task_id })}>⟲ 回放</a>
        <DeepLink href={b.issue?.deep_link ?? null} />
      </div>
    </div>
  );
}

function LastFailure(props: { b: Battle; exhausted: boolean }) {
  const { b, exhausted } = props;
  return (
    <div data-battle className="app-battle">
      <div className="pc-unit__quest" title={questLabel(b)}>{questLabel(b)}</div>
      <div className="app-fail-line">
        {exhausted
          ? <>重试用尽(打了 <b className="pc-num">{b.attempt}</b> 次),要人出手</>
          : <>第 {b.attempt}/{b.max_attempts} 次失败,还会自动重试</>}
      </div>
      {b.failure_reason && <code className="app-code">{b.failure_reason}</code>}
      <div className="app-row app-row--end">
        <a className="pc-btn pc-btn--sm pc-btn--ghost" href={hashOf({ screen: 'replay', taskId: b.task_id })}>⟲ 回放</a>
        <DeepLink href={b.issue?.deep_link ?? null} />
      </div>
    </div>
  );
}

export function UnitCard(props: { entry: RosterEntry; serverTime: string }) {
  const { entry: e, serverTime } = props;
  const ui = stateUi(e.state);
  const unitColor = byAgentId[e.agent_id]?.unit;

  return (
    <article
      className={`pc-unit ${ui.card}`}
      style={unitColor ? ({ '--pc-unit-c': unitColor } as CSSProperties) : undefined}
    >
      <div className="pc-unit__band" />
      <div className="pc-unit__head" title={e.state_reason}>
        <Lamp state={e.state} title={e.state_reason} />
        <a className="pc-unit__name app-plain-link" href={hashOf({ screen: 'agent', id: e.agent_id })}>{e.display_name}</a>
        <span className="pc-unit__title">{e.role_title ?? ''}</span>
        <span className={`app-state-word pc-status--${ui.lamp.replace('pc-lamp--', '')}`}>{ui.label}</span>
      </div>

      <div className="pc-unit__body">
        <div className="pc-sprite-stage">
          <Sprite agentId={e.agent_id} state={e.state} scale={3} avatarUrl={e.avatar_url} />
          {ui.badge && <span className="pc-flag pc-flag--waiting">待接力</span>}
        </div>

        <div className="pc-unit__meta">
          {!e.battles_loaded && (
            <div className="app-loading" aria-label="战绩加载中">
              <div className="pc-dim">战绩加载中…</div>
              <SkelLine w="86%" /><SkelLine w="62%" /><SkelLine w="74%" />
            </div>
          )}

          {e.battles_loaded && e.state === 'fighting' &&
            e.current_battles.map((b) => <CurrentBattle key={b.task_id} b={b} serverTime={serverTime} />)}

          {e.battles_loaded && (e.state === 'stalled' || e.state === 'defeated') && e.last_battle && (
            <LastFailure b={e.last_battle} exhausted={e.state === 'defeated'} />
          )}

          {e.battles_loaded && e.state === 'waiting' && (
            <div className="app-battle">
              <div className="pc-dim">{e.state_reason}</div>
              {e.last_battle && (
                <div className="pc-unit__stats">
                  <span>上一棒 {fmtAgo(e.last_battle.completed_at, serverTime)}交付</span>
                </div>
              )}
            </div>
          )}

          {e.battles_loaded && e.state === 'idle' && (
            <div className="app-battle">
              <div className="pc-dim">待命中 · 没有在打的怪</div>
              {e.last_battle && (
                <div className="pc-unit__stats">
                  <span>上一战 {battleStatusUi(e.last_battle.status).label} · {fmtAgo(e.last_battle.completed_at ?? e.last_battle.started_at, serverTime)}</span>
                </div>
              )}
            </div>
          )}

          {e.battles_loaded && e.state === 'offline' && (
            <div className="app-battle"><div className="pc-dim">{e.state_reason}</div></div>
          )}
          {e.battles_loaded && e.state === 'unknown' && (
            <div className="app-battle"><div className="pc-dim">{e.state_reason}</div></div>
          )}
        </div>
      </div>

      <div className="pc-unit__stats app-card-foot">
        {e.stats
          ? <span>出战 <b className="pc-num pc-hi">{e.stats.total}</b> · 胜 <b className="pc-num pc-hi">{e.stats.won}</b> · 败 <b className="pc-num pc-hi">{e.stats.lost}</b> · 胜率 <b className="pc-num pc-hi">{fmtPercent(e.stats.win_rate)}</b></span>
          : <SkelLine w="70%" />}
        <span className="app-spacer" />
        <a className="pc-btn pc-btn--sm" href={hashOf({ screen: 'agent', id: e.agent_id })}>详情</a>
        <DeepLink href={e.deep_link} />
      </div>
    </article>
  );
}
