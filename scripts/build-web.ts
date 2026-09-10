/**
 * 「一条命令跑起来」的前半段:需要的时候才构建界面。
 *
 * 收口前起指挥舱要三步(根上 npm start、cd web、npm install && npm run dev),
 * 而验收条件是**克隆下来一条命令**。所以 `npm start` 先过这里:
 *   1. `web/node_modules` 不在 → `npm install`(只有前端有依赖,根上仍是零依赖)
 *   2. `web/dist` 不在、或者比源码旧 → `npm run build`
 *   3. 都新 → 什么都不做,直接放行(常态就是这条,几毫秒)
 *
 * 为什么按 mtime 判而不是每次都构建:每次都构建 = 每次 npm start 多等十几秒,
 * 而这个工具的定位是「heory 每天开着不关」,启动那几秒是会被记住的。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(REPO_ROOT, 'web');
const DIST_INDEX = join(WEB, 'dist', 'index.html');

/** 构建产物的输入:改了这些里的任何一个文件,dist 就过期了。 */
const SOURCES = [
  join(WEB, 'src'),
  join(WEB, 'index.html'),
  join(WEB, 'vite.config.ts'),
  join(WEB, 'package.json'),
  join(REPO_ROOT, 'pixel'), // 皮肤和立绘被前端直接 import
  join(REPO_ROOT, 'src', 'contract', 'types.ts'), // 契约是前端唯一认的类型源
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

function newestMtime(path: string): number {
  let st;
  try {
    st = statSync(path);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = st.mtimeMs;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    newest = Math.max(newest, newestMtime(join(path, entry.name)));
  }
  return newest;
}

function run(cmd: string, args: string[], cwd: string): void {
  // Windows 上 npm 是 npm.cmd,不走 shell 会 ENOENT。
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.status !== 0) {
    process.stderr.write(`\n构建界面失败:\`${cmd} ${args.join(' ')}\` 在 ${cwd} 退出码 ${res.status}\n`);
    process.exit(res.status ?? 1);
  }
}

/** dist 需要重建吗?返回 null = 不需要,返回字符串 = 需要,内容是给人看的理由。 */
export function buildReason(): string | null {
  if (!existsSync(DIST_INDEX)) return '界面还没构建过';
  const dist = statSync(DIST_INDEX).mtimeMs;
  const src = Math.max(...SOURCES.map(newestMtime));
  return src > dist ? '界面源码比上次构建新' : null;
}

export function ensureWebBuild(): void {
  const reason = buildReason();
  if (reason == null) return;
  process.stdout.write(`${reason},构建一次(只有第一次慢,之后自动跳过)…\n`);
  if (!existsSync(join(WEB, 'node_modules'))) {
    process.stdout.write('装前端依赖(npm install)…\n');
    run('npm', ['install', '--no-audit', '--no-fund'], WEB);
  }
  run('npm', ['run', 'build'], WEB);
}

/** 强制构建,不看 mtime —— 人手敲 `npm run build:web` 通常就是因为怀疑产物不对。 */
export function forceWebBuild(): void {
  if (!existsSync(join(WEB, 'node_modules'))) run('npm', ['install', '--no-audit', '--no-fund'], WEB);
  run('npm', ['run', 'build'], WEB);
}

const isMain = process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) forceWebBuild();
