/**
 * 归一层单测。
 * 每条用例对应一个实测出来的坑 —— 注释里写清楚这个坑是怎么发现的,
 * 这样后面的人改动时知道自己在拆哪堵墙。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  issueDeepLink, nullish, splitAgentName, toBattle, toBattleKind, toBattleStatus,
  toFailureKind, toHourBuckets, toIso, toLineage, toMana, toQuestLevel, toQuestStatus,
  NO_DEEP_LINKS, type BattleContext,
} from '../src/aggregate/normalize.ts';
import type { RawTask } from '../src/multica/raw.ts';

const CTX: BattleContext = {
  cfg: NO_DEEP_LINKS,
  knownTaskIds: new Set(['parent-1']),
  agentIds: new Set(['agent-1']),
  issuesById: new Map(),
  now: '2026-09-04T08:00:00Z',
};

function task(over: Partial<RawTask> = {}): RawTask {
  return {
    id: 't1', agent_id: 'agent-1', status: 'completed', kind: 'direct', issue_id: '',
    attempt: 1, max_attempts: 2, priority: 2,
    created_at: '2026-09-04T07:00:00Z', dispatched_at: '2026-09-04T07:00:00Z',
    started_at: '2026-09-04T07:00:00Z', completed_at: '2026-09-04T07:05:00Z',
    error: null, result: null, delivered_comment_ids: [], attribution: null,
    runtime_id: 'rt-1', workspace_id: 'ws-1', work_dir: null, relative_work_dir: null,
    ...over,
  };
}

test('nullish 把空串归一成 null —— multica 用 "" 表示「没有 issue」', () => {
  assert.equal(nullish(''), null);
  assert.equal(nullish('   '), null);
  assert.equal(nullish(null), null);
  assert.equal(nullish('x'), 'x');
});

test('task.issue_id 为空串时 battle.issue 是 null,不是空壳', () => {
  const b = toBattle(task({ kind: 'chat', issue_id: '' }), CTX);
  assert.equal(b.issue, null);
  assert.equal(b.kind, 'chat');
});

test('issue 不在缓存里时给只有 id 的壳,界面照样能跳', () => {
  const b = toBattle(task({ issue_id: 'issue-x' }), CTX);
  assert.equal(b.issue?.issue_id, 'issue-x');
  assert.equal(b.issue?.title, null);
  assert.equal(b.issue?.status, 'unknown');
});

test('状态映射:completed→won / failed→lost / cancelled→aborted,原值保留', () => {
  assert.equal(toBattleStatus('completed'), 'won');
  assert.equal(toBattleStatus('failed'), 'lost');
  assert.equal(toBattleStatus('cancelled'), 'aborted');
  assert.equal(toBattleStatus('running'), 'running');
  assert.equal(toBattleStatus('teleported'), 'unknown');
  assert.equal(toBattle(task({ status: 'completed' }), CTX).status_raw, 'completed');
});

test('kind 映射:multica 的 direct 就是 issue 那一棒', () => {
  assert.equal(toBattleKind('direct'), 'issue');
  assert.equal(toBattleKind('autopilot'), 'autopilot');
  assert.equal(toBattleKind('brand_new_kind'), 'unknown');
});

test('未知枚举一律降级成 unknown,绝不抛异常', () => {
  assert.equal(toQuestStatus('some_custom_status'), 'unknown');
  assert.equal(toQuestLevel('critical'), 'unknown');
  assert.equal(toQuestStatus(null), 'unknown');
});

test('failure_kind 按前缀分家:agent_error.* 归 agent,调度类归 runtime', () => {
  assert.equal(toFailureKind('agent_error.provider_network'), 'agent');
  assert.equal(toFailureKind('runtime_offline'), 'runtime');
  assert.equal(toFailureKind('idle_watchdog'), 'runtime');
  assert.equal(toFailureKind('queued_expired'), 'runtime');
  assert.equal(toFailureKind('something_new'), 'unknown');
  assert.equal(toFailureKind(null), null);
});

test('running 的已耗时按注入的 now 算,不用本地时钟', () => {
  const b = toBattle(task({ status: 'running', started_at: '2026-09-04T07:30:00Z', completed_at: null }), CTX);
  assert.equal(b.elapsed_ms, 30 * 60 * 1000);
});

test('已结束的按 completed_at - started_at 算', () => {
  const b = toBattle(task(), CTX);
  assert.equal(b.elapsed_ms, 5 * 60 * 1000);
});

test('从未开打(started_at 为 null)时已耗时是 null,不是 0', () => {
  const b = toBattle(task({ status: 'cancelled', started_at: null, completed_at: null }), CTX);
  assert.equal(b.elapsed_ms, null);
});

test('retries = attempt - 1', () => {
  assert.equal(toBattle(task({ attempt: 3 }), CTX).retries, 2);
  assert.equal(toBattle(task({ attempt: 1 }), CTX).retries, 0);
});

test('失败信息只在 lost 时出现;成功信息只在 won 时出现', () => {
  const lost = toBattle(task({
    status: 'failed', failure_reason: 'agent_error.unknown', error: 'boom',
    result: { output: 'x', pr_url: '', session_id: 's', work_dir: 'w' },
  }), CTX);
  assert.equal(lost.failure_reason, 'agent_error.unknown');
  assert.equal(lost.error_text, 'boom');
  assert.equal(lost.output_excerpt, null, 'failed 的 task 不该有交付摘要');

  const won = toBattle(task({
    status: 'completed', failure_reason: 'stale', error: 'stale',
    result: { output: 'done', pr_url: '', session_id: 's', work_dir: 'w' },
  }), CTX);
  assert.equal(won.output_excerpt, 'done');
  assert.equal(won.failure_reason, null, 'completed 的 task 不该带失败原因');
  assert.equal(won.pr_url, null, '空串 pr_url 要归一成 null');
});

test('超长 output 截断并打标', () => {
  const long = 'a'.repeat(1000);
  const b = toBattle(task({ result: { output: long, pr_url: '', session_id: 's', work_dir: 'w' } }), CTX);
  assert.equal(b.output_excerpt?.length, 800);
  assert.equal(b.output_truncated, true);
});

test('接力链断链能被识别出来 —— 实测 855 条里有 99 条上一棒查不到', () => {
  const resolved = toLineage(
    { source: 'delegation', precise: true, delegated_from_task_id: 'parent-1' },
    CTX.knownTaskIds, CTX.agentIds,
  );
  assert.equal(resolved.from_resolved, true);

  const broken = toLineage(
    { source: 'delegation', precise: true, delegated_from_task_id: 'ghost-999' },
    CTX.knownTaskIds, CTX.agentIds,
  );
  assert.equal(broken.from_resolved, false);
  assert.equal(broken.from_task_id, 'ghost-999');
});

test('attribution 缺失时血缘降级成 unknown 而不是崩', () => {
  const l = toLineage(null, CTX.knownTaskIds, CTX.agentIds);
  assert.equal(l.source, 'unknown');
  assert.equal(l.precise, false);
  assert.equal(l.from_task_id, null);
  assert.equal(l.initiator, null);
});

test('initiator 的身份按 agent 名单判定', () => {
  const l = toLineage(
    {
      source: 'delegation', precise: true,
      initiator: { id: 'agent-1', name: '沈执' },
      originator: { id: 'human-9', name: 'heory' },
    },
    CTX.knownTaskIds, CTX.agentIds,
  );
  assert.equal(l.initiator?.kind, 'agent');
  assert.equal(l.originator?.kind, 'member');
});

test('Actor 不带 email —— 契约里刻意不传 PII', () => {
  const l = toLineage(
    { source: 'direct_human', precise: true, initiator: { id: 'h', name: 'heory', email: 'a@b.c' } },
    CTX.knownTaskIds, CTX.agentIds,
  );
  assert.equal(Object.hasOwn(l.initiator ?? {}, 'email'), false);
});

test('agent 名字按全角竖线拆成显示名和职业', () => {
  assert.deepEqual(splitAgentName('周构｜架构师'), { display: '周构', role: '架构师' });
  assert.deepEqual(splitAgentName('Mika'), { display: 'Mika', role: null });
});

test('没配模板时 deep_link 是 null,不给半截链接', () => {
  assert.equal(issueDeepLink(NO_DEEP_LINKS, 'i-1', 'MTM-1'), null);
  const cfg = { ...NO_DEEP_LINKS, issueTemplate: 'https://x/{workspace}/issue/{identifier}', workspaceSlug: 'ws' };
  assert.equal(issueDeepLink(cfg, 'i-1', 'MTM-1'), 'https://x/ws/issue/MTM-1');
  // 模板要的变量缺了就返回 null,不要拼出 https://x/ws/issue/{identifier}
  assert.equal(issueDeepLink(cfg, 'i-1', null), null);
});

test('toIso 解析不了就 null,不往下游传垃圾', () => {
  assert.equal(toIso('2026-09-04T07:00:00Z'), '2026-09-04T07:00:00Z');
  assert.equal(toIso('not a date'), null);
  assert.equal(toIso(null), null);
});

test('蓝条按模型汇总,总量 = 四类 token 之和,花费恒 null', () => {
  const m = toMana([
    { runtime_id: 'r', date: '2026-09-04', model: 'opus', provider: 'claude', input_tokens: 10, output_tokens: 20, cache_read_tokens: 30, cache_write_tokens: 40, cost_usd_ticks: 0, uncosted_input_tokens: 0, uncosted_output_tokens: 0, uncosted_cache_read_tokens: 0, uncosted_cache_write_tokens: 0 },
    { runtime_id: 'r', date: '2026-09-03', model: 'opus', provider: 'claude', input_tokens: 1, output_tokens: 2, cache_read_tokens: 3, cache_write_tokens: 4, cost_usd_ticks: 0, uncosted_input_tokens: 0, uncosted_output_tokens: 0, uncosted_cache_read_tokens: 0, uncosted_cache_write_tokens: 0 },
  ], 7);
  assert.equal(m.total_tokens, 110);
  assert.equal(m.by_model.length, 1);
  assert.equal(m.by_model[0]?.total_tokens, 110);
  assert.equal(m.cost_usd, null);
});

test('活跃直方图永远补齐 24 格', () => {
  const b = toHourBuckets([{ hour: 3, count: 7 }]);
  assert.equal(b.length, 24);
  assert.equal(b[3]?.count, 7);
  assert.equal(b[0]?.count, 0);
});
