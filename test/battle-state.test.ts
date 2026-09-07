/**
 * 状态灯判定规则的单测。
 * 这是顾检验收「场景 1:一眼看清谁在忙、谁卡住、谁失败」时对着核的那份规则。
 * 改 decideBattleState 必须同步改这里。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  countStates, decideBattleState, STATE_DISPLAY_ORDER,
} from '../src/aggregate/battle-state.ts';
import { BATTLE_STATES } from '../src/contract/types.ts';
import type { RawIssue, RawTask } from '../src/multica/raw.ts';

function task(over: Partial<RawTask> = {}): RawTask {
  return {
    id: 'task-1',
    agent_id: 'agent-1',
    status: 'completed',
    kind: 'direct',
    issue_id: 'issue-1',
    attempt: 1,
    max_attempts: 2,
    priority: 2,
    created_at: '2026-09-04T07:00:00Z',
    dispatched_at: '2026-09-04T07:00:00Z',
    started_at: '2026-09-04T07:00:01Z',
    completed_at: '2026-09-04T07:10:00Z',
    error: null,
    result: null,
    delivered_comment_ids: [],
    attribution: null,
    runtime_id: 'rt-1',
    workspace_id: 'ws-1',
    work_dir: null,
    relative_work_dir: null,
    ...over,
  };
}

function issue(over: Partial<RawIssue> = {}): RawIssue {
  return {
    id: 'issue-1', identifier: 'MTM-1', number: 1, title: 't', description: null,
    status: 'in_progress', status_category: 'in_progress', status_name: '',
    priority: 'high', stage: null, parent_issue_id: null, project_id: null,
    assignee_id: 'agent-1', assignee_type: 'agent', creator_id: null, creator_type: null,
    labels: [], metadata: {}, properties: {}, position: 0, revision: 1,
    start_date: null, due_date: null,
    created_at: '2026-09-04T07:00:00Z', updated_at: '2026-09-04T07:00:00Z',
    last_activity_at: '2026-09-04T07:00:00Z', workspace_id: 'ws-1',
    ...over,
  };
}

const base = { agentId: 'agent-1', runtimeStatus: 'online' as const, battlesLoaded: true, tasks: [], openIssues: [] };

test('runtime 离线 → offline,压倒其它一切', () => {
  const v = decideBattleState({
    ...base,
    runtimeStatus: 'offline',
    tasks: [task({ status: 'running' })],
    openIssues: [issue()],
  });
  assert.equal(v.state, 'offline');
});

test('runtime 状态未知时不判 offline —— 一次数据缺失不该把全员点灰', () => {
  const v = decideBattleState({ ...base, runtimeStatus: 'unknown' });
  assert.equal(v.state, 'idle');
});

test('战斗数据还没拉到 → unknown,不许猜', () => {
  const v = decideBattleState({ ...base, battlesLoaded: false, openIssues: [issue()] });
  assert.equal(v.state, 'unknown');
  assert.match(v.reason, /还没拉到/);
});

test('离线优先于 unknown —— runtime 挂了是更确定的信息', () => {
  const v = decideBattleState({ ...base, runtimeStatus: 'offline', battlesLoaded: false });
  assert.equal(v.state, 'offline');
});

test('有 running task → fighting', () => {
  const v = decideBattleState({ ...base, tasks: [task({ status: 'running' })] });
  assert.equal(v.state, 'fighting');
});

test('多个 running task → fighting,理由里带场次', () => {
  const v = decideBattleState({
    ...base,
    tasks: [task({ id: 'a', status: 'running' }), task({ id: 'b', status: 'running' })],
  });
  assert.equal(v.state, 'fighting');
  assert.match(v.reason, /2 场/);
});

test('最近一战失败且重试用尽 → defeated', () => {
  const v = decideBattleState({
    ...base,
    tasks: [task({ status: 'failed', attempt: 2, max_attempts: 2, failure_reason: 'agent_error.unknown' })],
  });
  assert.equal(v.state, 'defeated');
  assert.match(v.reason, /重试用尽/);
});

test('最近一战失败但还能重试 → stalled(不是 defeated)', () => {
  const v = decideBattleState({
    ...base,
    tasks: [task({ status: 'failed', attempt: 1, max_attempts: 2, failure_reason: 'runtime_offline' })],
  });
  assert.equal(v.state, 'stalled');
  assert.match(v.reason, /等第 2 次重试/);
});

test('没有 running task,但名下有 in_progress 的 issue → stalled(活躺着没人打)', () => {
  const v = decideBattleState({ ...base, tasks: [task()], openIssues: [issue()] });
  assert.equal(v.state, 'stalled');
});

test('名下有 blocked issue → stalled,理由指明 blocked', () => {
  const v = decideBattleState({
    ...base,
    tasks: [task()],
    openIssues: [issue({ status: 'blocked', status_category: 'blocked' })],
  });
  assert.equal(v.state, 'stalled');
  assert.match(v.reason, /blocked/);
});

test('running 优先于 stalled —— 手上有活又在打,算在打', () => {
  const v = decideBattleState({
    ...base,
    tasks: [task({ status: 'running' })],
    openIssues: [issue()],
  });
  assert.equal(v.state, 'fighting');
});

test('全新 agent(一条 task 都没有)→ idle,不报错', () => {
  const v = decideBattleState(base);
  assert.equal(v.state, 'idle');
});

test('最近一战是 cancelled 且手上没活 → idle,不算失败', () => {
  const v = decideBattleState({ ...base, tasks: [task({ status: 'cancelled', completed_at: null })] });
  assert.equal(v.state, 'idle');
});

test('只看最近一条 task —— 更早的失败不该一直挂着红灯', () => {
  const v = decideBattleState({
    ...base,
    tasks: [
      task({ id: 'new', status: 'completed', created_at: '2026-09-04T08:00:00Z' }),
      task({ id: 'old', status: 'failed', attempt: 2, max_attempts: 2, created_at: '2026-09-03T08:00:00Z' }),
    ],
  });
  assert.equal(v.state, 'idle');
});

test('countStates 覆盖全部枚举键,没出现的记 0', () => {
  const c = countStates(['fighting', 'fighting', 'idle']);
  assert.deepEqual(c, {
    fighting: 2, stalled: 0, defeated: 0, waiting: 0, idle: 1, offline: 0, unknown: 0,
  });
});

/* ── 枚举层:waiting 已进契约,规则实现归 MTM-278 ── */

test('STATE_DISPLAY_ORDER 覆盖全部枚举值 —— 少一个界面就会漏画一种状态', () => {
  assert.deepEqual([...STATE_DISPLAY_ORDER].sort(), [...BATTLE_STATES].sort());
});

test('waiting 排在 fighting 之后、idle 之前(策衡定的位置)', () => {
  const o = STATE_DISPLAY_ORDER;
  assert.ok(o.indexOf('waiting') > o.indexOf('fighting'));
  assert.ok(o.indexOf('waiting') < o.indexOf('idle'));
});

test('decideBattleState 目前还不会返回 waiting —— 规则实现在 MTM-278', () => {
  // 枚举已定、实现待填,和返回 501 的那些接口一个道理。
  // 韩程那一棒把子 issue 数据接进来之后,这条测试要改成断言返回 waiting。
  const v = decideBattleState({ ...base, tasks: [task()], openIssues: [issue()] });
  assert.equal(v.state, 'stalled', '在 MTM-278 落地前,持有父 issue 的人仍报 stalled');
});
