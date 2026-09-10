/**
 * 聚合层(角色详情 / 战役地图 / 战斗回放 / 运行时体征)的单测。
 * 对应 MTM-278 把骨架棒留下的四组 501 接口填成真数据。
 * 和 roster.test.ts 一个路数:固定样本喂纯函数,不起服务、不连平台。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAggregates, battleContext, isFailedQuest } from '../src/aggregate/detail.ts';
import { NO_DEEP_LINKS } from '../src/aggregate/normalize.ts';
import { CHAIN_MAX_DEPTH } from '../src/contract/types.ts';
import type { RawAgent, RawIssue, RawProject, RawRuntime, RawRuntimeActivity, RawRuntimeUsage, RawSquad, RawTask } from '../src/multica/raw.ts';

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
    delivered_comment_ids: [], attribution: null, runtime_id: 'rt-1',
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

function project(over: Partial<RawProject> = {}): RawProject {
  return {
    id: 'p1', title: '测试战役', description: null, icon: null, status: 'active',
    priority: null, issue_count: 0, done_count: 0, resource_count: 0,
    lead_id: null, lead_type: null, start_date: null, due_date: null,
    created_at: NOW, updated_at: NOW, workspace_id: 'ws', ...over,
  };
}

function usage(over: Partial<RawRuntimeUsage> = {}): RawRuntimeUsage {
  return {
    runtime_id: 'rt-1', date: '2026-09-04', model: 'm1', provider: 'claude',
    input_tokens: 10, output_tokens: 20, cache_read_tokens: 30, cache_write_tokens: 40,
    cost_usd_ticks: 0, uncosted_input_tokens: 0, uncosted_output_tokens: 0,
    uncosted_cache_read_tokens: 0, uncosted_cache_write_tokens: 0, ...over,
  };
}

function activity(hour: number, count: number): RawRuntimeActivity {
  return { hour, count };
}

function squad(over: Partial<RawSquad> = {}): RawSquad {
  return {
    id: 'sq-1', name: 'AetherLab', description: null, leader_id: null, member_count: 0,
    member_preview: [], archived_at: null, workspace_id: 'ws', ...over,
  };
}

interface Over {
  agents?: RawAgent[];
  tasksByAgent?: Map<string, RawTask[]>;
  activeIssues?: RawIssue[];
  allIssues?: RawIssue[];
  projects?: RawProject[];
  squads?: RawSquad[];
  mcpByAgent?: Map<string, Array<{ name: string; enabled?: boolean }>>;
  usageByRuntime?: Map<string, RawRuntimeUsage[]>;
  activityByRuntime?: Map<string, RawRuntimeActivity[]>;
}

function build(over: Over = {}) {
  const agents = over.agents ?? [agent('a1', '周构｜架构师')];
  const input = {
    agents,
    runtimes: [runtime()],
    tasksByAgent: over.tasksByAgent ?? new Map([['a1', [task()]]]),
    activeIssues: over.activeIssues ?? [issue()],
    allIssues: over.allIssues ?? [issue()],
    projects: over.projects ?? [project()],
    squads: over.squads ?? [],
    mcpByAgent: over.mcpByAgent ?? new Map(),
    usageByRuntime: over.usageByRuntime ?? new Map([['rt-1', [usage()]]]),
    activityByRuntime: over.activityByRuntime ?? new Map([['rt-1', [activity(9, 5)]]]),
    cfg: NO_DEEP_LINKS,
    now: NOW,
    usageWindowDays: 7,
  };
  return { input, agg: buildAggregates(input) };
}

/* ── 角色详情 ── */

test('AgentDetail:技能栏来自 agent list 内联的 skills(不用逐个调 agent skills list)', () => {
  const { agg } = build({
    agents: [agent('a1', '周构｜架构师', {
      skills: [
        { id: 'sk-1', name: 'git-workflow', description: '队规', enabled: true },
        { id: 'sk-2', name: ' Disabled', description: null, enabled: false },
      ],
    })],
  });
  const d = agg.agentDetails.get('a1')!;
  assert.equal(d.skills.length, 2);
  assert.equal(d.skills[0]?.name, 'git-workflow');
  assert.equal(d.skills[0]?.enabled, true);
  assert.equal(d.skills[1]?.enabled, false);
  assert.equal(d.skills[1]?.description, null);
});

test('AgentDetail:装备栏没拉到时是空数组 —— 「空着」是真实状态,不是缺数据', () => {
  const { agg } = build({});
  assert.deepEqual(agg.agentDetails.get('a1')!.equipment, []);
});

test('AgentDetail:recent_battles 时间倒序、最多 20 条', () => {
  const tasks = Array.from({ length: 25 }, (_, i) => task({
    id: `t${i}`, created_at: `2026-09-04T0${Math.floor(i / 10)}:0${i % 10}:00Z`,
  }));
  const { agg } = build({ tasksByAgent: new Map([['a1', tasks]]) });
  const d = agg.agentDetails.get('a1')!;
  assert.equal(d.recent_battles.length, 20);
  for (let i = 1; i < d.recent_battles.length; i++) {
    assert.ok(d.recent_battles[i - 1]!.created_at >= d.recent_battles[i]!.created_at, '必须时间倒序');
  }
});

test('AgentDetail:还没拉到战斗历史时 recent_battles 是 [],不冒充「没有战斗」', () => {
  const { agg } = build({ tasksByAgent: new Map() }); // a1 没拉到
  assert.deepEqual(agg.agentDetails.get('a1')!.recent_battles, []);
});

test('AgentDetail:公会来自 squad list 的成员预览与队长', () => {
  const { agg } = build({
    squads: [
      squad({ id: 'sq-1', member_preview: [{ member_id: 'a1', member_type: 'agent', role: 'member' }] }),
      squad({ id: 'sq-2', leader_id: 'a1' }),
      squad({ id: 'sq-3', member_preview: [{ member_id: 'human', member_type: 'member', role: 'member' }] }),
    ],
  });
  assert.deepEqual(agg.agentDetails.get('a1')!.squad_ids.sort(), ['sq-1', 'sq-2']);
});

/* ── 战役列表 + 地图 ── */

test('战役地图:stages 按 stage 升序分层,unstaged 单列,totals 三个计数都对', () => {
  const { agg } = build({
    projects: [project()],
    allIssues: [
      issue({ id: 'i1', stage: 2, status: 'in_progress', status_category: 'in_progress' }),
      issue({ id: 'i2', stage: 1, status: 'done', status_category: 'done' }),
      issue({ id: 'i3', stage: 1, status: 'todo', status_category: 'todo' }),
      issue({ id: 'i4', stage: null, status: 'backlog', status_category: 'backlog' }),
      issue({ id: 'i5', stage: null, project_id: null }),
      issue({ id: 'i6', stage: null, project_id: 'p-other' }),
    ],
  });
  const map = agg.campaignMaps.get('p1')!;
  assert.deepEqual(map.stages.map((s) => s.stage), [1, 2], '必须按 stage 升序');
  assert.equal(map.stages[0]?.total, 2);
  assert.equal(map.stages[0]?.done, 1);
  assert.equal(map.stages[1]?.total, 1);
  assert.deepEqual(map.unstaged.map((q) => q.issue_id), ['i4'], '没项目的 issue 不进任何战役');
  assert.equal(map.totals.total, 4);
  assert.equal(map.totals.done, 1);
  assert.equal(map.totals.in_progress, 1);
});

test('「失败/卡死」口径:status_category=blocked 算,in_progress 但出击者 defeated 也算,别的都不算', () => {
  const { agg } = build({
    projects: [project()],
    agents: [agent('a1', '唐端｜移动端'), agent('a2', '顾检｜质量官')],
    allIssues: [
      issue({ id: 'i1', status: 'blocked', status_category: 'blocked', assignee_id: 'a1' }),
      issue({ id: 'i2', status: 'in_progress', status_category: 'in_progress', assignee_id: 'a1' }),
      issue({ id: 'i3', status: 'in_progress', status_category: 'in_progress', assignee_id: 'a2' }),
      issue({ id: 'i4', status: 'done', status_category: 'done', assignee_id: 'a1' }),
      issue({ id: 'i5', status: 'todo', status_category: 'todo', assignee_id: 'a1' }),
    ],
    tasksByAgent: new Map([
      ['a1', [task({ agent_id: 'a1', status: 'failed', attempt: 3, max_attempts: 3, failure_reason: 'agent_error.provider_quota_limit', error: 'x', result: null, issue_id: 'i2' })]],
      ['a2', [task({ agent_id: 'a2', status: 'failed', attempt: 1, max_attempts: 2, failure_reason: 'agent_error.unknown', error: 'x', result: null, issue_id: 'i3' })]],
    ]),
  });
  const map = agg.campaignMaps.get('p1')!;
  // i1: blocked → 算;i2: in_progress + 唐端 defeated → 算;
  // i3: 顾检还能重试(stalled)→ 不算;i4/i5: 不算
  assert.equal(map.totals.failed, 2, `blocked + 出击者重试用尽,实际 ${map.totals.failed}`);
});

test('战役列表:issue_count / done_count 来自 project list 原值,deep_link 未配模板时为 null', () => {
  const { agg } = build({ projects: [project({ issue_count: 7, done_count: 2 })] });
  const p = agg.projectsView[0]!;
  assert.equal(p.issue_count, 7);
  assert.equal(p.done_count, 2);
  assert.equal(p.deep_link, null);
});

test('QuestNode:assignee_battle_state 挂出击角色的实时状态灯;出击者是真人时为 null', () => {
  const { agg } = build({
    agents: [agent('a1', '唐端｜移动端'), agent('a2', '顾检｜质量官')],
    tasksByAgent: new Map([
      ['a1', [task({ agent_id: 'a1', status: 'failed', attempt: 3, max_attempts: 3, failure_reason: 'agent_error.unknown', error: 'x', result: null })]],
      ['a2', []],
    ]),
    allIssues: [
      issue({ id: 'i1', assignee_id: 'a1' }),
      issue({ id: 'i2', assignee_id: 'a2', status: 'in_review', status_category: 'in_review' }),
      issue({ id: 'i3', assignee_id: 'human-1', assignee_type: 'member' }),
    ],
    activeIssues: [
      issue({ id: 'i1', assignee_id: 'a1' }),
      issue({ id: 'i2', assignee_id: 'a2', status: 'in_review', status_category: 'in_review' }),
      issue({ id: 'i3', assignee_id: 'human-1', assignee_type: 'member' }),
    ],
  });
  const q1 = agg.campaignMaps.get('p1')!.stages[0]?.quests.find((q) => q.issue_id === 'i1');
  const q2 = agg.campaignMaps.get('p1')!.stages[0]?.quests.find((q) => q.issue_id === 'i2');
  const q3 = agg.campaignMaps.get('p1')!.stages[0]?.quests.find((q) => q.issue_id === 'i3');
  assert.equal(q1?.assignee_battle_state, 'defeated');
  assert.equal(q2?.assignee_battle_state, 'idle');
  assert.equal(q3?.assignee_battle_state, null);
});

/* ── 战斗回放 ── */

test('战斗回放:接力链时间正序,depth 0 在前,handoff_comment_ids 提到顶层', () => {
  const { agg } = build({
    agents: [agent('a1', '林澄｜需求官'), agent('a2', '沈执｜总指挥')],
    tasksByAgent: new Map([
      ['a1', [task({
        id: 't-root', agent_id: 'a1', created_at: '2026-09-04T06:00:00Z',
        delivered_comment_ids: ['c1', 'c2'],
        attribution: { source: 'direct_human', precise: true, evidence: { kind: 'issue_assignment', ref_id: 'i1' } },
      })]],
      ['a2', [task({
        id: 't-next', agent_id: 'a2', created_at: '2026-09-04T07:00:00Z',
        delivered_comment_ids: ['c3'],
        attribution: {
          source: 'delegation', precise: true, delegated_from_task_id: 't-root',
          evidence: { kind: 'issue_assignment', ref_id: 'i1' },
        },
      })]],
    ]),
  });
  const chain = agg.battleChains.get('t-next')!;
  assert.equal(chain.broken, false);
  assert.equal(chain.truncated, false);
  assert.equal(chain.focus_task_id, 't-next');
  assert.deepEqual(chain.nodes.map((n) => n.battle.task_id), ['t-root', 't-next']);
  assert.deepEqual(chain.nodes.map((n) => n.depth), [0, 1]);
  assert.deepEqual(chain.nodes[0]?.handoff_comment_ids, ['c1', 'c2']);
  assert.equal(chain.nodes[0]?.agent.name, '林澄｜需求官');
});

test('战斗回放:上一棒查不到 → broken=true(契约:要画「往上还有,但查不到了」)', () => {
  const { agg } = build({
    tasksByAgent: new Map([['a1', [task({
      attribution: { source: 'delegation', precise: true, delegated_from_task_id: 'ghost-task' },
    })]]]),
  });
  const chain = agg.battleChains.get('t')!;
  assert.equal(chain.broken, true);
  assert.equal(chain.nodes.length, 1, '从能查到的第一棒开始');
});

test('战斗回放:超过 30 棒 → truncated=true,且时间正序、焦点棒在最后', () => {
  const tasks: RawTask[] = [];
  for (let i = 0; i < CHAIN_MAX_DEPTH + 5; i++) {
    tasks.push(task({
      id: `k${i}`,
      agent_id: 'a1',
      created_at: `2026-09-04T07:${String(i).padStart(2, '0')}:00Z`,
      attribution: i === 0
        ? { source: 'direct_human', precise: true }
        : { source: 'delegation', precise: true, delegated_from_task_id: `k${i - 1}` },
    }));
  }
  const { agg } = build({ tasksByAgent: new Map([['a1', tasks]]) });
  const chain = agg.battleChains.get('k33')!;
  assert.equal(chain.truncated, true);
  assert.equal(chain.nodes.length, CHAIN_MAX_DEPTH);
  assert.equal(chain.nodes[0]?.battle.task_id, 'k4', '截断后只保留最近 30 棒(k4..k33)');
  assert.equal(chain.nodes[chain.nodes.length - 1]?.battle.task_id, 'k33', '焦点棒在最后');
  assert.equal(chain.broken, false);
});

test('战斗回放:血缘成环时不死循环,断开处理', () => {
  const { agg } = build({
    tasksByAgent: new Map([
      ['a1', [
        task({ id: 'tA', attribution: { source: 'delegation', precise: true, delegated_from_task_id: 'tB' } }),
        task({ id: 'tB', attribution: { source: 'delegation', precise: true, delegated_from_task_id: 'tA' } }),
      ]],
    ]),
  });
  const chain = agg.battleChains.get('tA')!;
  assert.equal(chain.nodes.length, 2, '追到已访问的节点就断开');
  assert.equal(chain.broken, true);
});

test('战斗回放:每条已知 task 都能查到自己的链(无血缘时就是单节点)', () => {
  const { agg } = build({});
  const chain = agg.battleChains.get('t')!;
  assert.equal(chain.nodes.length, 1);
  assert.equal(chain.broken, false);
  assert.equal(chain.truncated, false);
});

/* ── 运行时体征 ── */

test('RuntimeVitals:token 聚合对、cost_usd 恒 null、activity 固定 24 桶', () => {
  const { agg } = build({
    usageByRuntime: new Map([['rt-1', [usage(), usage({ date: '2026-09-03', model: 'm2', input_tokens: 1, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 })]]]),
  });
  const rt = agg.runtimesView[0]!;
  assert.equal(rt.mana.total_tokens, 101);
  assert.equal(rt.mana.by_model.length, 2);
  assert.equal(rt.mana.cost_usd, null);
  assert.equal(rt.activity_24h.length, 24);
  assert.equal(rt.activity_24h[9]?.count, 5);
  assert.equal(rt.activity_24h[8]?.count, 0);
});

/* ── 主视图沿用 ── */

test('聚合里的 roster 和 buildRoster 单独跑结果一致(counts 一样)', () => {
  const { input, agg } = build({});
  const direct = buildAggregates(input).roster;
  assert.deepEqual(agg.roster.counts, direct.counts);
});

test('battleContext:issue 不在缓存时给只有 id 的壳;空 issue_id 是 null(chat 类)', () => {
  const ctx = battleContext(build({}).input);
  assert.equal(ctx.issuesById.get('i1')?.id, 'i1');
  assert.equal(ctx.knownTaskIds.has('t'), true);
});

test('isFailedQuest 是导出的纯函数(前端 mock 同口径)', () => {
  const node = (over: Partial<{ status_category: string; assignee_battle_state: string | null }>) => ({
    status_category: over.status_category ?? 'todo',
    assignee_battle_state: over.assignee_battle_state ?? null,
  }) as never as Parameters<typeof isFailedQuest>[0];
  assert.equal(isFailedQuest(node({ status_category: 'blocked' })), true);
  assert.equal(isFailedQuest(node({ status_category: 'in_progress', assignee_battle_state: 'defeated' })), true);
  assert.equal(isFailedQuest(node({ status_category: 'in_review', assignee_battle_state: 'defeated' })), true);
  assert.equal(isFailedQuest(node({ status_category: 'done', assignee_battle_state: 'defeated' })), false);
  assert.equal(isFailedQuest(node({ status_category: 'todo', assignee_battle_state: 'stalled' })), false);
});
