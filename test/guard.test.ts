/**
 * 安全边界单测 —— 对应 docs/security.md 里的规则编号。
 * 这几条挂了就是「任何人能指挥全队」,是硬底线,不许为了方便放松。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isAllowedHost, isAllowedOrigin, RateLimiter, validateDispatch, validateShout,
  WRITE_ALLOWLIST, isAllowedWrite, LIMITS,
} from '../src/server/guard.ts';
import { assertSafeArg, assertUuid, MulticaCliError } from '../src/multica/source.ts';

const PORT = 4780;
const UUID = '335fc087-bd33-403c-817e-9e9d0c4dd00f';

test('N2:只认本机 Host,别的域名一律拒(挡 DNS rebinding)', () => {
  assert.equal(isAllowedHost('127.0.0.1:4780', PORT), true);
  assert.equal(isAllowedHost('localhost:4780', PORT), true);
  assert.equal(isAllowedHost('evil.example.com:4780', PORT), false);
  assert.equal(isAllowedHost('192.168.1.9:4780', PORT), false);
  assert.equal(isAllowedHost(undefined, PORT), false);
  assert.equal(isAllowedHost('127.0.0.1:9999', PORT), false, '端口不对也要拒');
});

test('N3:带了 Origin 就必须是本机,挡浏览器里的恶意页面', () => {
  assert.equal(isAllowedOrigin(undefined, PORT), true, '同源请求通常不带 Origin');
  assert.equal(isAllowedOrigin('http://127.0.0.1:4780', PORT), true);
  assert.equal(isAllowedOrigin('https://evil.example.com', PORT), false);
  assert.equal(isAllowedOrigin('null', PORT), false);
});

test('W1:写操作白名单只有两条', () => {
  assert.deepEqual(Object.keys(WRITE_ALLOWLIST).sort(), ['dispatch', 'shout']);
  assert.equal(isAllowedWrite('dispatch'), true);
  assert.equal(isAllowedWrite('shout'), true);
  assert.equal(isAllowedWrite('issue status'), false);
  assert.equal(isAllowedWrite('agent create'), false);
  assert.equal(isAllowedWrite('__proto__'), false, '原型链上的键不算白名单');
});

test('W1:白名单常量被冻住,运行期加不进去', () => {
  assert.throws(() => {
    'use strict';
    (WRITE_ALLOWLIST as Record<string, string>).danger = 'issue update';
  });
});

test('W2:写操作限流,超了就拒', () => {
  let now = 0;
  const rl = new RateLimiter(3, 1000, () => now);
  assert.equal(rl.tryAcquire(), true);
  assert.equal(rl.tryAcquire(), true);
  assert.equal(rl.tryAcquire(), true);
  assert.equal(rl.tryAcquire(), false, '第 4 次该被拒');
  now = 1001;
  assert.equal(rl.tryAcquire(), true, '窗口滑过去就放行');
});

test('参数注入:以 - 开头的值一律拒(否则等于让调用方随意追加 CLI 参数)', () => {
  assert.throws(() => assertSafeArg('--allow-external-file', 'title'), MulticaCliError);
  assert.throws(() => assertSafeArg('-x', 'title'), MulticaCliError);
  assert.equal(assertSafeArg('正常标题', 'title'), '正常标题');
});

test('参数注入:控制字符一律拒', () => {
  assert.throws(() => assertSafeArg(`a${String.fromCharCode(0)}b`, 'title'), MulticaCliError);
  assert.throws(() => assertSafeArg(`a${String.fromCharCode(10)}b`, 'title'), MulticaCliError);
});

test('UUID 校验挡住非法 id', () => {
  assert.equal(assertUuid(UUID.toUpperCase(), 'id'), UUID);
  assert.throws(() => assertUuid('not-a-uuid', 'id'), MulticaCliError);
  assert.throws(() => assertUuid('../../etc/passwd', 'id'), MulticaCliError);
});

test('派活入参:标题必填、长度受限、不能以 - 开头', () => {
  assert.equal(validateDispatch({ title: '', description: 'd', assignee_agent_id: UUID }).ok, false);
  assert.equal(validateDispatch({ title: '-x', description: 'd', assignee_agent_id: UUID }).ok, false);
  assert.equal(
    validateDispatch({ title: 'a'.repeat(LIMITS.titleMax + 1), description: 'd', assignee_agent_id: UUID }).ok,
    false,
  );
  const good = validateDispatch({ title: '做个东西', description: 'd', assignee_agent_id: UUID });
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.value.assignee_agent_id, UUID);
    assert.equal(good.value.project_id, null, '没传的可选字段归一成 null,不是 undefined');
    assert.equal(good.value.stage, null);
  }
});

test('派活入参:assignee 必须是合法 UUID —— 挡住把名字直接透传给 CLI', () => {
  assert.equal(validateDispatch({ title: 't', description: 'd', assignee_agent_id: '周构' }).ok, false);
});

test('派活入参:stage 必须是 >=1 的整数', () => {
  const bad = validateDispatch({ title: 't', description: 'd', assignee_agent_id: UUID, stage: 0 });
  assert.equal(bad.ok, false);
  const bad2 = validateDispatch({ title: 't', description: 'd', assignee_agent_id: UUID, stage: 1.5 });
  assert.equal(bad2.ok, false);
});

test('派活入参:priority 只认已知取值', () => {
  assert.equal(validateDispatch({ title: 't', description: 'd', assignee_agent_id: UUID, priority: 'critical' }).ok, false);
  assert.equal(validateDispatch({ title: 't', description: 'd', assignee_agent_id: UUID, priority: 'high' }).ok, true);
});

test('喊话入参:issue_id 必须合法,内容不能空、不能超长', () => {
  assert.equal(validateShout({ issue_id: 'x', content: 'hi' }).ok, false);
  assert.equal(validateShout({ issue_id: UUID, content: '   ' }).ok, false);
  assert.equal(validateShout({ issue_id: UUID, content: 'a'.repeat(LIMITS.commentMax + 1) }).ok, false);
  const good = validateShout({ issue_id: UUID, content: '别忘了跑测试' });
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.value.parent_comment_id, null);
});

test('入参不是对象时给 bad_request,不崩', () => {
  assert.equal(validateDispatch(null).ok, false);
  assert.equal(validateDispatch('hello').ok, false);
  assert.equal(validateShout(42).ok, false);
});
