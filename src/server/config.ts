/**
 * 服务配置。**全部来自环境变量,一个字都不落进仓库。**
 *
 * 这里刻意不读、不存、不转发任何 Multica 凭据:
 * 指挥舱通过 shell 出去调 `multica`,由 CLI 自己读它的配置。
 * token 从头到尾不进这个进程的内存,也就不可能进日志、进 core dump、进仓库。
 */

import { LOOPBACK_HOST } from './guard.ts';

export interface CockpitConfig {
  host: string;
  port: number;
  /** 热档:多久拉一次「谁在打谁」。 */
  hotIntervalMs: number;
  /** 温档:多久拉一次活跃 agent 的战斗明细。 */
  warmIntervalMs: number;
  /** 冷档轮巡:多久给一个不活跃的 agent 补一次历史。 */
  sweepIntervalMs: number;
  /** 冷档:多久刷一次世界设定(agent/project/squad/runtime/全量 issue)。 */
  coldIntervalMs: number;
  /** 一轮冷档轮巡带几个 agent。 */
  sweepBatchSize: number;
  maxConcurrency: number;
  cliTimeoutMs: number;
  usageWindowDays: number;
  /** 见 normalize.ts 的 DeepLinkConfig 注释:这是唯一没实测过的配置。 */
  issueUrlTemplate: string | null;
  agentUrlTemplate: string | null;
  projectUrlTemplate: string | null;
  workspaceSlug: string | null;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function strEnv(name: string): string | null {
  const raw = process.env[name];
  return raw == null || raw.trim() === '' ? null : raw.trim();
}

export function loadConfig(): CockpitConfig {
  return {
    // 硬编码回环地址。**不提供改成 0.0.0.0 的开关** —— 见 docs/security.md 规则 N1。
    host: LOOPBACK_HOST,
    port: intEnv('COCKPIT_PORT', 4780),
    hotIntervalMs: intEnv('COCKPIT_HOT_MS', 3_000),
    warmIntervalMs: intEnv('COCKPIT_WARM_MS', 10_000),
    sweepIntervalMs: intEnv('COCKPIT_SWEEP_MS', 60_000),
    coldIntervalMs: intEnv('COCKPIT_COLD_MS', 300_000),
    sweepBatchSize: intEnv('COCKPIT_SWEEP_BATCH', 2),
    maxConcurrency: intEnv('COCKPIT_MAX_CONCURRENCY', 4),
    cliTimeoutMs: intEnv('COCKPIT_CLI_TIMEOUT_MS', 15_000),
    usageWindowDays: intEnv('COCKPIT_USAGE_DAYS', 7),
    issueUrlTemplate: strEnv('COCKPIT_ISSUE_URL_TEMPLATE'),
    agentUrlTemplate: strEnv('COCKPIT_AGENT_URL_TEMPLATE'),
    projectUrlTemplate: strEnv('COCKPIT_PROJECT_URL_TEMPLATE'),
    workspaceSlug: strEnv('COCKPIT_WORKSPACE_SLUG'),
  };
}
