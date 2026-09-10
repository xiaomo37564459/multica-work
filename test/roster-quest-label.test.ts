/**
 * 主视图上「打的是哪只怪」必须写得出名字 —— MTM-279 五场景走查捅出来的洞。
 *
 * 现象:主视图上四张卡的关卡名都是一个「–」,点进角色详情,同一场战斗的关卡名却是全的。
 * 原因:主视图的 issue 索引只用了热档(`activeIssues` = in_progress + blocked),
 * 详情页用的是冷档全量(`allIssues`)。于是**凡是打的那只怪不在「进行中/卡住」两种状态里**
 * ——刚被取消的、已经完成的、还在 todo 的、in_review 的—— 主视图就只知道它的 id,
 * 认不出名字,`identifier` / `title` 全是 null,界面照契约画成「–」。
 *
 * 场景 1 的验收线是「3 秒内看清谁在忙、忙什么」。一个「–」把「忙什么」这半句直接抹掉了。
 *
 * 修法:索引用**冷档 ∪ 热档**,热档在后覆盖冷档 —— 状态以最新的那份为准,名字兜底靠全量。
 * 这跟同一个文件里 liveChildCounts 已经在用的口径是同一条(见那段注释)。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRoster } from '../src/aggregate/roster.ts';
import { NO_DEEP_LINKS } from '../src/aggregate/normalize.ts';
import type { RawAgent, RawIssue, RawRuntime, RawTask } from '../src/multica/raw.ts';

const NOW = '2026-09-10T08:00:00Z';

function agent(id: string, name: string): RawAgent {
  return {
    id, name, description: null, avatar_url: null, model: null, runtime_id: 'rt-1',
    runtime_mode: 'local', max_concurrent_tasks: 3, status: null, archived_at: null,
    workspace_id: 'ws', skills: [], disabled_runtime_skills: [], mcp_config: null,
    created_at: NOW, updated_at: NOW,
  };
}

function runtime(): RawRuntime {
  return {
    id: 'rt-1', name: 'Claude', custom_name: null, status: 'online', provider: 'claude',
    runtime_mode: 'local', device_info: 'PC', last_seen_at: NOW, daemon_id: 'd',
    metadata: null, workspace_id: 'ws',
  };
}

function issue(over: Partial<RawIssue> = {}): RawIssue {
  return {
    id: 'i-cancelled', identifier: 'MTM-303', number: 303, title: '顾检验收探针 17',
    description: null, status: 'cancelled', status_category: 'cancelled', status_name: '',
    priority: 'medium', stage: null, parent_issue_id: null, project_id: null,
    assignee_id: null, assignee_type: null, creator_id: null, creator_type: null,
    labels: [], metadata: {}, properties: {}, position: 0, revision: 1,
    start_date: null, due_date: null, created_at: NOW, updated_at: NOW,
    last_activity_at: NOW, workspace_id: 'ws', ...over,
  };
}

function task(over: Partial<RawTask> = {}): RawTask {
  return {
    id: 't-1', agent_id: 'a1', status: 'failed', kind: 'issue', issue_id: 'i-cancelled',
    attempt: 1, max_attempts: 2, priority: 2,
    created_at: NOW, dispatched_at: NOW, started_at: NOW, completed_at: NOW,
    error: 'agent_error.provider_quota_limit', result: null, delivered_comment_ids: [],
    attribution: null, runtime_id: 'rt-1', workspace_id: 'ws',
    work_dir: null, relative_work_dir: null, ...over,
  };
}

function build(over: { activeIssues?: RawIssue[]; allIssues?: RawIssue[]; tasks?: RawTask[] } = {}) {
  return buildRoster({
    agents: [agent('a1', '策衡｜产品官')],
    runtimes: [runtime()],
    tasksByAgent: new Map([['a1', over.tasks ?? [task()]]]),
    activeIssues: over.activeIssues ?? [],
    allIssues: over.allIssues ?? [issue()],
    cfg: NO_DEEP_LINKS,
    now: NOW,
  });
}

test('打的那只怪不在热档里(已取消/已完成/待出击),主视图照样要认得出名字', () => {
  const entry = build().entries[0]!;
  const battle = entry.last_battle;
  assert.ok(battle, '应该有一场已结束的战斗');
  assert.equal(battle.issue?.identifier, 'MTM-303', '认不出名字的话界面只能画一个「–」');
  assert.equal(battle.issue?.title, '顾检验收探针 17');
});

test('同一条 issue 热档冷档都有时,状态以热档为准 —— 名字靠冷档兜底,新鲜度靠热档', () => {
  // 冷档(300 秒一刷)里它还是 in_progress,热档(3 秒一刷)里已经 blocked
  const cold = issue({ id: 'i-x', identifier: 'MTM-999', title: '打怪', status: 'in_progress', status_category: 'in_progress' });
  const hot = { ...cold, status: 'blocked', status_category: 'blocked' } satisfies RawIssue;

  const entry = build({
    allIssues: [cold],
    activeIssues: [hot],
    tasks: [task({ issue_id: 'i-x', status: 'running', completed_at: null })],
  }).entries[0]!;

  const battle = entry.current_battles[0];
  assert.ok(battle, '应该有一场在打的战斗');
  assert.equal(battle.issue?.identifier, 'MTM-999');
  assert.equal(battle.issue?.status_raw, 'blocked', '状态必须是热档那份,冷档的 in_progress 已经过时了');
});

test('两档都没有这条 issue 时仍然安全降级 —— 只是没名字,不许炸', () => {
  const entry = build({ allIssues: [], activeIssues: [] }).entries[0]!;
  assert.equal(entry.last_battle?.issue?.issue_id, 'i-cancelled');
  assert.equal(entry.last_battle?.issue?.identifier, null);
});
