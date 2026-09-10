/**
 * 静态资源层的单测 —— 「一条命令跑起来」这个收口条件的执行体。
 *
 * 这一层存在的理由:收口前起指挥舱要两条命令(根上 `npm start` 起 BFF、
 * 再 `cd web && npm run dev` 起界面),而验收要的是**一条**。
 * 现在 BFF 自己把 `web/dist` 端出去,界面和接口同源同端口。
 *
 * 同源带来一个必须被按住的后果:静态层跟接口层共用那道安全闸,
 * 而它是唯一一个**按路径读磁盘**的地方 —— 路径穿越是这里的头号风险,
 * 所以下面第一组测试就是穿越,后面才是正常路径。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStaticServer, contentTypeOf } from '../src/server/static.ts';

/** 造一个假的 web/dist:index.html + 一个带哈希的 assets 产物。 */
function makeDist(): string {
  const root = mkdtempSync(join(tmpdir(), 'cockpit-dist-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>指挥舱</title>', 'utf8');
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'app-abc123.js'), 'console.log(1)', 'utf8');
  writeFileSync(join(root, 'assets', 'app-abc123.css'), '.a{}', 'utf8');
  return root;
}

test('路径穿越一律拒绝 —— 这台机器上的任何文件都不许被端出去', async () => {
  const root = makeDist();
  const secret = join(root, '..', 'cockpit-secret.txt');
  writeFileSync(secret, 'TOKEN', 'utf8');
  try {
    const s = createStaticServer(root);
    for (const attack of [
      '/../cockpit-secret.txt',
      '/assets/../../cockpit-secret.txt',
      '/%2e%2e/cockpit-secret.txt',
      '/..%2fcockpit-secret.txt',
      '/....//cockpit-secret.txt',
    ]) {
      const res = await s.serve(attack);
      assert.notEqual(res?.body.toString('utf8'), 'TOKEN', `穿越成功了:${attack}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(secret, { force: true });
  }
});

test('/api 开头的路径静态层一概不接 —— 那是路由层的地盘', async () => {
  const root = makeDist();
  try {
    const s = createStaticServer(root);
    assert.equal(await s.serve('/api/roster'), null);
    assert.equal(await s.serve('/api/health'), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('根路径给 index.html,而且不许被缓存', async () => {
  const root = makeDist();
  try {
    const s = createStaticServer(root);
    const res = await s.serve('/');
    assert.equal(res?.status, 200);
    assert.match(res!.body.toString('utf8'), /指挥舱/);
    assert.match(res!.headers['content-type'] ?? '', /text\/html/);
    // 入口 HTML 缓存了就等于换了版本还看旧界面 —— 本机工具不值得为这点带宽冒险。
    assert.equal(res!.headers['cache-control'], 'no-store');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('带哈希的产物可以长缓存 —— 内容变了文件名就变了', async () => {
  const root = makeDist();
  try {
    const s = createStaticServer(root);
    const js = await s.serve('/assets/app-abc123.js');
    assert.equal(js?.status, 200);
    assert.match(js!.headers['content-type'] ?? '', /javascript/);
    assert.match(js!.headers['cache-control'] ?? '', /immutable/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('不存在的「像页面」的路径回落到 index.html,像文件的路径直接没有', async () => {
  const root = makeDist();
  try {
    const s = createStaticServer(root);
    // 路由是 hash 的(#/agents/:id),正常不会走到这里;真被手敲出来也得是界面不是 404。
    const page = await s.serve('/whatever');
    assert.equal(page?.status, 200);
    assert.match(page!.body.toString('utf8'), /指挥舱/);
    // 缺了的资源必须老实说没有,回落成 HTML 只会让浏览器报一句看不懂的 MIME 错。
    assert.equal(await s.serve('/assets/missing-xyz.js'), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('没构建过时给一页人话说明,而不是白屏或 404', async () => {
  const s = createStaticServer(join(tmpdir(), 'cockpit-dist-does-not-exist'));
  const res = await s.serve('/');
  assert.equal(res?.status, 503);
  const html = res!.body.toString('utf8');
  assert.match(html, /npm run build:web/, '得直接把该敲的命令写在页面上');
  assert.doesNotMatch(html, /Error:|at Object\./, '不许把 Node 的报错栈端给用户');
});

test('content-type 表覆盖 vite 会吐出来的产物', () => {
  assert.match(contentTypeOf('a.html'), /text\/html/);
  assert.match(contentTypeOf('a.js'), /javascript/);
  assert.match(contentTypeOf('a.css'), /text\/css/);
  assert.match(contentTypeOf('a.json'), /application\/json/);
  assert.match(contentTypeOf('a.svg'), /image\/svg/);
  assert.match(contentTypeOf('a.png'), /image\/png/);
  assert.match(contentTypeOf('a.woff2'), /font\/woff2/);
  // 认不出来的一律当字节流,绝不猜成 html(猜错 = 把任意文件变成可执行页面)
  assert.equal(contentTypeOf('a.weird'), 'application/octet-stream');
});

test('文本类型都带 charset=utf-8 —— 中文界面漏了这个就是一屏乱码', () => {
  for (const f of ['a.html', 'a.js', 'a.css', 'a.json', 'a.svg']) {
    assert.match(contentTypeOf(f), /charset=utf-8/, `${f} 少了 charset`);
  }
});
