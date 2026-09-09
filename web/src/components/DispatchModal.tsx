/**
 * 派活弹窗 —— 指挥舱里唯一能真实创建 issue 的入口。
 *
 * 硬要求(issue 原文):派活是真实花钱的动作(每次都会拉起一个真实运行),
 * UI 必须有明确确认,不能误触发 —— 所以流程是「填表 → 确认页 → 提交」两段式,
 * 确认页把金额感写出来:谁去打、打什么、什么等级。
 *
 * 数据源:角色名单来自已加载的 roster(mock/live 都行),提交只走 api.dispatch(live 才有)。
 */
import { useMemo, useState } from 'react';
import type { ApiEnvelope, ApiError, DispatchRequest, DispatchResult, RosterEntry } from '@contract';
import { Face, LevelPips } from './bits.tsx';
import { levelPips } from '../lib/states.ts';

export function DispatchModal(props: {
  entries: RosterEntry[];
  onClose: () => void;
  onDone: (r: DispatchResult) => void;
  dispatch: (req: DispatchRequest) => Promise<ApiEnvelope<DispatchResult>>;
  projects: Array<{ project_id: string; title: string }>;
}) {
  const { entries, onClose, onDone, dispatch, projects } = props;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [agentId, setAgentId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [priority, setPriority] = useState('medium');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);

  const agent = useMemo(() => entries.find((e) => e.agent_id === agentId) ?? null, [entries, agentId]);
  const canSubmit = title.trim().length > 0 && agent != null && !busy;

  const submit = async () => {
    if (!agent || busy) return;
    setBusy(true);
    setErr(null);
    const env = await dispatch({
      title: title.trim(),
      description: description.trim(),
      assignee_agent_id: agent.agent_id,
      project_id: projectId || null,
      priority: (priority as DispatchRequest['priority']) ?? null,
      parent_issue_id: null,
      stage: null,
    });
    setBusy(false);
    if (env.ok) onDone(env.data);
    else setErr(env.error);
  };

  if (confirming && agent) {
    const lv = levelPips(priority);
    return (
      <ModalFrame title="确认出击" onClose={() => setConfirming(false)}>
        <div className="app-modal__confirm" data-dispatch-confirm>
          <div className="app-row">
            <Face agentId={agent.agent_id} state={agent.state} />
            <b>{agent.display_name}</b>
            <span className="pc-dim">{agent.role_title ?? ''}</span>
          </div>
          <div className="app-quest-rows">
            <div><span className="pc-dim">目标 </span>{title}</div>
            {description && <div><span className="pc-dim">简报 </span>{description}</div>}
            <div className="app-row">
              <span className="pc-dim">等级 </span><LevelPips level={priority} />
              <span className="pc-dim app-hint">({lv.label})</span>
            </div>
          </div>
          <p className="app-hint pc-dim">
            ⚠ 提交 = 在 Multica 真实创建 issue 并指派给 {agent.display_name},立刻拉起一次真实运行(消耗用量)。
          </p>
          {err && <div className="pc-error" role="alert">✕ {err.message}</div>}
          <div className="app-row app-row--end">
            <button type="button" className="pc-btn pc-btn--ghost" onClick={() => setConfirming(false)}>← 再改改</button>
            <button type="button" className="pc-btn pc-btn--primary" disabled={busy} onClick={() => void submit()}>
              {busy ? '正在出击…' : '⚔ 确认派活'}
            </button>
          </div>
        </div>
      </ModalFrame>
    );
  }

  return (
    <ModalFrame title="⚔ 派活" onClose={onClose}>
      <label className="app-modal__field">
        <span>目标(一句话,必填)</span>
        <input
          className="pc-input" data-dispatch-title value={title} maxLength={200}
          onChange={(e) => setTitle(e.currentTarget.value)}
          placeholder="例:把登录页的错误提示改成中文"
          autoFocus
        />
      </label>
      <label className="app-modal__field">
        <span>简报(验收标准 / 背景,可空)</span>
        <textarea
          className="pc-textarea" data-dispatch-desc value={description} maxLength={20000}
          onChange={(e) => setDescription(e.currentTarget.value)}
          placeholder="怎么做算做完?有什么约束?"
        />
      </label>
      <label className="app-modal__field">
        <span>派给谁(必选)</span>
        <select className="pc-select" data-dispatch-agent value={agentId} onChange={(e) => setAgentId(e.currentTarget.value)}>
          <option value="">— 选择角色 —</option>
          {entries.map((e) => (
            <option key={e.agent_id} value={e.agent_id}>{e.display_name}({e.role_title ?? '—'})</option>
          ))}
        </select>
      </label>
      <div className="app-modal__pair">
        <label className="app-modal__field">
          <span>战役(可空)</span>
          <select className="pc-select" value={projectId} onChange={(e) => setProjectId(e.currentTarget.value)}>
            <option value="">— 不入战役 —</option>
            {projects.map((p) => <option key={p.project_id} value={p.project_id}>{p.title}</option>)}
          </select>
        </label>
        <label className="app-modal__field">
          <span>等级</span>
          <select className="pc-select" value={priority} onChange={(e) => setPriority(e.currentTarget.value)}>
            <option value="urgent">紧急</option>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
            <option value="none">无</option>
          </select>
        </label>
      </div>
      {err && <div className="pc-error" role="alert">✕ {err.message}</div>}
      <div className="app-row app-row--end">
        <button type="button" className="pc-btn pc-btn--ghost" onClick={onClose}>取消</button>
        <button
          type="button" className="pc-btn pc-btn--primary" data-dispatch-next
          disabled={!canSubmit} onClick={() => setConfirming(true)}
        >
          下一步 →
        </button>
      </div>
    </ModalFrame>
  );
}

/** 弹窗外壳:遮罩点击 = 关闭;Esc = 关闭。 */
export function ModalFrame(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="app-modal" role="dialog" aria-modal="true" aria-label={props.title}
      onKeyDown={(e) => { if (e.key === 'Escape') props.onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}
    >
      <div className="pc-frame pc-panel app-modal__panel">
        <div className="app-row">
          <h3 className="app-h3">{props.title}</h3>
          <span className="app-spacer" />
          <button type="button" className="pc-btn pc-btn--sm pc-btn--ghost" onClick={props.onClose} aria-label="关闭">✕</button>
        </div>
        {props.children}
      </div>
    </div>
  );
}
