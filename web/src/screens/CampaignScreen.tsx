/**
 * 战役地图 —— 场景 4:关卡按 stage 分层,done 点亮、failed 标红、进行中挂出击角色头像。
 *
 * 两条契约红线:
 *   - unstaged 不是边角料(实测 254 条里 142 条不分关),给它正经一层
 *   - 点关卡 → 侧栏详情:状态 / 等级 / 出击角色 / 跳回本体。
 *     「按关卡直接开战斗回放」需要 issue→task 的查询,一期契约没有 —— 侧栏引导去
 *     出击角色详情(那里每场战斗都有回放入口),缺口记在 PRODUCT.md 待后端配合项。
 */
import { useState } from 'react';
import type { QuestNode } from '@contract';
import type { CockpitApi } from '../api/api.ts';
import { usePoll } from '../lib/usePoll.ts';
import { hashOf } from '../router.ts';
import { fmtAgo } from '../lib/format.ts';
import { questNodeUi, questStatusLabel, stateUi } from '../lib/states.ts';
import { DeepLink, EmptyBox, ErrorBox, Face, LevelPips, StatePill } from '../components/bits.tsx';
import { StatusBanner } from '../components/StatusBanner.tsx';

function QuestNodeBtn(props: { q: QuestNode; selected: boolean; onSelect: (q: QuestNode) => void }) {
  const { q, selected, onSelect } = props;
  const ui = questNodeUi(q.status_category, q.assignee_battle_state);
  const showPilot = q.assignee?.kind === 'agent' && (q.status_category === 'in_progress' || q.status_category === 'in_review');
  return (
    <div className="pc-node-item">
      <button
        type="button"
        className={`pc-node ${ui.cls} ${selected ? 'app-node--selected' : ''}`}
        aria-label={`${q.identifier ?? ''} ${q.title}`}
        title={`${q.identifier ?? ''} ${q.title} —— ${ui.label}`}
        onClick={() => onSelect(q)}
      >
        {ui.mark}
        {showPilot && q.assignee && (
          <Face agentId={q.assignee.id} state={q.assignee_battle_state ?? 'idle'} sm className="pc-node__pilot" />
        )}
      </button>
      <span className="pc-node-item__title" title={q.title}>{q.identifier ?? q.title}</span>
    </div>
  );
}

export function CampaignScreen(props: { api: CockpitApi; projectId: string; pollMs?: number }) {
  const { api, projectId, pollMs = 10_000 } = props;
  const { data, meta, error, loading, refresh } = usePoll(() => api.campaign(projectId), pollMs, `campaign:${projectId}`);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (loading) return <div className="pc-empty" aria-busy="true">正在铺开战役地图…</div>;
  if (!data) return <ErrorBox error={error ?? { code: 'not_found', message: '没有这个战役', retryable: false }} onRetry={refresh} homeLink />;

  const serverTime = meta?.server_time ?? new Date().toISOString();
  const allQuests = [...data.stages.flatMap((s) => s.quests), ...data.unstaged];
  const selected = allQuests.find((q) => q.issue_id === selectedId) ?? null;

  return (
    <section>
      <StatusBanner meta={meta} error={error} />
      <nav className="app-crumb"><a href={hashOf({ screen: 'projects' })}>← 战役列表</a></nav>

      <header className="app-campaign-head">
        <h2 className="app-h2">{data.project.icon ?? '▣'} {data.project.title}</h2>
        <div className="app-row">
          <span className="app-chip">关卡 <b className="pc-num">{data.totals.total}</b></span>
          <span className="app-chip">已通 <b className="pc-num">{data.totals.done}</b></span>
          <span className="app-chip">进行中 <b className="pc-num">{data.totals.in_progress}</b></span>
          <span className={`app-chip ${data.totals.failed > 0 ? 'app-chip--alarm' : 'app-chip--zero'}`}>
            失败/卡死 <b className="pc-num">{data.totals.failed}</b>
          </span>
          <DeepLink href={data.project.deep_link} />
        </div>
      </header>

      <div className="app-campaign">
        <div className="app-campaign__map">
          {data.stages.length === 0 && data.unstaged.length === 0 && (
            <EmptyBox>这个战役还没有关卡</EmptyBox>
          )}
          {data.stages.map((s) => (
            <div key={s.stage} className="pc-stage-row">
              <span className="pc-stage-label">第 {s.stage} 关<br /><span className="pc-dim">{s.done}/{s.total}</span></span>
              {s.quests.map((q, i) => (
                <span key={q.issue_id} className="app-node-seq">
                  {i > 0 && <span className={`pc-link ${q.status_category === 'done' ? 'pc-link--done' : ''}`} />}
                  <QuestNodeBtn q={q} selected={q.issue_id === selectedId} onSelect={(x) => setSelectedId(x.issue_id)} />
                </span>
              ))}
            </div>
          ))}
          {data.unstaged.length > 0 && (
            <div className="pc-stage-row app-unstaged">
              <span className="pc-stage-label">不分关<br /><span className="pc-dim">{data.unstaged.length} 项</span></span>
              {data.unstaged.map((q) => (
                <QuestNodeBtn key={q.issue_id} q={q} selected={q.issue_id === selectedId} onSelect={(x) => setSelectedId(x.issue_id)} />
              ))}
            </div>
          )}

          <div className="app-legend pc-dim">
            图例:<span className="pc-node pc-node--done app-legend__n">✓</span>已通关
            <span className="pc-node pc-node--active app-legend__n">▶</span>进行中
            <span className="pc-node pc-node--failed app-legend__n">✕</span>失败/卡死
            <span className="pc-node app-legend__n">·</span>待出击
            <span className="pc-node pc-node--locked app-legend__n">—</span>已取消
          </div>
        </div>

        {selected && (
          <aside className="pc-frame pc-panel app-questpanel" aria-label="关卡详情">
            <div className="app-row">
              <h3>{selected.identifier ?? '—'}</h3>
              <span className="app-spacer" />
              <button type="button" className="pc-btn pc-btn--sm pc-btn--ghost" onClick={() => setSelectedId(null)}>✕ 关</button>
            </div>
            <p className="app-quest-title">{selected.title}</p>
            <div className="app-row">
              <span className="app-chip">{questStatusLabel(selected.status_category)}</span>
              <LevelPips level={selected.level} />
              {selected.stage != null && <span className="pc-dim">第 {selected.stage} 关</span>}
            </div>
            <div className="app-quest-rows">
              <div>
                <span className="pc-dim">出击角色 </span>
                {selected.assignee ? (
                  selected.assignee.kind === 'agent' ? (
                    <a className="app-plain-link" href={hashOf({ screen: 'agent', id: selected.assignee.id })}>
                      <Face agentId={selected.assignee.id} state={selected.assignee_battle_state ?? 'idle'} sm /> {selected.assignee.name}
                    </a>
                  ) : <span>{selected.assignee.name}(人类)</span>
                ) : <span>无人认领</span>}
                {selected.assignee_battle_state && <StatePill state={selected.assignee_battle_state} />}
              </div>
              <div><span className="pc-dim">最近动静 </span>{fmtAgo(selected.last_activity_at, serverTime)}</div>
              <div><span className="pc-dim">更新 </span>{fmtAgo(selected.updated_at, serverTime)}</div>
            </div>
            <div className="app-row">
              <DeepLink href={selected.deep_link} small={false} />
              {selected.assignee?.kind === 'agent' && (
                <a className="pc-btn" href={hashOf({ screen: 'agent', id: selected.assignee.id })}>出击角色详情</a>
              )}
            </div>
            {selected.assignee?.kind === 'agent' && (
              <p className="pc-dim app-hint">战斗回放入口在角色详情的每场战斗上 —— 按关卡直查战斗需要后端补 issue→task 查询(见待后端配合项)。</p>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
