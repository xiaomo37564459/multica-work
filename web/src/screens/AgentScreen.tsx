/**
 * 角色详情 —— 职业定位 / 技能栏 / 装备栏 / 战绩 / 最近战斗与交付物。
 *
 * 三个契约口径在这里落地:
 *   - stats.mana 一期恒 null:写明「拆不到人头」,不是画 0
 *   - equipment 实测全空:空装备栏是一个正经状态,不是 bug
 *   - battles_loaded=false:整块骨架,不出现假数字
 * 「喊话」是真实写操作(MTM-278 接通):瞄准该角色当前阵地,两段式确认,mock 模式下禁用。
 */
import { useState } from 'react';
import type { Battle } from '@contract';
import type { CockpitApi } from '../api/api.ts';
import { usePoll } from '../lib/usePoll.ts';
import { hashOf } from '../router.ts';
import { elapsedOf, fmtAgo, fmtDuration, fmtPercent } from '../lib/format.ts';
import { battleStatusUi, failureKindLabel, stateUi } from '../lib/states.ts';
import { DeepLink, ErrorBox, SkelLine, Sprite, StatePill } from '../components/bits.tsx';
import { StatusBanner } from '../components/StatusBanner.tsx';
import { ShoutModal } from '../components/ShoutModal.tsx';

function BattleRow(props: { b: Battle; serverTime: string }) {
  const { b, serverTime } = props;
  const ui = battleStatusUi(b.status);
  const quest = b.issue
    ? `${b.issue.identifier ?? '—'} ${b.issue.title ?? ''}`
    : ({ chat: '即时对话', quick_create: '快速任务', comment: '评论唤醒', autopilot: '自动巡逻' } as Record<string, string>)[b.kind] ?? '无关卡战斗';
  return (
    <div className={`app-battle-row app-battle-row--${ui.tone}`} data-battle>
      <span className={`pc-status pc-status--${ui.tone === 'done' ? 'working' : ui.tone === 'failed' ? 'failed' : ui.tone === 'active' ? 'working' : 'idle'} app-battle-row__st`}>
        {ui.label}
      </span>
      <div className="app-battle-row__main">
        <div className="pc-unit__quest" title={quest}>{quest}</div>
        <div className="pc-unit__stats">
          <span>{fmtAgo(b.completed_at ?? b.started_at ?? b.created_at, serverTime)}</span>
          <span>耗时 {fmtDuration(elapsedOf(b, serverTime))}</span>
          {b.retries > 0 && <span>重试 {b.retries} 次</span>}
          {b.delivered_comment_ids.length > 0 && <span>交付评论 {b.delivered_comment_ids.length} 条</span>}
        </div>
        {b.status === 'lost' && (
          <div className="app-fail-line">
            {b.error_text ?? '失败'}{' '}
            {b.failure_reason && <code className="app-code">{b.failure_reason}</code>}
            {b.failure_kind && <span className="pc-dim">({failureKindLabel(b.failure_kind)})</span>}
          </div>
        )}
        {b.status === 'won' && b.output_excerpt && (
          <div className="app-output">{b.output_excerpt}{b.output_truncated && <span className="pc-dim">…(已截断,全文见本体)</span>}</div>
        )}
      </div>
      <div className="app-row app-row--end">
        <a className="pc-btn pc-btn--sm pc-btn--ghost" href={hashOf({ screen: 'replay', taskId: b.task_id })}>⟲ 回放</a>
        <DeepLink href={b.issue?.deep_link ?? null} />
      </div>
    </div>
  );
}

export function AgentScreen(props: { api: CockpitApi; agentId: string; pollMs?: number }) {
  const { api, agentId, pollMs = 5000 } = props;
  const { data, meta, error, loading, refresh } = usePoll(() => api.agent(agentId), pollMs, `agent:${agentId}`);
  const [shoutTarget, setShoutTarget] = useState<{ issueId: string; label: string } | null>(null);
  const [shouted, setShouted] = useState<string | null>(null);

  if (loading) return <div className="pc-empty" aria-busy="true">正在调阅档案…</div>;
  if (!data) {
    return <ErrorBox error={error ?? { code: 'not_found', message: '没有这个角色', retryable: false }} onRetry={refresh} homeLink />;
  }

  const serverTime = meta?.server_time ?? new Date().toISOString();
  const ui = stateUi(data.state);
  // 喊话落点:优先当前正在打的 issue,其次名下最近一场带 issue 的战斗;都没有则喊话不可用。
  const shoutableBattles = ((): { issueId: string; label: string } | null => {
    const withIssue = (list: Battle[]) => list.find((b) => b.issue?.issue_id);
    const hit = withIssue(data.current_battles)
      ?? withIssue(data.recent_battles)
      ?? (data.last_battle?.issue?.issue_id ? data.last_battle : null);
    if (!hit?.issue) return null;
    return {
      issueId: hit.issue.issue_id,
      label: `${hit.issue.identifier ?? ''} ${hit.issue.title ?? ''}`.trim(),
    };
  })();

  return (
    <section>
      <StatusBanner meta={meta} error={error} />
      <nav className="app-crumb"><a href="#/">← 主视图</a></nav>

      <header className="pc-frame pc-panel app-agent-head">
        <div className="pc-sprite-stage app-agent-head__sprite">
          <Sprite agentId={data.agent_id} state={data.state} scale={4} avatarUrl={data.avatar_url} />
          {ui.badge && <span className="pc-flag pc-flag--waiting">待接力</span>}
        </div>
        <div className="app-agent-head__main">
          <h2>{data.display_name} <span className="pc-dim">{data.role_title ?? ''}</span></h2>
          <div className="app-row">
            <StatePill state={data.state} title={data.state_reason} />
            <span className="pc-dim">{data.state_reason}</span>
          </div>
          {data.class_desc && <p className="app-class-desc">{data.class_desc}</p>}
          <div className="pc-unit__stats">
            {data.model && <span>模型 <code className="app-code">{data.model}</code></span>}
            <span>运行时 {data.runtime_status === 'online' ? '在线' : data.runtime_status === 'offline' ? '离线' : '未知'}</span>
            <span>所属公会 {data.squad_ids.length > 0 ? 'AetherLab' : '—'}</span>
          </div>
        </div>
        <div className="app-agent-head__acts">
          <button
            type="button" data-shout-open
            className="pc-btn pc-btn--sm"
            disabled={api.source !== 'live' || !shoutableBattles}
            onClick={() => shoutableBattles && setShoutTarget(shoutableBattles)}
            title={api.source !== 'live'
              ? '喊话是真实写操作,mock 演示数据下禁用 —— 点顶栏「切真数据」后再用'
              : shoutableBattles
                ? `对阵中角色喊一句话(落为 issue 评论并唤醒 ${data.display_name})—— 提交前有确认页`
                : '该角色当前没有进行中的任务,喊话没有落点 —— 有 issue 在身时才能喊'}
          >
            📣 喊话
          </button>
          <DeepLink href={data.deep_link} />
        </div>
      </header>

      <div className="app-cols">
        <div className="app-col">
          <h3 className="app-h3">战绩</h3>
          <div className="pc-frame app-stats">
            {data.stats ? (
              <>
                <div className="app-stat"><span className="pc-dim">出战</span><b className="pc-num pc-hi">{data.stats.total}</b></div>
                <div className="app-stat"><span className="pc-dim">胜</span><b className="pc-num pc-hi">{data.stats.won}</b></div>
                <div className="app-stat"><span className="pc-dim">败</span><b className="pc-num pc-hi">{data.stats.lost}</b></div>
                <div className="app-stat"><span className="pc-dim">中止</span><b className="pc-num pc-hi">{data.stats.aborted}</b></div>
                <div className="app-stat"><span className="pc-dim">重试过</span><b className="pc-num pc-hi">{data.stats.retried}</b></div>
                <div className="app-stat"><span className="pc-dim">胜率</span><b className="pc-num pc-hi">{fmtPercent(data.stats.win_rate)}</b></div>
                <div className="app-stat app-stat--wide">
                  <span className="pc-dim">蓝条(token)</span>
                  <span title="平台的 token 用量只到 runtime 粒度,13 人共用一个 runtime,摊不到人头 —— 契约里 stats.mana 一期恒为 null">
                    —(拆不到人头,一期看全局)
                  </span>
                </div>
              </>
            ) : (
              <div className="app-loading"><div className="pc-dim">战绩加载中…</div><SkelLine w="80%" /><SkelLine w="60%" /></div>
            )}
          </div>

          <h3 className="app-h3">技能栏 <span className="pc-dim">skills</span></h3>
          <div className="pc-slots">
            {data.skills.length === 0 && <span className="pc-slot pc-slot--empty">技能栏空着</span>}
            {data.skills.map((s) => (
              <span key={s.name} className="pc-slot" title={s.description ?? s.name}>
                ◆ {s.name}{!s.enabled && <span className="pc-dim">(停用)</span>}
              </span>
            ))}
          </div>

          <h3 className="app-h3">装备栏 <span className="pc-dim">MCP</span></h3>
          <div className="pc-slots">
            {data.equipment.length === 0 && (
              <span className="pc-slot pc-slot--empty" title="接口是通的,这个 workspace 实测没人挂 MCP —— 空着是真实状态,不是坏了">
                装备栏空着 —— 全队还没人挂 MCP
              </span>
            )}
            {data.equipment.map((eq) => (
              <span key={eq.name} className="pc-slot">⬡ {eq.name}{!eq.enabled && <span className="pc-dim">(停用)</span>}</span>
            ))}
          </div>
        </div>

        <div className="app-col app-col--wide">
          {data.current_battles.length > 0 && (
            <>
              <h3 className="app-h3">当前战斗 <span className="pc-dim">{data.current_battles.length} 场</span></h3>
              {data.current_battles.map((b) => <BattleRow key={b.task_id} b={b} serverTime={serverTime} />)}
            </>
          )}

          <h3 className="app-h3">最近战斗与交付</h3>
          {!data.battles_loaded && (
            <div className="app-loading pc-frame"><div className="pc-dim">战绩加载中…</div><SkelLine w="90%" /><SkelLine w="75%" /><SkelLine w="82%" /></div>
          )}
          {data.battles_loaded && data.recent_battles.length === 0 && (
            <div className="pc-empty">还没有战斗记录 —— 全新角色</div>
          )}
          {data.battles_loaded && data.recent_battles.map((b) => <BattleRow key={b.task_id} b={b} serverTime={serverTime} />)}
        </div>
      </div>

      {shouted && (
        <div className="app-banner app-banner--warn" role="status" data-shout-done>
          ✓ 已送达:{shouted} —— 阵地上的 {data.display_name} 正在被唤醒
          <button type="button" className="pc-btn pc-btn--sm pc-btn--ghost" onClick={() => setShouted(null)}>知道了</button>
        </div>
      )}

      {shoutTarget && (
        <ShoutModal
          issueId={shoutTarget.issueId}
          issueLabel={shoutTarget.label}
          shout={api.shout}
          onClose={() => setShoutTarget(null)}
          onDone={(r) => {
            setShoutTarget(null);
            setShouted(r.comment_id);
          }}
        />
      )}

    </section>
  );
}
