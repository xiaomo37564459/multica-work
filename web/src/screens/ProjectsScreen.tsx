/**
 * 战役列表 —— 项目 = 章节。挑一个进战役地图。
 */
import type { CockpitApi } from '../api/api.ts';
import { usePoll } from '../lib/usePoll.ts';
import { hashOf } from '../router.ts';
import { DeepLink, EmptyBox, ErrorBox } from '../components/bits.tsx';
import { StatusBanner } from '../components/StatusBanner.tsx';

export function ProjectsScreen(props: { api: CockpitApi; pollMs?: number }) {
  const { api, pollMs = 30_000 } = props;
  const { data, meta, error, loading, refresh } = usePoll(() => api.projects(), pollMs, 'projects');

  if (loading) return <div className="pc-empty" aria-busy="true">正在展开战役卷轴…</div>;
  if (!data) return <ErrorBox error={error ?? { code: 'internal', message: '拉不到项目', retryable: true }} onRetry={refresh} homeLink />;

  return (
    <section>
      <StatusBanner meta={meta} error={error} />
      <h2 className="app-h2">战役地图 <span className="pc-dim">项目 = 章节,任务 = 关卡</span></h2>
      {data.length === 0 && <EmptyBox>一个战役都没有 —— 去 Multica 建个项目先</EmptyBox>}
      <div className="app-grid app-grid--projects">
        {data.map((p) => {
          const pct = p.issue_count > 0 ? Math.round((p.done_count / p.issue_count) * 100) : 0;
          const cleared = p.issue_count > 0 && p.done_count === p.issue_count;
          return (
            <article key={p.project_id} className="pc-frame app-project">
              <div className="app-project__head">
                <span className="app-project__icon" aria-hidden>{p.icon ?? '▣'}</span>
                <h3>{p.title}</h3>
                {cleared && <span className="pc-status pc-status--working">✓ 已通关</span>}
              </div>
              <div className="pc-bar pc-bar--idle" title={`${p.done_count}/${p.issue_count} 关已通`}>
                <div className="pc-bar__fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="pc-unit__stats">
                <span>关卡 <b className="pc-num pc-hi">{p.issue_count}</b></span>
                <span>已通 <b className="pc-num pc-hi">{p.done_count}</b></span>
                <span>{pct}%</span>
              </div>
              <div className="app-row app-row--end">
                <a className="pc-btn pc-btn--sm pc-btn--primary" href={hashOf({ screen: 'campaign', id: p.project_id })}>
                  ▶ 进入战役
                </a>
                <DeepLink href={p.deep_link} />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
