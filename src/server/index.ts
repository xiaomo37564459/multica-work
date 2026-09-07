/**
 * 指挥舱本地服务入口。
 *
 * 一条命令跑起来:`npm start`(= `node src/server/index.ts`)。
 * 零运行时依赖、零构建步骤 —— clone 下来直接跑,不用 npm install。
 *
 * 骨架阶段只有 /api/roster 接真数据(主视图是「看得见」这个第一目标的落点),
 * 其余接口返回 501 not_implemented,但契约已经在 src/contract/types.ts 里定死了。
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type {
  ApiEnvelope, ApiError, ApiMeta, BattleState, ErrorCode, Roster,
} from '../contract/types.ts';
import { MulticaCli, MulticaCliError } from '../multica/source.ts';
import { buildRoster } from '../aggregate/roster.ts';
import type { DeepLinkConfig } from '../aggregate/normalize.ts';
import { loadConfig } from './config.ts';
import { isAllowedHost, isAllowedOrigin, LOOPBACK_HOST } from './guard.ts';
import { Poller } from './poller.ts';
import { buildHealth } from './health.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(HERE, '..', '..', 'package.json'), 'utf8')) as { version?: string };

const cfg = loadConfig();
const cli = new MulticaCli({ maxConcurrency: cfg.maxConcurrency, timeoutMs: cfg.cliTimeoutMs });
const poller = new Poller(cli, cfg);

const deepLinks: DeepLinkConfig = {
  issueTemplate: cfg.issueUrlTemplate,
  agentTemplate: cfg.agentUrlTemplate,
  projectTemplate: cfg.projectUrlTemplate,
  workspaceSlug: cfg.workspaceSlug,
};

/* ────────────────────────────── 响应工具 ────────────────────────────── */

function meta(): ApiMeta {
  const f = poller.freshness();
  return {
    fetched_at: f.fetched_at,
    age_ms: f.age_ms,
    stale: f.stale,
    degraded: poller.degradedSources(),
    server_time: new Date().toISOString(),
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // 本地页面不需要被别人嵌;顺手把最基本的几条挡掉。
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(payload);
}

function ok<T>(res: ServerResponse, data: T): void {
  sendJson(res, 200, { ok: true, data, meta: meta() } satisfies ApiEnvelope<T>);
}

function fail(res: ServerResponse, status: number, code: ErrorCode, message: string, retryable = false): void {
  const error: ApiError = { code, message, retryable };
  sendJson(res, status, { ok: false, error, meta: meta() } satisfies ApiEnvelope<never>);
}

/** 骨架里还没实现的接口。契约已定,韩程那一棒照 types.ts 填。 */
function notImplemented(res: ServerResponse, contractType: string): void {
  fail(res, 501, 'not_implemented', `骨架阶段未实现。返回结构见 src/contract/types.ts 的 ${contractType}`);
}

/* ────────────────────────────── 路由 ────────────────────────────── */

function handleRoster(res: ServerResponse): void {
  const agents = poller.agents.snapshot().value;
  if (!agents) {
    fail(res, 503, 'upstream_failed', '还没拉到角色名单,稍等几秒再试', true);
    return;
  }
  const roster: Roster = buildRoster({
    agents,
    runtimes: poller.runtimes.snapshot().value ?? [],
    tasksByAgent: poller.tasksByAgent(),
    activeIssues: poller.activeIssues.snapshot().value ?? [],
    allIssues: poller.allIssues.snapshot().value ?? [],
    cfg: deepLinks,
    now: new Date().toISOString(),
  });

  // 把这一轮的状态回灌给轮询器,下一轮据此挑活跃集。
  const states = new Map<string, BattleState>(roster.entries.map((e) => [e.agent_id, e.state]));
  poller.recordStates(states);

  ok(res, roster);
}

async function handleHealth(res: ServerResponse): Promise<void> {
  let version: string | null = null;
  try {
    version = await cli.version();
  } catch {
    version = null;
  }

  // 注意这里调的是 health() 不是 snapshot():前者根本不含 value。
  // health 是唯一直连缓存内部状态的接口,业务数据一个字节都不该走这条路(规则 D3)。
  ok(res, buildHealth({
    version: PKG.version ?? '0.0.0',
    bind: `${cfg.host}:${cfg.port}`,
    cliVersion: version,
    deepLinkTemplate: cfg.issueUrlTemplate,
    sources: [
      { name: 'issue_active', health: poller.activeIssues.health() },
      { name: 'agent_list', health: poller.agents.health() },
      { name: 'project_list', health: poller.projects.health() },
      { name: 'squad_list', health: poller.squads.health() },
      { name: 'runtime_list', health: poller.runtimes.health() },
      { name: 'issue_all', health: poller.allIssues.health() },
    ],
    now: new Date().toISOString(),
  }));
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // N2 / N3:先过安全闸,再谈业务。
  if (!isAllowedHost(req.headers.host, cfg.port)) {
    fail(res, 403, 'forbidden', 'Host 头不是本机地址,拒绝');
    return;
  }
  if (!isAllowedOrigin(req.headers.origin, cfg.port, cfg.devOriginPorts)) {
    fail(res, 403, 'forbidden', 'Origin 不是本机,拒绝');
    return;
  }

  const url = new URL(req.url ?? '/', `http://${LOOPBACK_HOST}:${cfg.port}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';

  if (method === 'GET' && (path === '/' || path === '/api')) {
    ok(res, {
      name: 'AetherLab 指挥舱 BFF',
      note: '骨架阶段。真数据接口:GET /api/roster、GET /api/health',
      contract: 'src/contract/types.ts',
    });
    return;
  }

  if (method === 'GET' && path === '/api/health') { await handleHealth(res); return; }
  if (method === 'GET' && path === '/api/roster') { handleRoster(res); return; }

  // 契约已定、骨架未实现的部分 —— 明确 501,不要让前端以为是 404 走错了路。
  if (method === 'GET' && /^\/api\/agents\/[^/]+$/.test(path)) { notImplemented(res, 'AgentDetail'); return; }
  if (method === 'GET' && path === '/api/projects') { notImplemented(res, 'ProjectRef[]'); return; }
  if (method === 'GET' && /^\/api\/projects\/[^/]+\/map$/.test(path)) { notImplemented(res, 'CampaignMap'); return; }
  if (method === 'GET' && /^\/api\/battles\/[^/]+\/chain$/.test(path)) { notImplemented(res, 'BattleChain'); return; }
  if (method === 'GET' && path === '/api/runtimes') { notImplemented(res, 'RuntimeVitals[]'); return; }
  if (method === 'POST' && path === '/api/commands/dispatch') { notImplemented(res, 'DispatchResult'); return; }
  if (method === 'POST' && path === '/api/commands/shout') { notImplemented(res, 'ShoutResult'); return; }

  fail(res, 404, 'not_found', `没有这个接口:${method} ${path}`);
}

/* ────────────────────────────── 启动 ────────────────────────────── */

const server = createServer((req, res) => {
  route(req, res).catch((err: unknown) => {
    const isCli = err instanceof MulticaCliError;
    fail(
      res,
      isCli ? 502 : 500,
      isCli ? (err.timedOut ? 'upstream_timeout' : 'upstream_failed') : 'internal',
      err instanceof Error ? err.message : '服务内部错误',
      isCli,
    );
  });
});

async function main(): Promise<void> {
  process.stdout.write('AetherLab 指挥舱 —— 正在拉第一轮数据…\n');
  try {
    await poller.primeAndStart();
  } catch (err) {
    process.stdout.write(`首轮拉取失败,服务照常起(接口会返回降级信息):${String(err)}\n`);
  }

  // N1:硬绑 127.0.0.1。这一行是整个安全边界的地基,不要改成 0.0.0.0。
  server.listen(cfg.port, cfg.host, () => {
    process.stdout.write(`指挥舱已就绪 → http://${cfg.host}:${cfg.port}/api/roster\n`);
    process.stdout.write(`自检 → http://${cfg.host}:${cfg.port}/api/health\n`);
    // 服务已经能应答主视图了,再去补两样不影响首屏的:
    // 全员战绩(实测约 4 秒)、以及详情页/战役地图要用的冷档数据。
    void poller.initialSweep().catch(() => { /* 失败由各 cell 自己记 */ });
    void poller.primeColdInBackground().catch(() => { /* 同上 */ });
  });
}

const shutdown = (): void => {
  poller.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

void main();
