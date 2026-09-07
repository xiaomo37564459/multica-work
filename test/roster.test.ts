/**
 * 主视图聚合的单测 —— 用「像真实数据一样」的样本跑一遍全链路。
 * 这是场景 1「早上打开指挥舱 3 秒内看清谁在忙、谁卡住」的可自动化部分。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRoster, buildStats, pickActiveAgents } from '../src/aggregate/roster.ts';
import { NO_DEEP_LINKS, toBattle, type BattleContext } from '../src/aggregate/normalize.ts';
import type { RawAgent, RawIssue, RawRuntime, RawTask } from '../src/multica/raw.ts';

const NOW = '2026-09-04T08:00:00Z';

function agent(id: string, name: string, over: Partial<RawAgent> = {}): RawAgent {
  return {
    id, name, description: `${name} 的职业定位`, avatar_url: null, model: 'claude-opus-5',
    runtime_id: 'rt-1', runtime_mode: 'local', max_concurrent_tasks: 3, status: null,
    archived_at: null, workspace_id: 'ws', skills: [], disabled_runtime_skills: [],
    mcp_config: null, created_at: NOW, updated_at: NOW, ...over,
  };
}

function runtime(over: Partial<RawRuntime> = {}): RawRuntime {
  return {
    id: 'rt-1', name: 'Claude', custom_name: null, status: 'online', provider: 'claude',
    runtime_mode: 'local', device_info: 'PC', last_seen_at: NOW, daemon_id: 'd',
    metadata: null, workspace_id: 'ws', ...over,
  };
}

function task(over: Partial<RawTask> = {}): RawTask {
  return {
    id: 't', agent_id: 'a1', status: 'completed', kind: 'direct', issue_id: 'i1',
    attempt: 1, max_attempts: 2, priority: 2,
    created_at: '2026-09-04T07:00:00Z', dispatched_at: '2026-09-04T07:00:00Z',
    started_at: '2026-09-04T07:00:00Z', completed_at: '2026-09-04T07:30:00Z',
    error: null, result: { output: '交付了', pr_url: '', session_id: 's', work_dir: 'w' },
    delivered_comment_ids: ['c1'], attribution: null, runtime_id: 'rt-1',
    workspace_id: 'ws', work_dir: null, relative_work_dir: null, ...over,
  };
}

function issue(over: Partial<RawIssue> = {}): RawIssue {
  return {
    id: 'i1', identifier: 'MTM-1', number: 1, title: '打怪', description: null,
    status: 'in_progress', status_category: 'in_progress', status_name: '',
    priority: 'high', stage: 1, parent_issue_id: null, project_id: 'p1',
    assignee_id: 'a1', assignee_type: 'agent', creator_id: null, creator_type: null,
    labels: [], metadata: {}, properties: {}, position: 0, revision: 1,
    start_date: null, due_date: null, created_at: NOW, updated_at: NOW,
    last_activity_at: NOW, workspace_id: 'ws', ...over,
  };
}

test('三个角色三种状态,counts 对得上', () => {
  const roster = buildRoster({
    agents: [agent('a1', '周构｜架构师'), agent('a2', '顾检｜质量官'), agent('a3', 'Mika')],
    runtimes: [runtime()],
    tasksByAgent: new Map([
      ['a1', [task({ agent_id: 'a1', status: 'running', completed_at: null })]],
      ['a2', [task({ agent_id: 'a2', status: 'failed', attempt: 2, max_attempts: 2, failure_reason: 'agent_error.unknown', error: 'x', result: null })]],
      ['a3', []],
    ]),
    activeIssues: [issue()],
    cfg: NO_DEEP_LINKS,
    now: NOW,
  });

  assert.equal(roster.entries.length, 3);
  assert.equal(roster.counts.fighting, 1);
  assert.equal(roster.counts.defeated, 1);
  assert.equal(roster.counts.idle, 1);
  assert.equal(roster.counts.stalled, 0);
});

test('归档的 agent 不上阵', () => {
  const roster = buildRoster({
    agents: [agent('a1', '在职'), agent('a2', '已归档', { archived_at: NOW })],
    runtimes: [runtime()], tasksByAgent: new Map(), activeIssues: [],
    cfg: NO_DEEP_LINKS, now: NOW,
  });
  assert.deepEqual(roster.entries.map((e) => e.agent_id), ['a1']);
});

test('还没拉到 task 的 agent 也要出现在名单上(idle),不能凭空少人', () => {
  const roster = buildRoster({
    agents: [agent('a1', '周构｜架构师')],
    runtimes: [runtime()], tasksByAgent: new Map(), activeIssues: [],
    cfg: NO_DEEP_LINKS, now: NOW,
  });
  assert.equal(roster.entries.length, 1);
  assert.equal(roster.entries[0]?.state, 'unknown', '还没拉到战斗数据时状态是 unknown,不是 idle');
  assert.deepEqual(roster.entries[0]?.current_battles, []);
  assert.equal(roster.entries[0]?.last_battle, null);
});

test('没拉到战斗历史时 battles_loaded=false 且 stats=null —— 不能显示成 0 胜 0 败', () => {
  const roster = buildRoster({
    agents: [agent('a1', '韩程｜后端')],
    runtimes: [runtime()], tasksByAgent: new Map(), activeIssues: [],
    cfg: NO_DEEP_LINKS, now: NOW,
  });
  assert.equal(roster.entries[0]?.battles_loaded, false);
  assert.equal(roster.entries[0]?.stats, null);
  assert.equal(roster.entries[0]?.state, 'unknown');
});

test('拉到了但确实一场没打过 → battles_loaded=true,stats 是真的 0', () => {
  const roster = buildRoster({
    agents: [agent('a1', '新人')],
    runtimes: [runtime()], tasksByAgent: new Map([['a1', []]]), activeIssues: [],
    cfg: NO_DEEP_LINKS, now: NOW,
  });
  assert.equal(roster.entries[0]?.battles_loaded, true);
  assert.equal(roster.entries[0]?.stats?.total, 0);
  assert.equal(roster.entries[0]?.stats?.win_rate, null);
});

test('名下有 in_progress issue 却没有 running task → 卡住', () => {
  const roster = buildRoster({
    agents: [agent('a1', '周构｜架构师')],
    runtimes: [runtime()],
    tasksByAgent: new Map([['a1', [task({ agent_id: 'a1', status: 'completed' })]]]),
    activeIssues: [issue({ assignee_id: 'a1' })],
    cfg: NO_DEEP_LINKS, now: NOW,
  });
  assert.equal(roster.entries[0]?.state, 'stalled');
});

test('runtime 查不到时 runtime_status 是 unknown,但不判 offline', () => {
  const roster = buildRoster({
    agents: [agent('a1', 'X', { runtime_id: 'rt-missing' })],
    runtimes: [runtime()],
    tasksByAgent: new Map([['a1', []]]),
    activeIssues: [],
    cfg: NO_DEEP_LINKS, now: NOW,
  });
  assert.equal(roster.entries[0]?.runtime_status, 'unknown');
  assert.equal(roster.entries[0]?.state, 'idle', '查不到 runtime 比确认离线弱得多,不能点灰');
});

test('current_battles 是数组 —— 一个角色可以同时打多场', () => {
  const roster = buildRoster({
    agents: [agent('a1', 'X', { max_concurrent_tasks: 6 })],
    runtimes: [runtime()],
    tasksByAgent: new Map([['a1', [
      task({ id: 't1', agent_id: 'a1', status: 'running', completed_at: null }),
      task({ id: 't2', agent_id: 'a1', status: 'running', completed_at: null }),
    ]]]),
    activeIssues: [], cfg: NO_DEEP_LINKS, now: NOW,
  });
  assert.equal(roster.entries[0]?.current_battles.length, 2);
});

test('last_battle 取最近一场已结束的,不是最近一条 task', () => {
  const roster = buildRoster({
    agents: [agent('a1', 'X')],
    runtimes: [runtime()],
    tasksByAgent: new Map([['a1', [
      task({ id: 'running', agent_id: 'a1', status: 'running', completed_at: null }),
      task({ id: 'done', agent_id: 'a1', status: 'completed' }),
    ]]]),
    activeIssues: [], cfg: NO_DEEP_LINKS, now: NOW,
  });
  assert.equal(roster.entries[0]?.last_battle?.task_id, 'done');
});

test('名字拆成显示名 + 职业', () => {
  const roster = buildRoster({
    agents: [agent('a1', '周构｜架构师')],
    runtimes: [runtime()], tasksByAgent: new Map(), activeIssues: [],
    cfg: NO_DEEP_LINKS, now: NOW,
  });
  assert.equal(roster.entries[0]?.display_name, '周构');
  assert.equal(roster.entries[0]?.role_title, '架构师');
});

test('战绩:取消不计入胜率(取消大多是人改主意,不是打输了)', () => {
  const ctx: BattleContext = {
    cfg: NO_DEEP_LINKS, knownTaskIds: new Set(), agentIds: new Set(),
    issuesById: new Map(), now: NOW,
  };
  const stats = buildStats([
    toBattle(task({ id: '1', status: 'completed' }), ctx),
    toBattle(task({ id: '2', status: 'completed' }), ctx),
    toBattle(task({ id: '3', status: 'failed', result: null }), ctx),
    toBattle(task({ id: '4', status: 'cancelled', result: null }), ctx),
    toBattle(task({ id: '5', status: 'cancelled', result: null }), ctx),
  ]);
  assert.equal(stats.total, 5);
  assert.equal(stats.won, 2);
  assert.equal(stats.lost, 1);
  assert.equal(stats.aborted, 2);
  assert.equal(stats.win_rate, 2 / 3);
});

test('战绩:一场都没打过时胜率是 null,不是 0', () => {
  const stats = buildStats([]);
  assert.equal(stats.win_rate, null);
  assert.equal(stats.last_active_at, null);
});

test('战绩:人均蓝条恒为 null —— 平台只给到 runtime 粒度', () => {
  assert.equal(buildStats([]).mana, null);
});

test('活跃集 = 有进行中 issue 的人 ∪ 上一轮非 idle 的人', () => {
  const picked = pickActiveAgents(
    [issue({ assignee_id: 'a1' }), issue({ id: 'i2', assignee_id: 'a9', assignee_type: 'member' })],
    new Map([['a2', 'defeated'], ['a3', 'idle'], ['a4', 'fighting']]),
  );
  assert.deepEqual(picked.sort(), ['a1', 'a2', 'a4']);
});

test('活跃集不收 done / backlog 的 issue 的负责人', () => {
  const picked = pickActiveAgents(
    [issue({ assignee_id: 'a1', status: 'done', status_category: 'done' })],
    new Map(),
  );
  assert.deepEqual(picked, []);
});
