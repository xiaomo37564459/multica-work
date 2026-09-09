/**
 * 五屏的关键交互与状态逻辑。
 * 走真组件 + mock 数据源(latency 0),断言的是验收场景本身:
 *   场景 1 主视图 3 秒读懂 / 场景 4 战役地图 / 场景 5 战斗回放。
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { createMockApi } from '../mock/api.ts';
import { RosterScreen } from './RosterScreen.tsx';
import { AgentScreen } from './AgentScreen.tsx';
import { ProjectsScreen } from './ProjectsScreen.tsx';
import { CampaignScreen } from './CampaignScreen.tsx';
import { ReplayScreen } from './ReplayScreen.tsx';

const T0 = 1_757_000_000_000;
const mkApi = () => createMockApi({ latencyMs: 0, now: () => T0 });

describe('主视图(场景 1:3 秒看清谁忙谁闲谁卡住)', () => {
  it('13 张角色卡全到齐,统计条与告警区分开', async () => {
    const api = mkApi();
    const { container } = render(<RosterScreen api={api} pollMs={0} />);
    await screen.findByText('沈执');
    expect(container.querySelectorAll('article.pc-unit').length).toBe(13);
    // 告警区:失败 1 + 卡住 1;waiting 不混进卡住
    const alarm = container.querySelector('[data-alarm]')!;
    expect(alarm.textContent).toContain('失败');
    expect(alarm.textContent).toContain('卡住');
    expect(alarm.textContent).not.toContain('待接力');
  });

  it('需要人出手的排最前(失败 > 卡住 > 战斗)', async () => {
    const api = mkApi();
    const { container } = render(<RosterScreen api={api} pollMs={0} />);
    await screen.findByText('沈执');
    const names = [...container.querySelectorAll('article.pc-unit .pc-unit__name')].map((n) => n.textContent);
    expect(names[0]).toBe('唐端');
    expect(names[1]).toBe('顾检');
  });

  it('派活入口留了位置但这一棒禁用(写操作归下一棒)', async () => {
    const api = mkApi();
    render(<RosterScreen api={api} pollMs={0} />);
    await screen.findByText('沈执');
    const btn = screen.getByRole('button', { name: /派活/ });
    expect(btn).toBeDisabled();
  });
});

describe('角色详情', () => {
  it('技能栏 / 空装备栏 / 战绩 / 最近战斗全到位,喊话入口禁用', async () => {
    const api = mkApi();
    const gu = (await api.roster() as { ok: true; data: { entries: Array<{ display_name: string; agent_id: string }> } })
      .data.entries.find((e) => e.display_name === '顾检')!;
    render(<AgentScreen api={api} agentId={gu.agent_id} pollMs={0} />);
    await screen.findByRole('heading', { name: /顾检/ });
    expect(screen.getAllByText(/质量官/).length).toBeGreaterThan(0);
    expect(screen.getByText(/multica-platform/)).toBeInTheDocument();
    expect(screen.getByText(/装备栏空着/)).toBeInTheDocument();
    expect(screen.getByText(/拆不到人头/)).toBeInTheDocument(); // mana 恒 null 的一期口径
    expect(screen.getByRole('button', { name: /喊话/ })).toBeDisabled();
    expect(screen.getAllByRole('link', { name: /回放/ }).length).toBeGreaterThan(0);
  });

  it('查不到的角色:错误态 + 返回主视图入口,不白屏', async () => {
    const api = mkApi();
    render(<AgentScreen api={api} agentId="no-such-id" pollMs={0} />);
    await screen.findByText(/没有这个角色/);
    expect(screen.getByRole('link', { name: /回主视图/ })).toBeInTheDocument();
  });
});

describe('战役地图(场景 4)', () => {
  it('关卡按 stage 分层,unstaged 有一席之地,done 点亮、失败标红、进行中挂头像', async () => {
    const api = mkApi();
    const projects = (await api.projects()) as { ok: true; data: Array<{ project_id: string; title: string }> };
    const cockpit = projects.data.find((p) => p.title === 'AetherLab 指挥舱')!;
    const { container } = render(<CampaignScreen api={api} projectId={cockpit.project_id} pollMs={0} />);
    await screen.findByText('第 1 关');
    expect(screen.getByText('第 3 关')).toBeInTheDocument();
    expect(screen.getByText(/不分关/)).toBeInTheDocument();
    expect(container.querySelectorAll('.pc-node--done').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('.pc-node__pilot').length).toBeGreaterThanOrEqual(1);
  });

  it('点关卡开侧栏:状态、出击角色、跳回本体一应俱全', async () => {
    const api = mkApi();
    const projects = (await api.projects()) as { ok: true; data: Array<{ project_id: string; title: string }> };
    const cockpit = projects.data.find((p) => p.title === 'AetherLab 指挥舱')!;
    render(<CampaignScreen api={api} projectId={cockpit.project_id} pollMs={0} />);
    await screen.findByText('第 1 关');
    fireEvent.click(screen.getByRole('button', { name: /MTM-277/ }));
    const panel = await screen.findByRole('complementary');
    expect(within(panel).getByText(/指挥舱前端初版/)).toBeInTheDocument();
    expect(within(panel).getByText(/策衡/)).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /跳回本体/ })).toBeInTheDocument();
  });

  it('失败节点标红(blocked 或出击角色全灭)', async () => {
    const api = mkApi();
    const projects = (await api.projects()) as { ok: true; data: Array<{ project_id: string; title: string }> };
    const pipeline = projects.data.find((p) => p.title === '工坊 CI 流水线')!;
    const { container } = render(<CampaignScreen api={api} projectId={pipeline.project_id} pollMs={0} />);
    await screen.findByText('第 1 关');
    expect(container.querySelectorAll('.pc-node--failed').length).toBeGreaterThanOrEqual(2);
  });
});

describe('战斗回放(场景 5)', () => {
  it('整条接力链时间正序展开,本棒有标记,每棒交付可见', async () => {
    const api = mkApi();
    const roster = (await api.roster()) as { ok: true; data: { entries: Array<{ display_name: string; current_battles: Array<{ task_id: string }> }> } };
    const ce = roster.data.entries.find((e) => e.display_name === '策衡')!;
    const { container } = render(<ReplayScreen api={api} taskId={ce.current_battles[0]!.task_id} pollMs={0} />);
    await screen.findByText(/战斗回放/);
    const items = container.querySelectorAll('.pc-tl-item');
    expect(items.length).toBe(5);
    expect(items[0]!.textContent).toContain('林澄');
    expect(items[4]!.textContent).toContain('策衡');
    expect(screen.getByText(/本棒/)).toBeInTheDocument();
    expect(screen.getAllByText(/交付评论/).length).toBeGreaterThan(0);
  });

  it('断链必须画出来:「往上还有,但查不到了」', async () => {
    const api = mkApi();
    const gu = api.world.roster().entries.find((e) => e.display_name === '顾检')!;
    const battle = api.world.agent(gu.agent_id)!.recent_battles[0]!;
    render(<ReplayScreen api={api} taskId={battle.task_id} pollMs={0} />);
    await screen.findByText(/战斗回放/);
    expect(screen.getByText(/查不到了/)).toBeInTheDocument();
  });
});

describe('项目列表(战役入口)', () => {
  it('三个战役各带进度,能进地图', async () => {
    const api = mkApi();
    render(<ProjectsScreen api={api} pollMs={0} />);
    await screen.findByText('AetherLab 指挥舱');
    expect(screen.getByText('工坊 CI 流水线')).toBeInTheDocument();
    expect(screen.getByText('官网改版')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /进入战役/ }).length).toBe(3);
  });
});
