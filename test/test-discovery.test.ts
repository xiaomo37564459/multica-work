/**
 * 元测试:按住「测试文件静静地不跑」这一类故障。
 *
 * 背景(MTM-280):`npm test` 的脚本原来写死了一条 glob,只覆盖 test 目录下的 .ts,
 * `pixel/tests/sprites.test.js` 27 条一条都没跑到,而屏幕上是 93 全绿 ——
 * **没有报错、没有告警**。测试挂了会被看见,测试不跑不会。
 *
 * 结构上的修法是把 glob 删掉,让 `node --test` 自己递归发现(见 package.json)。
 * 但自动发现按的是**文件名**,还剩一个坑:名字没起对的文件同样是静静地不跑。
 * Node 24 实测:`foo.spec.js` / `foo.tests.js` **不会**被发现 ——
 * 而 `.spec.` 恰好是前端最常用的命名。
 *
 * 所以这里反过来按内容认定:凡是 import 了 `node:test` 的文件,就必须能被自动发现。
 * 名字起错 → 这条测试红,而不是那个文件悄悄消失。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 不扫:依赖、git 元数据、构建产物(产物里的 .test.js 不是我们写的测试)。 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.cache']);

/** 可能是源码的后缀,.ts / .js / .mjs / .cjs / .mts / .cts 全算。 */
const SOURCE_EXT = /\.(?:c|m)?[jt]s$/;

/**
 * `node --test` 的自动发现规则,逐条对齐 Node 24 官方文档并实测过。
 * 顺序和文档一致,方便对照;改 Node 大版本时先来核这张表。
 */
const DISCOVERED_BY_NAME = [
  /^.+\.test\.(?:c|m)?[jt]s$/, //  foo.test.ts   ← 本仓库的标准写法
  /^.+-test\.(?:c|m)?[jt]s$/, //   foo-test.ts
  /^.+_test\.(?:c|m)?[jt]s$/, //   foo_test.ts
  /^test-.+\.(?:c|m)?[jt]s$/, //   test-foo.ts
  /^test\.(?:c|m)?[jt]s$/, //      test.ts
];

/** 认定「这是测试文件」用内容不用文件名 —— 文件名恰恰是会写错的那一环。 */
const IMPORTS_NODE_TEST = /(?:from|require\()\s*['"]node:test['"]/;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
      out.push(relative(REPO_ROOT, full).split(sep).join('/'));
    }
  }
}

/** 仓库里所有源文件(仓库相对路径,统一用 `/`)。 */
const SCANNED: string[] = [];
walk(REPO_ROOT, SCANNED);

/** 其中 import 了 node:test 的,就是测试文件。 */
const TEST_FILES = SCANNED.filter((path) =>
  IMPORTS_NODE_TEST.test(readFileSync(join(REPO_ROOT, path), 'utf8')),
);

/** `node --test` 还有一条规则:名叫 `test` 的目录底下,不管文件叫什么都会被跑。 */
function isDiscovered(path: string): boolean {
  const segments = path.split('/');
  const name = segments.pop() ?? '';
  if (segments.includes('test')) return true;
  return DISCOVERED_BY_NAME.some((pattern) => pattern.test(name));
}

test('每个 import node:test 的文件都必须能被 npm test 自动发现', () => {
  const missed = TEST_FILES.filter((path) => !isDiscovered(path));
  assert.deepEqual(
    missed,
    [],
    `这些文件写了测试但 \`npm test\` 跑不到,会静静地不跑:\n` +
      missed.map((path) => `  - ${path}`).join('\n') +
      `\n改名成 \`xxx.test.js\` / \`xxx.test.ts\`(或放进名为 test 的目录)即可。` +
      `\n注意 \`.spec.\` 和 \`.tests.\` 都不在 node --test 的发现规则里。`,
  );
});

test('扫描器确实走遍了全仓库 —— 空跑的元测试比没有元测试更危险', () => {
  assert.ok(
    SCANNED.length >= 20,
    `只扫到 ${SCANNED.length} 个源文件,扫描器大概率没走对根目录(${REPO_ROOT})`,
  );
  for (const dir of ['src/', 'test/', 'pixel/']) {
    assert.ok(
      SCANNED.some((path) => path.startsWith(dir)),
      `扫描器没走进 ${dir},上面那条断言等于没跑`,
    );
  }
  assert.ok(
    TEST_FILES.some((path) => !path.startsWith('test/')),
    'test/ 之外一条测试都没扫到 —— MTM-280 的 27 条漏跑就是这么发生的',
  );
});
