/**
 * 静态资源层 —— 把 `web/dist` 端出去,让接口和界面同一个端口。
 *
 * 为什么要有这一层(MTM-279 的收口条件):
 *   之前起指挥舱要两条命令 —— 根上 `npm start` 起 BFF,再 `cd web && npm run dev` 起界面,
 *   而且界面默认吃 mock。验收要的是「克隆主干、一条命令跑起来」,所以 BFF 自己端界面。
 *
 * 同源还顺手解决一件事:Vite 那个端口(5173)是**跨源**,要靠
 * `COCKPIT_DEV_ORIGIN_PORTS` 开口子才能打接口。同源之后开发期以外根本不用开这个口 ——
 * 少一个「为了能用而放宽的安全配置」,见 docs/security.md 规则 N3。
 *
 * 这是全服务唯一一处**按用户给的路径读磁盘**的代码。路径穿越是这里唯一要紧的风险:
 * 一次穿越 = 本机任意文件从 HTTP 端口流出去。所以下面用 resolve 后的前缀比对硬挡,
 * 不做任何字符串层面的「过滤 ..」—— 那类写法历史上被绕过太多次了。
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

export interface StaticAsset {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/** vite 会吐出来的产物类型。认不出来的一律 octet-stream,绝不猜成 html。 */
const TYPES = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

export function contentTypeOf(file: string): string {
  return TYPES.get(extname(file).toLowerCase()) ?? 'application/octet-stream';
}

/** 没构建过时的说明页。**照着页面上的命令敲就能好**,不给报错栈。 */
function notBuiltPage(root: string): StaticAsset {
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>指挥舱 —— 界面还没构建</title>
<style>
 body{background:#0d1016;color:#cfd6e4;font:15px/1.7 ui-monospace,Consolas,monospace;padding:8vh 6vw}
 h1{color:#7ee0c0;font-size:20px} code{background:#1a2030;color:#ffd479;padding:2px 6px;border-radius:3px}
 pre{background:#151a26;border-left:3px solid #7ee0c0;padding:12px 16px;overflow:auto}
 a{color:#7ec8ff}
</style></head><body>
<h1>界面还没构建好</h1>
<p>接口是好的 —— <a href="/api/health">/api/health</a> 现在就能打开。缺的是这个页面本身。</p>
<p>在仓库根目录敲一条命令,构建完刷新本页即可:</p>
<pre>npm run build:web</pre>
<p>平时不用记这条:<code>npm start</code> 会在需要时自动构建。会看到这一页,通常是因为
用了 <code>npm run start:api</code>(只起接口、不带界面),或者构建中途被打断了。</p>
<p class="dim">找的目录:<code>${root.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></p>
</body></html>`;
  return {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
    body: Buffer.from(html, 'utf8'),
  };
}

/**
 * 只有 `assets/` 底下的东西配长缓存。
 *
 * 判据用目录不用文件名:vite 把**带内容哈希的产物**全放这个目录(`assets/[name]-[hash][ext]`),
 * 内容一变文件名就变,缓存一年也不会看到旧版本。按哈希长度猜文件名的写法试过 ——
 * hash 位数随 vite 版本变,猜错就是「改了代码刷新看不到」,比不缓存难查得多。
 */
const HASHED_DIR = 'assets';

export interface StaticServer {
  /** 命中返回响应;返回 null = 这条路径不归静态层管(交给路由层出 404)。 */
  serve(pathname: string): Promise<StaticAsset | null>;
  /** 构建产物在不在 —— 启动时打提示用。 */
  hasBuild(): Promise<boolean>;
}

export function createStaticServer(distRoot: string): StaticServer {
  const root = resolve(distRoot);
  const rootPrefix = root.endsWith(sep) ? root : root + sep;

  /** 把 URL 路径解析成 dist 内的绝对路径;越界或解不开一律 null。 */
  function safeResolve(pathname: string): string | null {
    let decoded: string;
    try {
      // 可能被 %2e%2e 这类编码绕过,所以先解码再 resolve —— 顺序反了就是个洞。
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    if (decoded.includes('\0')) return null;
    const target = resolve(root, '.' + (decoded.startsWith('/') ? decoded : '/' + decoded));
    // 唯一的判据:resolve 之后必须还在 root 里面。字符串层面不做任何「过滤 ..」。
    if (target !== root && !target.startsWith(rootPrefix)) return null;
    return target;
  }

  async function readFileIfExists(file: string): Promise<Buffer | null> {
    try {
      const st = await stat(file);
      if (!st.isFile()) return null;
      return await readFile(file);
    } catch {
      return null;
    }
  }

  function asset(file: string, body: Buffer): StaticAsset {
    const hashed = file.startsWith(resolve(root, HASHED_DIR) + sep);
    return {
      status: 200,
      headers: {
        'content-type': contentTypeOf(file),
        // 入口 HTML 永不缓存(换了版本还看旧界面是本机工具最烦人的一种 bug);
        // 带哈希的产物随便缓存。
        'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      },
      body,
    };
  }

  async function indexHtml(): Promise<StaticAsset> {
    const file = resolve(root, 'index.html');
    const body = await readFileIfExists(file);
    return body ? asset(file, body) : notBuiltPage(root);
  }

  return {
    async hasBuild(): Promise<boolean> {
      return (await readFileIfExists(resolve(root, 'index.html'))) != null;
    },

    async serve(pathname: string): Promise<StaticAsset | null> {
      // 接口的地盘,静态层一概不接 —— 免得 dist 里放个 api 目录就把接口盖了。
      if (pathname === '/api' || pathname.startsWith('/api/')) return null;
      if (pathname === '/' || pathname === '') return indexHtml();

      const target = safeResolve(pathname);
      if (target == null) return null;

      const body = await readFileIfExists(target);
      if (body) return asset(target, body);

      // 没命中:像页面的(没后缀)回落到 index.html —— 路由是 hash 的,正常走不到这儿,
      // 但手敲个 /projects 出来也该是界面。像文件的(有后缀)老实说没有:
      // 回落成 HTML 只会让浏览器报一句用户看不懂的 MIME 错。
      if (extname(pathname) === '') return indexHtml();
      return null;
    },
  };
}
