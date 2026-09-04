/**
 * 缓存 / 退避 / 单飞的单测。
 * 最要紧的一条:**拉取失败绝不能把界面清空**。这条挂了,heory 打开页面看到的就是白屏。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BACKOFF_BASE_MS, CacheCell, KeyedCache, RoundRobin } from '../src/server/cache.ts';

test('拉成功后 snapshot 带值,age 从 0 开始', async () => {
  let now = 1000;
  const cell = new CacheCell('t', 5_000, async () => 'v1', () => now);
  await cell.refresh();
  now = 1200;
  const s = cell.snapshot();
  assert.equal(s.value, 'v1');
  assert.equal(s.age_ms, 200);
  assert.equal(s.stale, false);
});

test('超过 maxAge 标 stale,但值照样返回', async () => {
  let now = 0;
  const cell = new CacheCell('t', 1_000, async () => 'v1', () => now);
  await cell.refresh();
  now = 5_000;
  const s = cell.snapshot();
  assert.equal(s.stale, true);
  assert.equal(s.value, 'v1', 'stale 不等于没有数据');
});

test('拉取失败不清空旧值,也不抛出去', async () => {
  let now = 0;
  let mode: 'ok' | 'boom' = 'ok';
  const cell = new CacheCell('t', 5_000, async () => {
    if (mode === 'boom') throw new Error('CLI 挂了');
    return 'good';
  }, () => now);

  await cell.refresh();
  assert.equal(cell.snapshot().value, 'good');

  mode = 'boom';
  now = 100;
  const returned = await cell.refresh();
  assert.equal(returned, 'good', 'refresh 失败时返回旧值');
  const s = cell.snapshot();
  assert.equal(s.value, 'good', '旧值必须还在');
  assert.equal(s.consecutive_failures, 1);
  assert.match(s.last_error ?? '', /CLI 挂了/);
});

test('连续失败退避:间隔翻倍,退避期内不再发起拉取', async () => {
  let now = 0;
  let calls = 0;
  const cell = new CacheCell('t', 5_000, async () => {
    calls += 1;
    throw new Error('boom');
  }, () => now);

  await cell.refresh();
  assert.equal(calls, 1);
  assert.equal(cell.canRefresh(), false, '刚失败,处于退避期');

  now = BACKOFF_BASE_MS;
  assert.equal(cell.canRefresh(), true);
  await cell.refresh();
  assert.equal(calls, 2);

  // 第二次失败后退避翻倍到 4s
  now = BACKOFF_BASE_MS + BACKOFF_BASE_MS;
  assert.equal(cell.canRefresh(), false, '第二次失败后退避应该更久');
  now = BACKOFF_BASE_MS + BACKOFF_BASE_MS * 2;
  assert.equal(cell.canRefresh(), true);
});

test('成功一次立刻复位退避', async () => {
  let now = 0;
  let mode: 'ok' | 'boom' = 'boom';
  const cell = new CacheCell('t', 5_000, async () => {
    if (mode === 'boom') throw new Error('boom');
    return 'v';
  }, () => now);

  await cell.refresh();
  assert.equal(cell.canRefresh(), false);

  mode = 'ok';
  now = BACKOFF_BASE_MS;
  await cell.refresh();
  assert.equal(cell.snapshot().consecutive_failures, 0);
  assert.equal(cell.canRefresh(), true);
});

test('单飞:并发 refresh 只触发一次真实拉取', async () => {
  let calls = 0;
  let release: (v: string) => void = () => {};
  const cell = new CacheCell('t', 5_000, () => {
    calls += 1;
    return new Promise<string>((resolve) => { release = resolve; });
  });

  const a = cell.refresh();
  const b = cell.refresh();
  const c = cell.refresh();
  release('v');
  const [ra, rb, rc] = await Promise.all([a, b, c]);
  assert.equal(calls, 1, '三个并发调用只该打一次 CLI');
  assert.deepEqual([ra, rb, rc], ['v', 'v', 'v']);
});

test('KeyedCache:一个 key 挂了不拖累别的 key', async () => {
  const kc = new KeyedCache<string>('agent_tasks', 5_000, async (key) => {
    if (key === 'bad') throw new Error('这个 agent 拉不动');
    return `ok:${key}`;
  });

  await Promise.all([kc.refresh('bad'), kc.refresh('good')]);
  assert.equal(kc.get('good').value, 'ok:good');
  assert.equal(kc.get('good').consecutive_failures, 0);
  assert.equal(kc.get('bad').consecutive_failures, 1);
  assert.equal(kc.worstFailures(), 1);
});

test('轮巡游标循环覆盖全体,不漏人', () => {
  const rr = new RoundRobin();
  const keys = ['a', 'b', 'c', 'd', 'e'];
  const seen = new Set<string>();
  for (let i = 0; i < 3; i += 1) for (const k of rr.next(keys, 2)) seen.add(k);
  assert.equal(seen.size, 5, '三轮每轮 2 个应该覆盖完 5 个人');
});

test('轮巡在空名单上不炸', () => {
  assert.deepEqual(new RoundRobin().next([], 2), []);
});
