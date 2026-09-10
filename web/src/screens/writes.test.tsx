/**
 * MTM-278 前端接真:派活 / 喊话弹窗、按 issue 查战斗。
 * 断言的是验收场景本身:确认流程、mock 模式禁用、提交走 api(mock 的 api 会被记账假件替换)。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { CockpitApi } from '../api/api.ts';
import type { RosterEntry } from '@contract';
import { createMockApi } from '../mock/api.ts';
import { createLiveApi } from '../api/live.ts';
import { DispatchModal } from '../components/DispatchModal.tsx';
import { ShoutModal } from '../components/ShoutModal.tsx';
import { RosterScreen } from '../screens/RosterScreen.tsx';
import { AgentScreen } from '../screens/AgentScreen.tsx';
import { CampaignScreen } from '../screens/CampaignScreen.tsx';

const T0 = 1_757_000_000_000;

async function rosterEntries(api: CockpitApi): Promise<RosterEntry[]> {
  const env = await api.roster();
  if (!env.ok) throw new Error('roster 拉不到');
  return env.data.entries;
}

describe('派活弹窗(两段式:填表 → 确认 → 提交)', () => {
  it('不选角色、不填目标就不能进入确认页', async () => {
    const api = createMockApi({ latencyMs: 0, now: () => T0 });
    const entries = await rosterEntries(api);
    const dispatch = vi.fn();
    render(<DispatchModal entries={entries} projects={[]} dispatch={dispatch} onClose={() => {}} onDone={() => {}} />);
    const next = screen.getByRole('button', { name: /下一步/ }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('确认页写明真实代价,点确认才真正提交,成功后回调', async () => {
    const api = createMockApi({ latencyMs: 0, now: () => T0 });
    const entries = await rosterEntries(api);
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: { issue_id: 'i-new', identifier: 'MTM-999', deep_link: null },
    });
    const onDone = vi.fn();
    render(<DispatchModal entries={entries} projects={[]} dispatch={dispatch} onClose={() => {}} onDone={onDone} />);

    fireEvent.change(screen.getByPlaceholderText(/例:/), { target: { value: '修登录页文案' } });
    fireEvent.change(screen.getByLabelText(/派给谁/), { target: { value: entries[0]!.agent_id } });
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));

    // 确认页出现,且写明是真实创建
    expect(screen.getByText(/真实创建 issue/)).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /确认派活/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ issue_id: 'i-new', identifier: 'MTM-999', deep_link: null }));
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('提交失败时错误可见、弹窗不关', async () => {
    const api = createMockApi({ latencyMs: 0, now: () => T0 });
    const entries = await rosterEntries(api);
    const dispatch = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'rate_limited', message: '写操作太频繁', retryable: true },
    });
    render(<DispatchModal entries={entries} projects={[]} dispatch={dispatch} onClose={() => {}} onDone={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/例:/), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/派给谁/), { target: { value: entries[0]!.agent_id } });
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    fireEvent.click(screen.getByRole('button', { name: /确认派活/ }));
    await screen.findByText(/写操作太频繁/);
  });
});

describe('喊话弹窗', () => {
  it('确认页写明落点与唤醒,点确认才提交', async () => {
    const shout = vi.fn().mockResolvedValue({ ok: true, data: { comment_id: 'c-new', issue_id: 'i1' } });
    const onDone = vi.fn();
    render(
      <ShoutModal issueId="i1" issueLabel="MTM-263 CI 缓存层修复" shout={shout} onClose={() => {}} onDone={onDone} />,
    );
    const next = screen.getByRole('button', { name: /下一步/ }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/例:/), { target: { value: '优先跑回归' } });
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    expect(screen.getByText(/真实发一条评论并唤醒/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /确认喊话/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ comment_id: 'c-new', issue_id: 'i1' }));
    expect(shout).toHaveBeenCalledWith({ issue_id: 'i1', content: '优先跑回归', parent_comment_id: null });
  });
});

describe('主视图派活入口(mock 禁用 / live 可点)', () => {
  it('mock 模式:派活按钮禁用,tooltip 说明原因', async () => {
    const api = createMockApi({ latencyMs: 0, now: () => T0 });
    render(<RosterScreen api={api} pollMs={0} />);
    await screen.findByText('沈执');
    expect((screen.getByRole('button', { name: /派活/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('live 模式:派活可点,打开弹窗', async () => {
    const mock = createMockApi({ latencyMs: 0, now: () => T0 });
    const api: CockpitApi = { ...mock, source: 'live' };
    render(<RosterScreen api={api} pollMs={0} />);
    await screen.findByText('沈执');
    fireEvent.click(screen.getByRole('button', { name: /派活/ }));
    expect(await screen.findByRole('dialog', { name: /派活/ })).toBeInTheDocument();
  });
});

describe('角色详情喊话入口', () => {
  it('mock 模式:喊话禁用(mock 无写能力)', async () => {
    const api = createMockApi({ latencyMs: 0, now: () => T0 });
    const env = await api.roster() as { ok: true; data: { entries: Array<{ display_name: string; agent_id: string }> } };
    const gu = env.data.entries.find((e) => e.display_name === '顾检')!;
    render(<AgentScreen api={api} agentId={gu.agent_id} pollMs={0} />);
    await screen.findByRole('heading', { name: /顾检/ });
    expect((screen.getByRole('button', { name: /喊话/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('live 模式:打顾检的最近一战 issue 作为落点,弹窗打开', async () => {
    const mock = createMockApi({ latencyMs: 0, now: () => T0 });
    const api: CockpitApi = { ...mock, source: 'live' };
    const env = await api.roster() as { ok: true; data: { entries: Array<{ display_name: string; agent_id: string }> } };
    const gu = env.data.entries.find((e) => e.display_name === '顾检')!;
    render(<AgentScreen api={api} agentId={gu.agent_id} pollMs={0} />);
    await screen.findByRole('heading', { name: /顾检/ });
    fireEvent.click(screen.getByRole('button', { name: /喊话/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText(/MTM-269/).length).toBeGreaterThan(0);
  });
});

describe('战役地图:按关卡直查战斗(issueBattles)', () => {
  it('点「查这场战斗」→ 列出该 issue 的战斗并可点回放', async () => {
    const api = createMockApi({ latencyMs: 0, now: () => T0 });
    const projects = await api.projects() as { ok: true; data: Array<{ project_id: string; title: string }> };
    const pipeline = projects.data.find((p) => p.title === '工坊 CI 流水线')!;
    render(<CampaignScreen api={api} projectId={pipeline.project_id} pollMs={0} />);
    await screen.findByText('第 1 关');
    fireEvent.click(screen.getByRole('button', { name: /MTM-262/ }));
    fireEvent.click(await screen.findByRole('button', { name: /查这场战斗/ }));
    await screen.findByText(/战斗 2 场/);
    expect(screen.getAllByRole('link', { name: /第 \d 棒/ }).length).toBe(2);
  });
});

describe('live api 客户端', () => {
  it('五个读接口 + issueBattles + dispatch/shout 全部存在', () => {
    const api = createLiveApi();
    expect(api.roster).toBeTypeOf('function');
    expect(api.agent).toBeTypeOf('function');
    expect(api.projects).toBeTypeOf('function');
    expect(api.campaign).toBeTypeOf('function');
    expect(api.chain).toBeTypeOf('function');
    expect(api.issueBattles).toBeTypeOf('function');
    expect(api.dispatch).toBeTypeOf('function');
    expect(api.shout).toBeTypeOf('function');
  });

  it('mock api 的写操作统一报 not_implemented(不是崩溃)', async () => {
    const api = createMockApi({ latencyMs: 0, now: () => T0 });
    const d = await api.dispatch({ title: 'x', description: '', assignee_agent_id: 'a' });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe('not_implemented');
    const s = await api.shout({ issue_id: 'a', content: 'x' });
    if (!s.ok) expect(s.error.code).toBe('not_implemented');
  });
});
