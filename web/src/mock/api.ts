/**
 * mock 数据源 —— 把 mock 世界包进和真 BFF 一模一样的信封(ApiEnvelope)。
 * 界面感知不到自己在吃假数据:同样的 meta、同样的错误码、同样的延迟感。
 */
import type { ApiEnvelope, ApiMeta } from '@contract';
import type { CockpitApi, DemoSwitches } from '../api/api.ts';
import { createWorld, type MockWorld } from './world.ts';

export interface MockApiOptions {
  /** 模拟网络延迟;测试传 0 */
  latencyMs?: number;
  /** 注入时钟;测试用假钟 */
  now?: () => number;
}

interface MockDemo extends DemoSwitches {
  degraded: boolean;
  stale: boolean;
}

export interface MockCockpitApi extends CockpitApi {
  readonly source: 'mock';
  readonly demo: MockDemo;
  readonly world: MockWorld;
}

export function createMockApi(opts: MockApiOptions = {}): MockCockpitApi {
  const now = opts.now ?? Date.now;
  const latency = opts.latencyMs ?? 160;
  const world = createWorld(now);

  const demo: MockDemo = {
    degraded: false,
    stale: false,
    resetLoading: () => world.resetLoading(),
  };

  const sleep = () => (latency > 0
    ? new Promise<void>((r) => setTimeout(r, latency * (0.7 + Math.random() * 0.6)))
    : Promise.resolve());

  function meta(): ApiMeta {
    const t = now();
    const age = demo.stale ? 42_000 : 1_200;
    return {
      fetched_at: new Date(t - age).toISOString(),
      age_ms: age,
      stale: demo.stale,
      degraded: demo.degraded ? ['agent_tasks', 'runtime_usage'] : [],
      server_time: new Date(t).toISOString(),
    };
  }

  async function wrap<T>(get: () => T | null, missing: string): Promise<ApiEnvelope<T>> {
    await sleep();
    const data = get();
    if (data == null) {
      return { ok: false, error: { code: 'not_found', message: missing, retryable: false }, meta: meta() };
    }
    return { ok: true, data, meta: meta() };
  }

  return {
    source: 'mock',
    demo,
    world,
    roster: () => wrap(() => world.roster(), '拉不到名单'),
    agent: (id) => wrap(() => world.agent(id), '没有这个角色,或它已被移出小队'),
    projects: () => wrap(() => world.projects(), '拉不到项目列表'),
    campaign: (id) => wrap(() => world.campaign(id), '没有这个战役(项目不存在)'),
    chain: (taskId) => wrap(() => world.chain(taskId), '没有这场战斗的记录'),
  };
}
