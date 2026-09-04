#!/usr/bin/env node
/**
 * 看样张用的静态服务器。零依赖 —— 不用 npm install,拉下仓库就能跑。
 *
 *   node pixel/tools/serve.js        → http://127.0.0.1:5178/styleguide/
 *   node pixel/tools/serve.js 6000   → 换端口
 *
 * 只监听 127.0.0.1,和父任务定的本地安全边界一致(服务绝不暴露到公网)。
 * 这个服务器只是为了看样张;正式页面跑在周构那套骨架里,不依赖它。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2]) || 5178;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    // 归一化之后必须仍在 ROOT 之内,挡掉 ../../ 穿越
    let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!path.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }

    const info = await stat(path).catch(() => null);
    if (info?.isDirectory()) path = join(path, 'index.html');

    const body = await readFile(path);
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`像素样张:  http://127.0.0.1:${PORT}/styleguide/`);
  console.log('Ctrl+C 停止');
});
