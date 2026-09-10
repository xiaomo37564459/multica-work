/**
 * 分片缓存(KeyedCache)的健康汇总 —— MTM-279 长跑实测捅出来的洞。
 *
 * 现象:26 分钟的稳态实测里,`meta.degraded` 有 8 次带上了 `agent_tasks`,
 * 界面照规矩挂了黄条「部分数据源拉取失败:agent_tasks」。
 * 然后去 `/api/health` 想看是哪一格、错在哪 —— **那张表里根本没有 agent_tasks**。
 * 自检接口只列了六个整块缓存,三个分片缓存(agent_tasks / runtime_usage / runtime_activity)
 * 一个都不在。于是「有东西坏了」看得见,「坏的是什么」查不到。
 *
 * 一个自检接口最不该有的就是这种盲区,所以这里按住:
 * 分片缓存必须能汇总出一行健康度,而且汇总的是**最差的那一片**(最好的那片没有诊断价值)。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KeyedCache } from '../src/server/cache.ts';

/** 可控时钟,免得测试靠真实时间。 */
function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('一片都还没拉过:汇总是「从没拉到过」,不是假装健康', () => {
  const c = new KeyedCache<string>('agent_tasks', 40_000, async () => 'x');
  const h = c.worstHealth();
  assert.equal(h.fetched_at, null);
  assert.equal(h.age_ms, null);
  assert.equal(h.stale, true, '没拉到过就是过期,不能报 fresh');
  assert.equal(h.consecutive_failures, 0);
  assert.equal(h.last_error, null);
});

test('汇总的是最差的那一片 —— 一个人拉挂了就得看得见', async () => {
  const t = clock();
  const c = new KeyedCache<string>('agent_tasks', 40_000, async (key) => {
    if (key === 'bad') throw new Error('multica agent tasks 超时(15s)');
    return 'ok';
  }, t.now);

  await c.refresh('good');
  await c.refresh('bad');

  const h = c.worstHealth();
  assert.equal(h.consecutive_failures, 1, '好的那片不该把坏的盖掉');
  assert.match(h.last_error ?? '', /超时/, '错误原文必须能查到 —— 这就是这条测试的全部意义');
});

test('汇总的年龄取最旧的一片 —— 「最新一片很新」是假安慰', async () => {
  const t = clock();
  const c = new KeyedCache<string>('agent_tasks', 40_000, async () => 'ok', t.now);

  await c.refresh('a');
  t.advance(30_000);
  await c.refresh('b');

  const h = c.worstHealth();
  assert.equal(h.age_ms, 30_000, '应该报最旧那片的年龄');
  assert.equal(h.stale, false, '30 秒还没到 40 秒阈值');

  t.advance(15_000);
  assert.equal(c.worstHealth().stale, true, '最旧的一片过了阈值,整体就该报过期');
});

test('汇总里不含任何业务数据 —— 自检接口的老规矩(规则 D3)', async () => {
  const c = new KeyedCache<{ secret: string }>('agent_tasks', 40_000, async () => ({ secret: 'TOKEN-1234' }));
  await c.refresh('a');
  const h = c.worstHealth();
  assert.doesNotMatch(JSON.stringify(h), /TOKEN-1234/);
  assert.deepEqual(
    Object.keys(h).sort(),
    ['age_ms', 'consecutive_failures', 'fetched_at', 'last_error', 'stale'],
  );
});
