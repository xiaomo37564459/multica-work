/**
 * CLI 调用失败时那句话到底说清了没有 —— MTM-279 压测时被这句话卡住过。
 *
 * 压 CLI 的时候抓到 5 次 `agent_tasks` 降级,`/api/health` 里的 last_error 是:
 *
 *     multica agent tasks 调用失败
 *
 * 就这么一句。超时?退出码几?stderr 说了什么?一个都没有。
 * 拿着这句话什么都查不下去 —— 而这恰恰是唯一一条会在半夜自己出现的错误。
 *
 * 所以这里把「怎么描述一次失败」抽成纯函数按住:退出码、信号、超时、stderr 摘要,
 * 有什么写什么;都没有也得说清「没留下任何线索」,而不是含糊一句「调用失败」。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeCliFailure, isTimeout } from '../src/multica/source.ts';

test('超时:直接说超时,并带上超时阈值', () => {
  const msg = describeCliFailure(['agent', 'tasks', 'x'], { timedOut: true, code: null, signal: 'SIGTERM', stderr: '' }, 15_000);
  assert.match(msg, /agent tasks/);
  assert.match(msg, /超时/);
  assert.match(msg, /15000|15 ?s|15秒|15 秒/, '得说清是多久的超时,不然没法判断该不该调阈值');
});

test('非零退出码:写进消息 —— 这是最常用的第一手线索', () => {
  const msg = describeCliFailure(['agent', 'tasks', 'x'], { timedOut: false, code: 1, signal: null, stderr: '' }, 15_000);
  assert.match(msg, /退出码 1/);
});

test('被信号打死:写清是哪个信号', () => {
  const msg = describeCliFailure(['issue', 'list'], { timedOut: false, code: null, signal: 'SIGKILL', stderr: '' }, 15_000);
  assert.match(msg, /SIGKILL/);
});

test('有 stderr 就带上摘要,但要截断 —— 上游可能把 issue 正文吐在里面', () => {
  const long = 'E'.repeat(1000);
  const msg = describeCliFailure(['issue', 'list'], { timedOut: false, code: 2, signal: null, stderr: long }, 15_000);
  assert.match(msg, /退出码 2/);
  assert.ok(msg.length < 600, `消息长度 ${msg.length},stderr 没截断`);
  assert.match(msg, /EEE/);
});

test('什么线索都没有:明说没有,不许含糊一句「调用失败」了事', () => {
  const msg = describeCliFailure(['agent', 'tasks', 'x'], { timedOut: false, code: null, signal: null, stderr: '' }, 15_000);
  assert.match(msg, /agent tasks/);
  assert.match(msg, /没有留下/, '含糊的错误消息等于没有错误消息');
});

/**
 * 超时到底认没认出来 —— 压测抓到的那句「收到信号 SIGTERM」就是没认出来的样子。
 *
 * Node 的 execFile 超时之后,是**发 SIGTERM 杀掉子进程**,回调里 `err.killed === true`、
 * `err.signal === 'SIGTERM'`、`err.code === null`。原来的判定写的是
 * `/killed/i.test(signal)` —— 拿「killed」这个词去比 signal 字符串,
 * 只有 SIGKILL 能撞上,SIGTERM 永远撞不上。于是每一次 15 秒超时都被当成普通失败:
 *   - 错误消息里没有「超时」两个字,查的人根本想不到该去调 COCKPIT_CLI_TIMEOUT_MS
 *   - MulticaCliError.timedOut 是 false,写操作超时会应答 502 而不是契约定的 504
 */
test('超时判定:execFile 超时是 killed=true + SIGTERM,不是 SIGKILL', () => {
  assert.equal(isTimeout({ code: null, signal: 'SIGTERM', killed: true }), true, 'Node 超时就长这样');
  assert.equal(isTimeout({ code: 'ETIMEDOUT', signal: null, killed: false }), true);
  assert.equal(isTimeout({ code: null, signal: 'SIGKILL', killed: true }), true);
  // 普通的非零退出不是超时 —— 认错了会让人去调一个跟本次故障无关的旋钮
  assert.equal(isTimeout({ code: 1, signal: null, killed: false }), false);
  assert.equal(isTimeout({ code: 'ENOENT', signal: null, killed: false }), false);
});

test('消息里不带参数值 —— 参数里有 UUID,自检接口不该长期存这些', () => {
  const msg = describeCliFailure(
    ['agent', 'tasks', 'b6a0e9a1-56d4-4273-bc90-07994f876961'],
    { timedOut: false, code: 1, signal: null, stderr: '' },
    15_000,
  );
  assert.doesNotMatch(msg, /b6a0e9a1/);
});
