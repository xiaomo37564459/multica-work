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
 *
 * 收口棒(MTM-279)又加了一件事:**同一个端口把界面也端出去**(src/server/static.ts)。
 * 于是「跑起来」就真的只剩一条命令,而且界面和接口同源 —— 开发期以外不用再放宽 Origin。
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { MulticaCli } from '../multica/source.ts';
import type { AggregatesInput } from '../aggregate/detail.ts';
import type { DeepLinkConfig } from '../aggregate/normalize.ts';
import { loadConfig } from './config.ts';
import { isAllowedHost, isAllowedOrigin } from './guard.ts';
import { Poller } from './poller.ts';
import { createRouter } from './router.ts';
import { createStaticServer } from './static.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const PKG = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version?: string };
const web = createStaticServer(join(REPO_ROOT, 'web', 'dist'));

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

const router = createRouter({
  cfg,
  version: PKG.version ?? '0.0.0',
  resolveCliVersion: () => cli.version().catch(() => null),
  get data() {
    return snapshotInput();
  },
  write: cli,
  tmpDir: process.cwd(),
  onAgentDetail: (agentId) => poller.requestMcp(agentId),
  // meta 的真实新鲜度以热档为准 —— 那才是 heory 盯的那一格。降级源也一并带上。
  metaInfo: () => ({ ...poller.freshness(), degraded: poller.degradedSources() }),
  // 这张表必须和 meta.degraded 覆盖同一批源。少列一个,界面挂了黄条说「agent_tasks 拉失败」,
  // 而自检页里查不到那一行 —— MTM-279 长跑实测踩到过,分片缓存那三个当时全是盲区。
  healthSources: () => [
    { name: 'issue_active' as const, ...poller.activeIssues.health() },
    { name: 'agent_list' as const, ...poller.agents.health() },
    { name: 'project_list' as const, ...poller.projects.health() },
    { name: 'squad_list' as const, ...poller.squads.health() },
    { name: 'runtime_list' as const, ...poller.runtimes.health() },
    { name: 'issue_all' as const, ...poller.allIssues.health() },
    // 分片缓存:一行汇总最差的那一片(worstHealth 的注释讲了为什么取最差)
    { name: 'agent_tasks' as const, ...poller.tasks.worstHealth() },
    { name: 'runtime_usage' as const, ...poller.usage.worstHealth() },
    { name: 'runtime_activity' as const, ...poller.activity.worstHealth() },
  ],
});

/**
 * 界面请求(GET,非 /api)先给静态层,没命中再落回路由层出 404。
 *
 * 安全闸对界面同样生效:Host 校验挡的是 DNS rebinding,那种攻击**恰恰是拿 HTML 页面
 * 当跳板**的 —— 只护接口不护页面等于没护。
 */
async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  let pathname: string;
  try {
    pathname = new URL(req.url ?? '/', `http://${cfg.host}:${cfg.port}`).pathname;
  } catch {
    return false;
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) return false;
  if (!isAllowedHost(req.headers.host, cfg.port)) return false; // 交给路由层统一出 403
  if (!isAllowedOrigin(req.headers.origin, cfg.port, cfg.devOriginPorts)) return false;

  const hit = await web.serve(pathname);
  if (!hit) return false;
  res.writeHead(hit.status, { ...hit.headers, 'content-length': String(hit.body.length) });
  res.end(method === 'HEAD' ? undefined : hit.body);
  return true;
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  serveStatic(req, res)
    .then((done) => {
      if (done) return undefined;
      // 请求体:只有 POST 会带;先读完再交给路由(路由层负责校验与错误码)。
      return readBody(req).then((body) => router.handle(req, res, body));
    })
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

  // 端口被占是最常见的一种起不来。Node 默认会甩一屏 EADDRINUSE 栈,
  // 对着那屏栈没人知道该干嘛 —— 换成一句话加一条能直接抄的命令。
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(
        `\n起不来:${cfg.host}:${cfg.port} 这个端口已经被占了。\n` +
        `  多半是上一个指挥舱还开着 —— 先去那个窗口按 Ctrl+C,或者换个端口:\n` +
        `    COCKPIT_PORT=4791 npm start\n\n`,
      );
    } else {
      process.stderr.write(`\n起不来:${err.message}\n\n`);
    }
    poller.stop();
    process.exit(1);
  });

  // N1:硬绑 127.0.0.1。这一行是整个安全边界的地基,不要改成 0.0.0.0。
  server.listen(cfg.port, cfg.host, () => {
    void web.hasBuild().then((built) => {
      process.stdout.write(built
        ? `指挥舱已就绪 → http://${cfg.host}:${cfg.port}/\n`
        : `接口已就绪(界面没构建,先跑 npm run build:web)→ http://${cfg.host}:${cfg.port}/\n`);
      process.stdout.write(`自检 → http://${cfg.host}:${cfg.port}/api/health\n`);
    });
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
