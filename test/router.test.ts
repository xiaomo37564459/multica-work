/**
 * HTTP 路由层的单测。
 *
 * 为什么把 handler 抽成 createRouter():
 *   index.ts 一 import 就开始监听端口,单测碰不了;
 *   安全规则(N2/N3)、501 消失、写操作的 W1~W5 全在路由层,
 *   必须能不起服务逐条验。行为与 index.ts 直连时完全一致。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRouter, type RouterDeps } from '../src/server/router.ts';
import { loadConfig } from '../src/server/config.ts';
import { MulticaCliError } from '../src/multica/source.ts';
import type { RawAgent, RawIssue, RawProject, RawRuntime, RawTask } from '../src/multica/raw.ts';
import { NO_DEEP_LINKS } from '../src/aggregate/normalize.ts';

const NOW = '2026-09-04T08:00:00Z';

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
    id: 'i1', identifier: 'MTM-1', number: 1, title: '打怪', description: null,
    status: 'in_progress', status_category: 'in_progress', status_name: '',
    priority: 'high', stage: 1, parent_issue_id: null, project_id: null,
    assignee_id: null, assignee_type: null, creator_id: null, creator_type: null,
    labels: [], metadata: {}, properties: {}, position: 0, revision: 1,
    start_date: null, due_date: null, created_at: NOW, updated_at: NOW,
    last_activity_at: NOW, workspace_id: 'ws', ...over,
  };
}

function task(over: Partial<RawTask> = {}): RawTask {
  return {
    id: 't', agent_id: 'a1', status: 'completed', kind: 'direct', issue_id: 'i1',
    attempt: 1, max_attempts: 2, priority: 2,
    created_at: NOW, dispatched_at: NOW, started_at: NOW, completed_at: NOW,
    error: null, result: null, delivered_comment_ids: [], attribution: null,
    runtime_id: 'rt-1', workspace_id: 'ws', work_dir: null, relative_work_dir: null, ...over,
  };
}

export interface Harness {
  router: ReturnType<typeof createRouter>;
  dispatched: Array<Record<string, unknown>>;
  shouted: Array<Record<string, unknown>>;
}

export const AGENT1 = 'aaaaaaaa-0000-4000-8000-00000000000a';
export const AGENT2 = 'aaaaaaaa-0000-4000-8000-00000000000b';
export const ISSUE1 = 'bbbbbbbb-0000-4000-8000-00000000000b';

/** 一套带样本数据的路由 + 记账式写侧(不碰真 CLI)。 */
export function makeHarness(over: Partial<RouterDeps> = {}): Harness {
  const dispatched: Array<Record<string, unknown>> = [];
  const shouted: Array<Record<string, unknown>> = [];
  const deps: RouterDeps = {
    cfg: { ...loadConfig(), port: 4780 },
    version: 'test',
    tmpDir: process.cwd(),
    data: {
      agents: [agent(AGENT1, '周构｜架构师'), agent(AGENT2, '沈执｜总指挥')],
      runtimes: [runtime()],
      tasksByAgent: new Map([[
        AGENT1,
        [task({ agent_id: AGENT1, issue_id: ISSUE1 })],
      ]]),
      activeIssues: [issue({ id: ISSUE1 })],
      allIssues: [issue({ id: ISSUE1 })],
      projects: [],
      squads: [],
      mcpByAgent: new Map(),
      usageByRuntime: new Map(),
      activityByRuntime: new Map(),
      cfg: NO_DEEP_LINKS,
      usageWindowDays: 7,
      now: NOW,
    },
    write: {
      createIssue: async (input) => {
        dispatched.push(input as Record<string, unknown>);
        return { id: 'new-issue', identifier: 'MTM-999' };
      },
      addComment: async (input) => {
        shouted.push(input as Record<string, unknown>);
        return { id: 'new-comment', issue_id: input.issueId };
      },
    },
    now: () => NOW,
    ...over,
  };
  return { router: createRouter(deps), dispatched, shouted };
}

const UUID = '335fc087-bd33-403c-817e-9e9d0c4dd00f';

/* ── 安全闸 ── */

test('N2:Host 不是本机 → 403', async () => {
  const { router } = makeHarness();
  const res = await router({ method: 'GET', url: '/api/roster', headers: { host: 'evil.com' } });
  assert.equal(res.status, 403);
});

test('N3:带外域 Origin → 403;本机 Origin 或无 Origin 放行', async () => {
  const { router } = makeHarness();
  const evil = await router({ method: 'GET', url: '/api/roster', headers: { host: '127.0.0.1:4780', origin: 'https://evil.com' } });
  assert.equal(evil.status, 403);
  const local = await router({ method: 'GET', url: '/api/roster', headers: { host: '127.0.0.1:4780', origin: 'http://localhost:5173' } });
  assert.equal(local.status, 403, '开发端口默认不放行');
  const none = await router({ method: 'GET', url: '/api/roster', headers: { host: '127.0.0.1:4780' } });
  assert.equal(none.status, 200);
});

test('响应头:no-store / nosniff / no-referrer,且绝没有 CORS 放行头', async () => {
  const { router } = makeHarness();
  const res = await router({ method: 'GET', url: '/api/roster', headers: { host: '127.0.0.1:4780' } });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('access-control-allow-origin'), undefined, '绝没有 CORS 放行头');
});

/* ── 501 清零 ── */

const GET_ENDPOINTS: Array<[string, string]> = [
  [`/api/agents/${AGENT1}`, 'AgentDetail'],
  ['/api/projects', 'ProjectRef[]'],
  ['/api/battles/t/chain', 'BattleChain'],
  ['/api/runtimes', 'RuntimeVitals[]'],
];

for (const [path, label] of GET_ENDPOINTS) {
  test(`GET ${path} 返回真数据(不再 501):${label}`, async () => {
    const { router } = makeHarness();
    const res = await router({ method: 'GET', url: path, headers: { host: '127.0.0.1:4780' } });
    const body = JSON.parse(await res.text()) as { ok: boolean; error?: { code: string } };
    assert.equal(res.status, 200, `${path} 应该 200,实际 ${res.status} ${JSON.stringify(body.error ?? {})}`);
    assert.equal(body.ok, true);
  });
}

test('GET /api/projects/:id/map 真数据;不存在的项目 not_found', async () => {
  const { router } = makeHarness({
    data: {
      agents: [], runtimes: [], tasksByAgent: new Map(), activeIssues: [], allIssues: [],
      projects: [{ id: 'p1', title: 'X', description: null, icon: null, status: null, priority: null, issue_count: 0, done_count: 0, resource_count: 0, lead_id: null, lead_type: null, start_date: null, due_date: null, created_at: NOW, updated_at: NOW, workspace_id: 'ws' } as RawProject],
      squads: [], mcpByAgent: new Map(), usageByRuntime: new Map(), activityByRuntime: new Map(),
      cfg: NO_DEEP_LINKS, usageWindowDays: 7, now: NOW,
    },
  });
  const ok = await router({ method: 'GET', url: '/api/projects/p1/map', headers: { host: '127.0.0.1:4780' } });
  assert.equal(ok.status, 200);
  const miss = await router({ method: 'GET', url: '/api/projects/nope/map', headers: { host: '127.0.0.1:4780' } });
  assert.equal(miss.status, 404);
  const body = JSON.parse(await miss.text()) as { error: { code: string } };
  assert.equal(body.error.code, 'not_found');
});

test('GET /api/issues/:id/battles 返回该 issue 的 Battle[](B 案,沈执拍板)', async () => {
  const { router } = makeHarness();
  const res = await router({ method: 'GET', url: `/api/issues/${ISSUE1}/battles`, headers: { host: '127.0.0.1:4780' } });
  assert.equal(res.status, 200);
  const body = JSON.parse(await res.text()) as { ok: boolean; data: Array<{ task_id: string }> };
  assert.equal(body.ok, true);
  assert.deepEqual(body.data.map((b) => b.task_id), ['t']);
});

test('GET /api/issues/:id/battles:非 UUID 拒(400),查无返回空数组', async () => {
  const { router } = makeHarness();
  const bad = await router({ method: 'GET', url: '/api/issues/not-a-uuid/battles', headers: { host: '127.0.0.1:4780' } });
  assert.equal(bad.status, 400);
  const empty = await router({ method: 'GET', url: `/api/issues/${UUID}/battles`, headers: { host: '127.0.0.1:4780' } });
  assert.equal(empty.status, 200);
  const body = JSON.parse(await empty.text()) as { data: unknown[] };
  assert.deepEqual(body.data, []);
});

test('GET /api/agents/:id 查无此人 → 404 not_found', async () => {
  const { router } = makeHarness();
  const res = await router({ method: 'GET', url: `/api/agents/${UUID}`, headers: { host: '127.0.0.1:4780' } });
  assert.equal(res.status, 404);
});

test('GET /api/battles/:taskId/chain:查无此战 → 404', async () => {
  const { router } = makeHarness();
  const res = await router({ method: 'GET', url: `/api/battles/${UUID}/chain`, headers: { host: '127.0.0.1:4780' } });
  assert.equal(res.status, 404);
});

test('数据还没拉到时(roster 冷启动)明确 503,不是空数据装没事', async () => {
  const { router } = makeHarness({ data: null });
  const res = await router({ method: 'GET', url: '/api/roster', headers: { host: '127.0.0.1:4780' } });
  assert.equal(res.status, 503);
});

/* ── 写操作:派活 ── */

function dispatchBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { title: '修一下缓存', description: '命中率掉了', assignee_agent_id: UUID, ...over };
}

test('POST /api/commands/dispatch:合法请求真建 issue,返回 DispatchResult', async () => {
  const h = makeHarness();
  const res = await h.router({
    method: 'POST', url: '/api/commands/dispatch',
    headers: { host: '127.0.0.1:4780', 'content-type': 'application/json' },
    body: dispatchBody(),
  });
  assert.equal(res.status, 200);
  const body = JSON.parse(await res.text()) as { ok: boolean; data: { issue_id: string; identifier: string | null; deep_link: string | null } };
  assert.equal(body.ok, true);
  assert.equal(body.data.issue_id, 'new-issue');
  assert.equal(body.data.identifier, 'MTM-999');
  assert.equal(body.data.deep_link, null);
  assert.equal(h.dispatched.length, 1);
});

test('W3:派活入参不合法 → 400,且不落到 CLI', async () => {
  const h = makeHarness();
  for (const bad of [
    dispatchBody({ title: '' }),
    dispatchBody({ title: '-x' }),
    dispatchBody({ assignee_agent_id: '周构' }),
    dispatchBody({ priority: 'critical' }),
    dispatchBody({ stage: 0 }),
    'not-an-object',
  ]) {
    const res = await h.router({
      method: 'POST', url: '/api/commands/dispatch',
      headers: { host: '127.0.0.1:4780' }, body: bad,
    });
    assert.equal(res.status, 400, `该拒:${JSON.stringify(bad)}`);
  }
  assert.equal(h.dispatched.length, 0);
});

test('W2:写操作限流 —— 超过每分钟 20 次后 429', async () => {
  const h = makeHarness();
  let status = 200;
  for (let i = 0; i < 25; i++) {
    const res = await h.router({
      method: 'POST', url: '/api/commands/dispatch',
      headers: { host: '127.0.0.1:4780' }, body: dispatchBody({ title: `第 ${i} 次派活` }),
    });
    status = res.status;
  }
  assert.equal(status, 429);
  assert.equal(h.dispatched.length, 20, '限流窗内的 20 次真实放行');
});

test('W1:写白名单外的路径一律 404/405,没有第三个写入口', async () => {
  const { router } = makeHarness();
  for (const [method, path] of [
    ['POST', '/api/commands/status'], ['POST', '/api/commands/assign'],
    ['DELETE', '/api/commands/dispatch'], ['PUT', '/api/commands/shout'],
    ['POST', '/api/issues/new'], ['POST', `/api/agents/${AGENT1}`],
  ] as const) {
    const res = await router({
      method, url: path, headers: { host: '127.0.0.1:4780' }, body: { anything: true },
    });
    assert.ok(res.status === 404 || res.status === 405, `${method} ${path} 不该有出口,实际 ${res.status}`);
  }
});

test('写侧 CLI 报错 → 502 带可重试标记,不把内部堆栈漏出去', async () => {
  const { router } = makeHarness({
    write: {
      createIssue: async () => { throw new MulticaCliError('multica issue create 调用失败:boom', ['issue', 'create'], false); },
      addComment: async () => { throw new MulticaCliError('multica issue comment add 调用失败:boom', ['issue', 'comment', 'add'], false); },
    },
  });
  const res = await router({
    method: 'POST', url: '/api/commands/dispatch',
    headers: { host: '127.0.0.1:4780' }, body: dispatchBody(),
  });
  assert.equal(res.status, 502);
  const body = JSON.parse(await res.text()) as { ok: boolean; error: { code: string; retryable: boolean } };
  assert.equal(body.ok, false);
  assert.equal(body.error.retryable, true);
});

/* ── 写操作:喊话 ── */

test('POST /api/commands/shout:合法请求真发评论,支持 parent_comment_id', async () => {
  const h = makeHarness();
  const res = await h.router({
    method: 'POST', url: '/api/commands/shout',
    headers: { host: '127.0.0.1:4780' },
    body: { issue_id: UUID, content: '优先把回归跑完', parent_comment_id: '01a083f6-c0ed-7072-be97-7094bd241df8' },
  });
  assert.equal(res.status, 200);
  const body = JSON.parse(await res.text()) as { data: { comment_id: string; issue_id: string } };
  assert.equal(body.data.comment_id, 'new-comment');
  assert.equal(h.shouted.length, 1);
});

test('W3:喊话入参不合法 → 400,不落到 CLI', async () => {
  const h = makeHarness();
  for (const bad of [
    { issue_id: 'x', content: 'hi' },
    { issue_id: UUID, content: '' },
    { issue_id: UUID, content: 'a'.repeat(10_001) },
    { issue_id: UUID, content: 'ok', parent_comment_id: 'zzz' },
  ]) {
    const res = await h.router({
      method: 'POST', url: '/api/commands/shout', headers: { host: '127.0.0.1:4780' }, body: bad,
    });
    assert.equal(res.status, 400, `该拒:${JSON.stringify(bad).slice(0, 60)}`);
  }
  assert.equal(h.shouted.length, 0);
});

/* ── health 保持元数据口径(规则 D3 的回归线) ── */

test('GET /api/health 体积红线:加了接口之后也不许混进业务数据', async () => {
  const { router } = makeHarness();
  const res = await router({ method: 'GET', url: '/api/health', headers: { host: '127.0.0.1:4780' } });
  const bytes = Buffer.byteLength(await res.text(), 'utf8');
  assert.ok(bytes < 8192, `health 响应 ${bytes} 字节,超红线说明混进业务数据`);
});

test('GET / 不在路由表里也没这 501 —— 兜底 404', async () => {
  const { router } = makeHarness();
  const res = await router({ method: 'GET', url: '/api/definitely-not-a-route', headers: { host: '127.0.0.1:4780' } });
  assert.equal(res.status, 404);
});

test('烟测:NO_DEEP_LINKS 下 deep_link 全 null(没配模板不画按钮)', () => {
  assert.equal(NO_DEEP_LINKS.issueTemplate, null);
});
