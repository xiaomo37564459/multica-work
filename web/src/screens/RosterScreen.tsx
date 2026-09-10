/**
 * 主视图 —— 场景 1:早上打开,3 秒内看清谁在忙、忙什么、谁空闲、谁卡住。
 *
 * 布局就是为「3 秒」服务的:
 *   1. 顶部统计条:告警(失败/卡住)单独一组放最前,waiting 明确不算卡住
 *   2. 卡片按注意力排序:失败 > 卡住 > 战斗 > 待接力 > 未知 > 空闲 > 离线
 *   3. 状态不靠读字:边框色 + 状态灯形状 + 立绘姿势三层冗余(苏绘的皮肤保证)
 *
 * 顶栏「派活」是真实写操作(MTM-278 接通):点开是两段式确认,mock 模式下禁用。
 */
import { useEffect, useState } from 'react';
import type { CockpitApi } from '../api/api.ts';
import { usePoll } from '../lib/usePoll.ts';
import { ALARM_STATES, sortEntries, stateUi } from '../lib/states.ts';
import { UnitCard } from '../components/UnitCard.tsx';
import { StatusBanner } from '../components/StatusBanner.tsx';
import { DispatchModal } from '../components/DispatchModal.tsx';
import { ErrorBox } from '../components/bits.tsx';
import type { BattleState } from '@contract';

const OTHER_STATES: BattleState[] = ['fighting', 'waiting', 'idle', 'offline', 'unknown'];

export function RosterScreen(props: { api: CockpitApi; pollMs?: number }) {
  const { api, pollMs = 3000 } = props;
  const { data, meta, error, loading, refresh } = usePoll(() => api.roster(), pollMs, 'roster');
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatched, setDispatched] = useState<string | null>(null);
  const [projects, setProjects] = useState<Array<{ project_id: string; title: string }>>([]);

  // 打开派活弹窗时拉一次战役列表(失败静默:可选项,不阻塞派活)。
  useEffect(() => {
    if (!dispatchOpen || projects.length > 0) return;
    void api.projects().then((env) => {
      if (env.ok) setProjects(env.data.map((p) => ({ project_id: p.project_id, title: p.title })));
    });
  }, [dispatchOpen, projects.length, api]);

  if (loading) {
    return <div className="pc-empty" aria-busy="true">正在集结全队…</div>;
  }
  if (!data) {
    return <ErrorBox error={error ?? { code: 'internal', message: '拉不到名单', retryable: true }} onRetry={refresh} />;
  }

  const entries = sortEntries(data.entries);
  const serverTime = meta?.server_time ?? new Date().toISOString();
  const alarmTotal = ALARM_STATES.reduce((n, s) => n + (data.counts[s] ?? 0), 0);

  return (
    <section>
      <StatusBanner meta={meta} error={error} />

      <div className="app-strip pc-frame pc-panel">
        <div className="app-strip__group" data-alarm title="需要人出手的:失败(重试用尽)+ 卡住。待接力不算卡住,不在这一组">
          <span className="app-strip__caption">{alarmTotal > 0 ? '要出手' : '无告警'}</span>
          {ALARM_STATES.map((s) => (
            <span key={s} className={`app-chip app-chip--alarm ${data.counts[s] > 0 ? '' : 'app-chip--zero'}`}>
              <span className={`pc-lamp ${stateUi(s).lamp}`} aria-hidden />
              {stateUi(s).label} <b className="pc-num">{data.counts[s]}</b>
            </span>
          ))}
        </div>
        <div className="app-strip__group" data-counts>
          {OTHER_STATES.map((s) => (
            <span key={s} className={`app-chip ${data.counts[s] > 0 ? '' : 'app-chip--zero'}`}>
              <span className={`pc-lamp ${stateUi(s).lamp}`} aria-hidden />
              {stateUi(s).label} <b className="pc-num">{data.counts[s]}</b>
            </span>
          ))}
        </div>
        <span className="app-spacer" />
        <span className="pc-dim">{data.entries.length} 人在册</span>
        <button
          type="button" data-dispatch-open
          className="pc-btn pc-btn--primary pc-btn--sm"
          disabled={api.source !== 'live'}
          onClick={() => setDispatchOpen(true)}
          title={api.source === 'live'
            ? '真实创建 issue 并指派 —— 提交前有确认页'
            : '派活是真实写操作,mock 演示数据下禁用 —— 点顶栏「切真数据」后再用'}
        >
          ⚔ 派活
        </button>
      </div>

      {dispatched && (
        <div className="app-banner app-banner--warn" role="status" data-dispatch-done>
          ✓ 已派出:{dispatched} —— Multica 里已真实建单并开跑
          <button type="button" className="pc-btn pc-btn--sm pc-btn--ghost" onClick={() => setDispatched(null)}>知道了</button>
        </div>
      )}

      <div className="app-grid">
        {entries.map((e) => <UnitCard key={e.agent_id} entry={e} serverTime={serverTime} />)}
      </div>

      {dispatchOpen && (
        <DispatchModal
          entries={data.entries}
          projects={projects}
          dispatch={api.dispatch}
          onClose={() => setDispatchOpen(false)}
          onDone={(r) => {
            setDispatchOpen(false);
            setDispatched(r.identifier ?? r.issue_id);
          }}
        />
      )}
    </section>
  );
}
