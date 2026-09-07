/**
 * /api/health 的单测 —— 重点不是「字段对不对」,而是**有没有业务数据混进来**。
 *
 * 背景:第一版把缓存快照整个展开进了响应,一个自检接口交出了 1.27MB 上游原始返回,
 * 里面有全 workspace 的 issue 正文和 3 个真实邮箱,而 `tsc --noEmit` 完全查不出来
 * (TS 只对字面量做多余属性检查,变量传参会放宽)。
 *
 * 结论:**这类问题类型系统指望不上,只能靠断言按住。**
 * 下面三条按住三个层面:形状(没有多余键)、体积(超了必有鬼)、内容(投毒探针)。
 * 后面几棒新增接口时,照抄「投毒探针」那条。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildHealth, HEALTH_MAX_BYTES } from '../src/server/health.ts';
import { CacheCell } from '../src/server/cache.ts';
import type { SourceName } from '../src/contract/types.ts';

/** 契约里 sources[] 允许出现的键,一个不多一个不少。 */
const ALLOWED_SOURCE_KEYS = [
  'name', 'fetched_at', 'age_ms', 'stale', 'consecutive_failures', 'last_error',
].sort();

const SOURCES: readonly SourceName[] = [
  'issue_active', 'agent_list', 'project_list', 'squad_list', 'runtime_list', 'issue_all',
];

/** 造一个装了真数据的缓存格子 —— 模拟服务跑起来以后的样子。 */
async function loadedCell<T>(name: string, value: T): Promise<CacheCell<T>> {
  const cell = new CacheCell<T>(name, 15_000, async () => value);
  await cell.refresh();
  return cell;
}

async function healthFromCells(value: unknown) {
  const cells = await Promise.all(SOURCES.map((n) => loadedCell(n, value)));
  return buildHealth({
    version: '0.0.0',
    bind: '127.0.0.1:4780',
    cliVersion: '1.2.3',
    deepLinkTemplate: null,
    sources: SOURCES.map((name, i) => ({ name, health: cells[i]!.health() })),
    now: '2026-09-04T09:00:00Z',
  });
}

test('sources[] 只有契约里那 6 个键,绝不带 value', async () => {
  const health = await healthFromCells([{ id: 'i-1', description: '一大段 issue 正文' }]);

  for (const s of health.sources) {
    assert.deepEqual(
      Object.keys(s).sort(),
      ALLOWED_SOURCE_KEYS,
      `${s.name} 的键跟契约对不上 —— 多出来的那个大概率就是上游原始数据`,
    );
    assert.equal(Object.hasOwn(s, 'value'), false, `${s.name} 带上了 value`);
  }
});

test('投毒探针:缓存里的内容一个字节都不许出现在 health 里', async () => {
  // 塞一份「一眼能认出来」的假上游数据:一个邮箱 + 一段超大正文。
  const canaryEmail = 'canary-must-not-leak@example.com';
  const canaryBody = 'X'.repeat(200_000);
  const health = await healthFromCells([
    { id: 'i-1', description: canaryBody, creator: { email: canaryEmail } },
  ]);

  const serialized = JSON.stringify(health);
  assert.equal(serialized.includes(canaryEmail), false, '邮箱漏出去了 —— 违反规则 D1');
  assert.equal(serialized.includes('XXXXXXXXXX'), false, '上游正文漏出去了 —— 违反规则 D3');
});

test(`health 整体不超过 ${HEALTH_MAX_BYTES} 字节 —— 超了必然是混进了业务数据`, async () => {
  const health = await healthFromCells([{ id: 'i-1', description: 'Y'.repeat(500_000) }]);
  const bytes = Buffer.byteLength(JSON.stringify(health), 'utf8');
  assert.ok(bytes < HEALTH_MAX_BYTES, `health 响应 ${bytes} 字节,超过红线 ${HEALTH_MAX_BYTES}`);
});

test('last_error 会被截断 —— 它是给人看的线索,不是数据通道', async () => {
  const cell = new CacheCell<string>('issue_all', 15_000, async () => {
    throw new Error(`multica issue list 失败: ${'Z'.repeat(1_000)}`);
  });
  await cell.refresh();

  const health = buildHealth({
    version: '0.0.0',
    bind: '127.0.0.1:4780',
    cliVersion: null,
    deepLinkTemplate: null,
    sources: [{ name: 'issue_all', health: cell.health() }],
    now: '2026-09-04T09:00:00Z',
  });

  const err = health.sources[0]!.last_error;
  assert.ok(err != null && err.length <= 200, `last_error 应被截断,实际 ${err?.length} 字`);
});

test('拉挂了 health 照样能出,并把失败次数如实报出来', async () => {
  const cell = new CacheCell<string>('agent_list', 15_000, async () => { throw new Error('CLI 挂了'); });
  await cell.refresh();

  const health = buildHealth({
    version: '9.9.9',
    bind: '127.0.0.1:4780',
    cliVersion: null,
    deepLinkTemplate: null,
    sources: [{ name: 'agent_list', health: cell.health() }],
    now: '2026-09-04T09:00:00Z',
  });

  assert.equal(health.cli.available, false);
  assert.equal(health.version, '9.9.9');
  assert.equal(health.sources[0]!.consecutive_failures, 1);
  assert.equal(health.sources[0]!.fetched_at, null);
  assert.equal(health.sources[0]!.stale, true);
});

test('CacheCell.health() 本身就不含 value —— 安全的那条路必须是最好走的那条', async () => {
  const cell = await loadedCell('agent_list', { secret: '不该出现' });
  assert.equal(Object.hasOwn(cell.health(), 'value'), false);
  assert.equal(Object.hasOwn(cell.snapshot(), 'value'), true, 'snapshot() 仍然带 value,给聚合层用');
});
