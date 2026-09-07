/**
 * 前端唯一的数据源接口。五个读接口一一对应周构契约里的五个 GET。
 *
 * 两个实现:
 *   - mock(默认):src/mock/api.ts —— 结构严格等于契约的假数据小系统
 *   - live:src/api/live.ts —— 打真 BFF(/api/*,Vite 代理到 127.0.0.1:4780)
 *
 * 换真数据 = 换实现,五屏一行不改 —— 这正是「mock 结构必须严格等于契约」买来的。
 */
import type {
  AgentDetail, ApiEnvelope, BattleChain, CampaignMap, ProjectRef, Roster,
} from '@contract';

export interface DemoSwitches {
  /** 顶部黄条演示:meta.degraded 非空 */
  degraded: boolean;
  /** 「数据可能过期」演示:meta.stale = true */
  stale: boolean;
  /** 重演「战绩加载中」相位 */
  resetLoading(): void;
}

export interface CockpitApi {
  readonly source: 'mock' | 'live';
  /** 仅 mock 实现有:验收走查用的演示开关 */
  readonly demo: DemoSwitches | null;
  roster(): Promise<ApiEnvelope<Roster>>;
  agent(id: string): Promise<ApiEnvelope<AgentDetail>>;
  projects(): Promise<ApiEnvelope<ProjectRef[]>>;
  campaign(projectId: string): Promise<ApiEnvelope<CampaignMap>>;
  chain(taskId: string): Promise<ApiEnvelope<BattleChain>>;
}

/**
 * 数据源选择:`?source=live` 或 localStorage.cockpit_source = 'live' 走真 BFF,
 * 其余一律 mock(这一棒的默认)。
 */
export function pickSource(search: string, stored: string | null): 'mock' | 'live' {
  const q = new URLSearchParams(search).get('source');
  if (q === 'live' || q === 'mock') return q;
  if (stored === 'live') return 'live';
  return 'mock';
}
