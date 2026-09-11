/**
 * 安全边界单测 —— 对应 docs/security.md 里的规则编号。
 * 这几条挂了就是「任何人能指挥全队」,是硬底线,不许为了方便放松。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isAllowedHost, isAllowedOrigin, isLanHost, RateLimiter, validateDispatch, validateShout,
  WRITE_ALLOWLIST, isAllowedWrite, LIMITS,
} from '../src/server/guard.ts';
import { DEFAULT_HOST, loadConfig } from '../src/server/config.ts';
import { assertSafeArg, assertUuid, MulticaCliError } from '../src/multica/source.ts';

const PORT = 4780;
const UUID = '335fc087-bd33-403c-817e-9e9d0c4dd00f';

test('N2:Host 必须是内网/回环 IP,公网 IP 和域名一律拒(挡 DNS rebinding)', () => {
  // 本机三种写法
  assert.equal(isAllowedHost('127.0.0.1:4780', PORT), true);
  assert.equal(isAllowedHost('localhost:4780', PORT), true);
  assert.equal(isAllowedHost('[::1]:4780', PORT), true);
  // 内网三种网段(heory 拍板 C 案:内网可看可操作)
  assert.equal(isAllowedHost('192.168.1.9:4780', PORT), true, 'C 案:内网放行');
  assert.equal(isAllowedHost('10.0.0.5', PORT), true, '10/8,不带端口也认');
  assert.equal(isAllowedHost('172.16.0.1:4780', PORT), true, '172.16/12');
  // 公网 IP 一律拒 —— 内网开放不等于公网开放
  assert.equal(isAllowedHost('8.8.8.8:4780', PORT), false, '公网 IP 拒');
  assert.equal(isAllowedHost('172.32.0.1:4780', PORT), false, '172.32 已出 172.16/12 范围,是公网');
  assert.equal(isAllowedHost('192.169.1.1:4780', PORT), false, '192.169 不在 192.168/16 内');
  // 域名一律拒(哪怕它真解析到内网机器)—— 只认字面 IP
  assert.equal(isAllowedHost('evil.example.com:4780', PORT), false);
  assert.equal(isAllowedHost('nas.home.arpa:4780', PORT), false);
  assert.equal(isAllowedHost(undefined, PORT), false);
  assert.equal(isAllowedHost('127.0.0.1:9999', PORT), false, '端口不对也要拒');
  assert.equal(isAllowedHost('192.168.1.9:9999', PORT), false, '内网 IP 端口不对也拒');
});

test('isLanHost:RFC1918 三段 + 回环,其余全不算内网', () => {
  for (const ok of ['localhost', '127.0.0.1', '::1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.100.100']) {
    assert.equal(isLanHost(ok), true, ok);
  }
  for (const bad of ['172.32.0.1', '172.15.0.1', '192.169.0.1', '11.0.0.1', '8.8.8.8', '0.0.0.0', '256.1.1.1', '1.2.3', 'example.com', '']) {
    assert.equal(isLanHost(bad), false, bad);
  }
});

test('N1:默认监听 0.0.0.0(C 案),COCKPIT_HOST 可收回本机', () => {
  assert.equal(DEFAULT_HOST, '0.0.0.0');
  delete process.env.COCKPIT_HOST;
  assert.equal(loadConfig().host, '0.0.0.0', '不配就听全部网卡(内网开放)');
  process.env.COCKPIT_HOST = '127.0.0.1';
  assert.equal(loadConfig().host, '127.0.0.1', '想收回本机随时能收');
  process.env.COCKPIT_HOST = '0.0.0.0';
  assert.equal(loadConfig().host, '0.0.0.0');
  delete process.env.COCKPIT_HOST;
});

test('N3:带了 Origin 就必须是本机或内网,挡浏览器里的恶意页面', () => {
  assert.equal(isAllowedOrigin(undefined, PORT), true, '同源请求通常不带 Origin');
  assert.equal(isAllowedOrigin('http://127.0.0.1:4780', PORT), true);
  assert.equal(isAllowedOrigin('http://192.168.1.9:4780', PORT), true, 'C 案:内网来源放行');
  assert.equal(isAllowedOrigin('https://evil.example.com', PORT), false);
  assert.equal(isAllowedOrigin('https://192.168.1.9', PORT), false, 'https 不是指挥舱提供的来源');
  assert.equal(isAllowedOrigin('null', PORT), false);
});

test('N3:开发端口默认不放行 —— 不配 COCKPIT_DEV_ORIGIN_PORTS 就一个额外来源都没有', () => {
  // 第一版把 Vite 的 5173 硬编码进了允许列表,等于长期留着一个口子。
  assert.equal(isAllowedOrigin('http://localhost:5173', PORT), false);
  assert.equal(isAllowedOrigin('http://127.0.0.1:5173', PORT), false);
});

test('N3:配了开发端口才放行,且只放行本机的那个端口', () => {
  assert.equal(isAllowedOrigin('http://localhost:5173', PORT, [5173]), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:5173', PORT, [5173]), true);
  assert.equal(isAllowedOrigin('http://localhost:5174', PORT, [5173]), false, '只开配的那个端口');
  assert.equal(isAllowedOrigin('https://evil.example.com', PORT, [5173]), false);
  assert.equal(isAllowedOrigin('https://localhost:5173', PORT, [5173]), false, 'https 也不是同一个来源');
  // 关键性质:配置项只收端口号,再怎么误用也变不出一个外部域名。
  assert.equal(isAllowedOrigin('http://evil.example.com:5173', PORT, [5173]), false);
  assert.equal(isAllowedOrigin('http://192.168.1.9:4780', PORT, [5173]), true, '内网放行不受开发端口配置影响');
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
