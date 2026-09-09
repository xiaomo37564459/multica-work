/**
 * 指挥舱本地服务入口。
 *
 * 一条命令跑起来:`npm start`(= `node src/server/index.ts`)。
 * 零运行时依赖、零构建步骤 —— clone 下来直接跑,不用 npm install。
 *
 * 本棒(MTM-278)把骨架棒的全部 501 填成真数据:
 *   - 读:每次请求从轮询缓存拼一份聚合输入(纯内存,不触发 CLI),路由层算好发信封。
 *   - 写:仅「建 issue / 发评论」两条(guard W1 白名单),长文本走临时文件(W5)。
 *   - 路由行为(安全闸、错误码、W 系列)抽在 src/server/router.ts,可被单测逐条按住;
 *     本文件只负责真实依赖的组装与监听。
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { MulticaCli } from '../multica/source.ts';
import type { AggregatesInput } from '../aggregate/detail.ts';
import type { DeepLinkConfig } from '../aggregate/normalize.ts';
import { loadConfig } from './config.ts';
import { Poller } from './poller.ts';
import { createRouter } from './router.ts';

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

/** 每次请求时从轮询缓存拼一份聚合输入 —— 全是内存快照读,不触发任何 CLI 调用。 */
function snapshotInput(): AggregatesInput | null {
  const agents = poller.agents.snapshot().value;
  // 主视图依赖角色名单;名单还没拉到时统一按「冷启动未就绪」处理,接口应答 503。
  if (!agents) return null;
  const runtimes = poller.runtimes.snapshot().value ?? [];
  const usageByRuntime = new Map<string, NonNullable<ReturnType<Poller['usage']['get']>['value']>>();
  const activityByRuntime = new Map<string, NonNullable<ReturnType<Poller['activity']['get']>['value']>>();
  for (const r of runtimes) {
    const u = poller.usage.get(r.id).value;
    if (u) usageByRuntime.set(r.id, u);
    const a = poller.activity.get(r.id).value;
    if (a) activityByRuntime.set(r.id, a);
  }
  return {
    agents,
    runtimes,
    tasksByAgent: poller.tasksByAgent(),
    activeIssues: poller.activeIssues.snapshot().value ?? [],
    allIssues: poller.allIssues.snapshot().value ?? [],
    projects: poller.projects.snapshot().value ?? [],
    squads: poller.squads.snapshot().value ?? [],
    mcpByAgent: poller.mcpByAgent(),
    usageByRuntime,
    activityByRuntime,
    cfg: deepLinks,
    now: new Date().toISOString(),
    usageWindowDays: cfg.usageWindowDays,
  };
}

/** 逐请求组装一份路由(共享限流器由 createRouter 闭包持有 —— 每进程一份)。 */
const router = createRouter({
  cfg,
  version: PKG.version ?? '0.0.0',
  get data() {
    return snapshotInput();
  },
  write: cli,
  tmpDir: process.cwd(),
  onAgentDetail: (agentId) => poller.requestMcp(agentId),
});

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  // 请求体:只有 POST 会带;先读完再交给路由(路由层负责校验与错误码)。
  readBody(req)
    .then((body) => router.handle(req, res, body))
    .catch((err: unknown) => {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({
        ok: false,
        error: { code: 'bad_request', message: `请求体不合法:${err instanceof Error ? err.message : '解析失败'}`, retryable: false },
        meta: { fetched_at: null, age_ms: null, stale: true, degraded: [], server_time: new Date().toISOString() },
      }));
    });
});

/** 读请求体(≤64KB)。GET/HEAD 没有请求体,直接 undefined。 */
async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024) throw new Error('请求体超过 64KB');
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim() === '') return undefined;
  return JSON.parse(raw);
}

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
