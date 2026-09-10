/**
 * 喊话弹窗 —— 对阵中角色发一句话:落为该 issue 的评论并唤醒对应智能体。
 *
 * 和派活一样是真实花钱的动作:确认页写清「这句话会发给谁、会叫醒谁」。
 * 发送成功后提示「已送达,对方正在被唤醒」,并给跳回本体的深链(有模板时)。
 */
import { useState } from 'react';
import type { ApiEnvelope, ApiError, ShoutRequest, ShoutResult } from '@contract';
import { ModalFrame } from './DispatchModal.tsx';

export function ShoutModal(props: {
  /** 喊话对象:issue 标题(仅展示) */
  issueLabel: string;
  onClose: () => void;
  onDone: (r: ShoutResult) => void;
  shout: (req: ShoutRequest) => Promise<ApiEnvelope<ShoutResult>>;
  issueId: string;
  parentCommentId?: string | null;
}) {
  const { issueLabel, onClose, onDone, shout, issueId, parentCommentId } = props;
  const [content, setContent] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const env = await shout({
      issue_id: issueId,
      content: content.trim(),
      parent_comment_id: parentCommentId ?? null,
    });
    setBusy(false);
    if (env.ok) onDone(env.data);
    else setErr(env.error);
  };

  if (confirming) {
    return (
      <ModalFrame title="确认喊话" onClose={() => setConfirming(false)}>
        <div className="app-modal__confirm" data-shout-confirm>
          <div className="app-quest-rows">
            <div><span className="pc-dim">阵地 </span>{issueLabel}</div>
            <div><span className="pc-dim">内容 </span>{content}</div>
          </div>
          <p className="app-hint pc-dim">
            ⚠ 发送 = 在这条 issue 上真实发一条评论并唤醒阵地上的智能体(会拉起一次真实运行,消耗用量)。
          </p>
          {err && <div className="pc-error" role="alert">✕ {err.message}</div>}
          <div className="app-row app-row--end">
            <button type="button" className="pc-btn pc-btn--ghost" onClick={() => setConfirming(false)}>← 再改改</button>
            <button type="button" className="pc-btn pc-btn--primary" disabled={busy} onClick={() => void send()}>
              {busy ? '正在送达…' : '📣 确认喊话'}
            </button>
          </div>
        </div>
      </ModalFrame>
    );
  }

  return (
    <ModalFrame title={`📣 对「${issueLabel}」喊话`} onClose={onClose}>
      <label className="app-modal__field">
        <span>想说的话(会以评论形式落在 issue 上)</span>
        <textarea
          className="pc-textarea" data-shout-content value={content} maxLength={10000}
          onChange={(e) => setContent(e.currentTarget.value)}
          placeholder="例:优先把回归用例跑完再交付,别只跑单测"
          autoFocus
        />
      </label>
      {err && <div className="pc-error" role="alert">✕ {err.message}</div>}
      <div className="app-row app-row--end">
        <button type="button" className="pc-btn pc-btn--ghost" onClick={onClose}>取消</button>
        <button
          type="button" className="pc-btn pc-btn--primary" data-shout-next
          disabled={content.trim().length === 0} onClick={() => setConfirming(true)}
        >
          下一步 →
        </button>
      </div>
    </ModalFrame>
  );
}
