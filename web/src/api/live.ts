/**
 * 真数据源 —— 打本机 BFF。
 *
 * 两种接法,路径一模一样(`/api/*`),差别只在谁来端这个页面:
 *   - `npm start` 端出来的构建产物:同源直连 127.0.0.1:4780,**这是默认那一份**
 *   - Vite 开发服(5173):由 vite.config.ts 的 proxy 转到 4780
 *
 * 读接口全部真数据,写接口只有派活/喊话两条(MTM-278 起 501 已全部填掉)。
 * 这里只兜「连不上 / 不是 JSON」;BFF 自己的失败也走信封(ok:false),直接透传给界面。
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
