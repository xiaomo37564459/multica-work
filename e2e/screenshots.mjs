/**
 * 给文档抓一期交付的五屏截图。
 *
 * 打的是真服务(默认 http://127.0.0.1:4780),抓的是真数据 ——
 * 不用 mock,免得文档里的截图和实际交付长得不一样。
 *
 * 只读:一路不点「派活」「喊话」的提交按钮,不会往真 workspace 里灌东西。
 *
 * 跑法: node e2e/screenshots.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.COCKPIT_URL ?? 'http://127.0.0.1:4780';
const OUT = resolve(HERE, '..', 'docs', 'screenshots');

// 一次性重抓:清掉旧图,避免删掉的截图在仓库里阴魂不散
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const notes = [];

/** 等页面稳定:等立绘画完 + 数据不再是骨架 */
async function settle(page, ms = 1800) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
}

async function shoot(page, name, caption, opts = {}) {
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false, clip: opts.clip });
  notes.push(`${name}.png  ${caption}`);
  console.log(`  ✔ ${name}.png  ${caption}`);
}

/** 从真数据里挑对象 —— 不写死今天谁在打怪 */
async function roster(page) {
  const res = await page.request.get(`${BASE}/api/roster`);
  const body = await res.json();
  return body?.data?.entries ?? [];
}

const browser = await chromium.launch();

// 桌面尺寸:指挥舱是桌面优先的工具
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2, // 2x 图,贴文档不糊
});

// 关掉动画闪烁,让截图干净(只影响截图进程,不改产品)
await page.emulateMedia({ reducedMotion: 'reduce' });

console.log(`指挥舱截图 — 打 ${BASE}\n`);

// ── 1 主视图(场景 1:打开就看清楚全队) ──────────────────────
await page.goto(`${BASE}/#/`, { waitUntil: 'domcontentloaded' });
await settle(page, 2600);
// fullPage:13 张卡要一张不缺 —— 截一半的图会让人以为只有 12 个角色
await shoot(page, '01-roster', '指挥舱主视图 —— 13 张角色卡、状态灯、在打的怪、告警组', { fullPage: true });

// ── 2 角色详情(场景 2:点开看技能栏/装备栏/战绩) ────────────
// 同样要滤敏感内容:详情页也展示交付原文(与下面的 SENSITIVE 同一套规则,
// 所以这里先把规则提到前面定义)
const SENSITIVE = [
  /123456/, /password/i, /passwd/i, /api[_-]?key/i,
  /bearer\s/i, /sk-[a-z0-9]{16,}/i, /gho_/, /ghp_/, /-----BEGIN/, /MYSQL_PWD/,
];
const looksSensitive = (text) => SENSITIVE.some((re) => re.test(text));

/** 拉一个角色详情,并判断它展示的交付原文干不干净 */
async function agentClean(agentId) {
  const res = await page.request.get(`${BASE}/api/agents/${agentId}`);
  const b = await res.json();
  const text = (b?.data?.recent_battles ?? []).map((x) => x?.output_excerpt ?? '').join('\n');
  return { ok: !looksSensitive(text), data: b?.data };
}

const entries = await roster(page);
// 挑一个「有战绩、且交付原文干净」的角色 —— 详情页内容最全
let pickAgent = null;
for (const e of entries) {
  if (!e.battles_loaded) continue;
  const c = await agentClean(e.agent_id);
  if (!c.ok) { console.log(`  ⚠ ${e.display_name} 的交付原文含敏感样式,跳过`); continue; }
  if (c.data?.stats?.total) { pickAgent = e; break; }
}
if (!pickAgent) pickAgent = entries.find((e) => e.state === 'stalled') ?? entries[0];

if (pickAgent) {
  await page.goto(`${BASE}/#/agents/${pickAgent.agent_id}`, { waitUntil: 'domcontentloaded' });
  await settle(page, 2200);
  await shoot(page, '02-agent', `角色详情 —— ${pickAgent.display_name}(${pickAgent.role_title})`);
} else {
  console.log('  ⚠ 拿不到 roster,跳过角色详情');
}

// ── 3 战役列表 ────────────────────────────────────────────
await page.goto(`${BASE}/#/projects`, { waitUntil: 'domcontentloaded' });
await settle(page, 1800);
await shoot(page, '03-projects', '战役列表 —— 项目=章节,进度条');

// ── 4 战役地图(场景 4:关卡按 stage 排布) ──────────────────
const projRes = await page.request.get(`${BASE}/api/projects`);
const projBody = await projRes.json();
const projects = projBody?.data ?? [];
// 挑关卡最多的那个战役,地图内容才够看
// 注意:节点数组字段叫 quests(不是 nodes),数错了会挑到一个空地图
let best = null;
for (const p of projects) {
  const m = await page.request.get(`${BASE}/api/projects/${p.project_id ?? p.id}/map`);
  const mb = await m.json();
  const n = (mb?.data?.stages ?? []).reduce((a, s) => a + (s.quests?.length ?? 0), 0)
    + (mb?.data?.unstaged?.length ?? 0);
  if (!best || n > best.n) best = { p, n };
}
if (best && best.n > 0) {
  const pid = best.p.project_id ?? best.p.id;
  await page.goto(`${BASE}/#/projects/${pid}`, { waitUntil: 'domcontentloaded' });
  await settle(page, 2200);
  await shoot(page, '04-campaign', `战役地图 —— ${best.p.title}(${best.n} 个关卡节点)`);
} else {
  console.log('  ⚠ 所有战役都没有关卡节点,跳过战役地图');
}

// ── 5 战斗回放(场景 5:接力链时间轴) ───────────────────────
// 从 roster 里找一条有接力链的任务:挑一个战绩里有最近战斗的角色
// 找一条最长的干净接力链
//
// ⚠️ 为什么必须滤「干净」:回放页展示的是任务交付原文(output_excerpt),
// 里面可能夹着口令、密钥这类东西(实测 MTM-251 那条链里就有 admin/123456)。
// 本仓库是 PUBLIC 的 —— 直接把这种截图提交进去 = 把口令公开给所有人。
// 所以只挑不含敏感模式的链;滤完没有就干脆不抓这张图(宁可缺图,不能泄密)。
let bestChain = { taskId: null, n: 0, who: null };
let skipped = 0;
for (const e of entries) {
  if (!e.battles_loaded) continue;
  const res = await page.request.get(`${BASE}/api/agents/${e.agent_id}`);
  const b = await res.json();
  for (const cand of (b?.data?.recent_battles ?? []).slice(0, 8)) {
    if (!cand?.task_id) continue;
    const c = await page.request.get(`${BASE}/api/battles/${cand.task_id}/chain`);
    const cb = await c.json();
    const nodes = cb?.data?.nodes ?? [];
    const n = nodes.length;
    if (n <= bestChain.n) continue;
    const text = nodes.map((x) => x?.battle?.output_excerpt ?? '').join('\n');
    if (looksSensitive(text)) { skipped += 1; continue; }
    bestChain = { taskId: cand.task_id, n, who: e.display_name };
  }
}
if (skipped) console.log(`  ⚠ 跳过了 ${skipped} 条含口令/密钥样式的链(不入公开仓库)`);
if (bestChain.taskId) {
  await page.goto(`${BASE}/#/battles/${bestChain.taskId}`, { waitUntil: 'domcontentloaded' });
  await settle(page, 2200);
  // 裁剪:整条链有 10 棒、全页图将近 6000px 高且 3MB —— 贴文档没人看得完。
  // 截前面几棒(能看出「接力」的样子就够了),正文里写明实际棒数。
  await shoot(page, '05-replay', `战斗回放 —— 接力链 ${bestChain.n} 棒(${bestChain.who},截图只取前几棒)`, {
    clip: { x: 0, y: 0, width: 1600, height: 1250 },
  });
} else {
  console.log('  ⚠ 没找到可用任务,跳过战斗回放');
}

// ── 6 像素资产样张(13 角色 4 态) ────────────────────────
// 单独的小服务器,和主服务不同端口。
// 只截「13 角色 × 4 状态」那一块 —— 整页 12000px 高、 1.6MB,
// 而且文档要的就是这张对照表,其余 section 在 pixel/README.md 里本来就有说明。
const stylePage = await browser.newPage({
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 2,
});
try {
  await stylePage.goto('http://127.0.0.1:5178/styleguide/', { waitUntil: 'domcontentloaded', timeout: 8000 });
  await stylePage.waitForTimeout(2500);
  const panel = stylePage.locator('#roster');
  await panel.screenshot({ path: `${OUT}/06-pixel-styleguide.png` });
  notes.push('06-pixel-styleguide.png  13 角色 × 4 状态立绘对照表');
  console.log('  ✔ 06-pixel-styleguide.png  13 角色立绘对照表');
} catch {
  console.log('  ⚠ 样张服务器没起(node pixel/tools/serve.js),跳过像素样张');
}

// ── 7 派活确认页(场景 3 的界面) ──────────────────────────
// 「走到确认页为止」—— 不点最后那个提交按钮。
// 派活是真的建 issue、真的烧用量,截图当然不能真提。
// 这张图本身就是「两段式确认 + 后果明写」的直接证据,不再另外裁弹窗。
await page.goto(`${BASE}/#/`, { waitUntil: 'domcontentloaded' });
await settle(page, 2200);
try {
  await page.locator('[data-dispatch-open]').click();
  await page.locator('[data-dispatch-title]').fill('给角色派个活(示意图,不会真提交)');
  const first = entries[0];
  if (first) await page.locator('[data-dispatch-agent]').selectOption(first.agent_id);
  await page.locator('[data-dispatch-next]').click();
  await page.waitForTimeout(600);
  await shoot(page, '07-dispatch', '舱内派活 —— 两段式确认页,后果明写(图中未提交)');
} catch {
  console.log('  ⚠ 派活弹窗打不开,跳过');
}

await browser.close();

console.log(`\n写到 ${OUT}`);
console.log(`共 ${notes.length} 张\n`);
