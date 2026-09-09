/**
 * 真数据源 —— 打本机 BFF(开发期由 Vite 代理到 http://127.0.0.1:4780)。
 *
 * 这一棒里它是「对照组」:/api/roster 已是真数据,其余接口 BFF 返回
 * 501 not_implemented(注意不是 404,契约就是这么定的)—— 界面对 501 画
 * 「下一棒接入」的说明态,而不是报错,这样切到 live 也是一个能看的产品。
 */
import type { ApiEnvelope } from '@contract';
import type { CockpitApi } from './api.ts';

async function getJson<T>(path: string): Promise<ApiEnvelope<T>> {
  try {
    const res = await fetch(path, { headers: { accept: 'application/json' } });
    // BFF 的失败也走信封(ok:false),直接透传;这里只兜「连不上/不是 JSON」
    return (await res.json()) as ApiEnvelope<T>;
  } catch {
    return {
      ok: false,
      error: { code: 'upstream_failed', message: '连不上本机 BFF(npm start 起了吗?)', retryable: true },
      meta: { fetched_at: null, age_ms: null, stale: true, degraded: [], server_time: new Date().toISOString() },
    };
  }
}

async function postJson<T>(path: string, body: unknown): Promise<ApiEnvelope<T>> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as ApiEnvelope<T>;
  } catch {
    return {
      ok: false,
      error: { code: 'upstream_failed', message: '连不上本机 BFF,这条写操作没有送达', retryable: true },
      meta: { fetched_at: null, age_ms: null, stale: true, degraded: [], server_time: new Date().toISOString() },
    };
  }
}

export function createLiveApi(): CockpitApi {
  return {
    source: 'live',
    demo: null,
    roster: () => getJson('/api/roster'),
    agent: (id) => getJson(`/api/agents/${encodeURIComponent(id)}`),
    projects: () => getJson('/api/projects'),
    campaign: (id) => getJson(`/api/projects/${encodeURIComponent(id)}/map`),
    chain: (taskId) => getJson(`/api/battles/${encodeURIComponent(taskId)}/chain`),
    issueBattles: (issueId) => getJson(`/api/issues/${encodeURIComponent(issueId)}/battles`),
    dispatch: (req) => postJson('/api/commands/dispatch', req),
    shout: (req) => postJson('/api/commands/shout', req),
  };
}
