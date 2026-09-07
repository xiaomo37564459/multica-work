/**
 * 战斗回放 —— 场景 5:整条接力链(谁传给谁、每一棒交付了什么)按时间轴展开。
 *
 * 契约里三个必须画出来的形态:
 *   broken=true       链条断了 → 顶上画「往上还有,但查不到了」,不假装那是起点
 *   lineage.precise=false  平台推断的血缘 → 虚线 + 「推断」标,不画实线
 *   truncated=true    追满 30 棒被截断 → 明说
 */
import type { BattleChainNode } from '@contract';
import type { CockpitApi } from '../api/api.ts';
import { usePoll } from '../lib/usePoll.ts';
import { hashOf } from '../router.ts';
import { elapsedOf, fmtAgo, fmtClock, fmtDuration } from '../lib/format.ts';
import { battleStatusUi, failureKindLabel } from '../lib/states.ts';
import { DeepLink, ErrorBox, Face } from '../components/bits.tsx';
import { StatusBanner } from '../components/StatusBanner.tsx';

const DOT_BY_TONE: Record<string, string> = {
  done: 'pc-tl-dot--done', failed: 'pc-tl-dot--failed', active: 'pc-tl-dot--active', muted: '',
};
const FACE_STATE: Record<string, string> = { running: 'fighting', won: 'idle', lost: 'defeated', aborted: 'idle', unknown: 'unknown' };

function ChainItem(props: { node: BattleChainNode; focus: boolean; last: boolean; serverTime: string }) {
  const { node: n, focus, last, serverTime } = props;
  const b = n.battle;
  const ui = battleStatusUi(b.status);
  const quest = b.issue
    ? `${b.issue.identifier ?? '—'} ${b.issue.title ?? ''}`
    : ({ chat: '即时对话(无关卡)', quick_create: '快速任务', comment: '评论唤醒', autopilot: '自动巡逻' } as Record<string, string>)[b.kind] ?? '无关卡战斗';

  return (
    <div className={`pc-tl-item ${focus ? 'app-tl--focus' : ''}`}>
      <div className="pc-tl-rail">
        <span className={`pc-tl-dot ${DOT_BY_TONE[ui.tone] ?? ''}`} />
        {!last && <span className={`pc-tl-line ${!b.lineage.precise ? 'app-tl-line--dashed' : ''}`} />}
      </div>
      <div className="pc-tl-body">
        <div className="app-row">
          <Face agentId={n.agent.agent_id} state={FACE_STATE[b.status] ?? 'idle'} />
          <span className="pc-tl-who">{n.agent.name}</span>
          <span className="app-chip">第 {n.depth + 1} 棒</span>
          {focus && <span className="pc-status pc-status--working">◈ 本棒</span>}
          <span className="pc-tl-when">
            {fmtClock(b.started_at)} · {fmtAgo(b.started_at, serverTime)} · 耗时 {fmtDuration(elapsedOf(b, serverTime))}
          </span>
        </div>

        <div className="pc-tl-what pc-unit__quest" title={quest}>{quest}</div>

        {b.status === 'running' && (
          <div className="pc-bar pc-bar--indeterminate app-tl-bar" aria-label="进行中"><div className="pc-bar__fill" /></div>
        )}
        {b.status === 'won' && b.output_excerpt && (
          <div className="app-output">
            {b.output_excerpt}
            {b.output_truncated && <span className="pc-dim">…(已截断,全文见本体)</span>}
          </div>
        )}
        {b.status === 'lost' && (
          <div className="app-fail-line">
            {b.error_text ?? '失败'}{' '}
            {b.failure_reason && <code className="app-code">{b.failure_reason}</code>}
            {b.failure_kind && <span className="pc-dim">({failureKindLabel(b.failure_kind)})</span>}
          </div>
        )}

        <div className="pc-unit__stats">
          <span className={`pc-status pc-status--${ui.tone === 'done' ? 'working' : ui.tone === 'failed' ? 'failed' : ui.tone === 'active' ? 'working' : 'idle'}`}>{ui.label}</span>
          {b.retries > 0 && <span>第 {b.attempt}/{b.max_attempts} 次尝试</span>}
          {n.handoff_comment_ids.length > 0 && <span>交付评论 <b className="pc-num pc-hi">{n.handoff_comment_ids.length}</b> 条</span>}
          {b.lineage.initiator && <span>交棒人:{b.lineage.initiator.name}</span>}
          {!b.lineage.precise && <span className="app-chip app-chip--alarm" title="平台标注这段血缘是推断的,不是精确记录">血缘为推断</span>}
          <span className="app-spacer" />
          <a className="pc-btn pc-btn--sm pc-btn--ghost" href={hashOf({ screen: 'agent', id: n.agent.agent_id })}>角色详情</a>
          <DeepLink href={b.issue?.deep_link ?? null} />
        </div>
      </div>
    </div>
  );
}

export function ReplayScreen(props: { api: CockpitApi; taskId: string; pollMs?: number }) {
  const { api, taskId, pollMs = 5000 } = props;
  const { data, meta, error, loading, refresh } = usePoll(() => api.chain(taskId), pollMs, `chain:${taskId}`);

  if (loading) return <div className="pc-empty" aria-busy="true">正在倒带…</div>;
  if (!data) return <ErrorBox error={error ?? { code: 'not_found', message: '没有这场战斗', retryable: false }} onRetry={refresh} homeLink />;

  const serverTime = meta?.server_time ?? new Date().toISOString();
  const focusNode = data.nodes.find((n) => n.battle.task_id === data.focus_task_id);
  const title = focusNode?.battle.issue
    ? `${focusNode.battle.issue.identifier ?? ''} ${focusNode.battle.issue.title ?? ''}`
    : focusNode?.agent.name ?? '';

  return (
    <section>
      <StatusBanner meta={meta} error={error} />
      <nav className="app-crumb">
        <a href="#/">← 主视图</a>
        {focusNode && <a href={hashOf({ screen: 'agent', id: focusNode.agent.agent_id })}>← 出击角色</a>}
      </nav>

      <h2 className="app-h2">战斗回放 <span className="pc-dim">{title}</span></h2>
      <div className="app-row app-replay-meta">
        <span className="app-chip">接力 <b className="pc-num">{data.nodes.length}</b> 棒</span>
        {data.truncated && <span className="app-chip app-chip--alarm">只显示最近 30 棒(已截断)</span>}
      </div>

      <div className="pc-frame pc-panel app-replay">
        {data.broken && (
          <div className="app-banner app-banner--warn app-broken">
            ▲ 往上还有,但查不到了 —— 更早的接力记录平台里已找不到(老数据断链),下面从能查到的第一棒开始。
          </div>
        )}
        <div className="pc-timeline">
          {data.nodes.map((n, i) => (
            <ChainItem
              key={n.battle.task_id}
              node={n}
              focus={n.battle.task_id === data.focus_task_id}
              last={i === data.nodes.length - 1}
              serverTime={serverTime}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
