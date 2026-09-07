/**
 * 时间与数字的显示规则。
 * 契约硬规定:算「已耗时」必须用 meta.server_time,不许用浏览器本地时钟 ——
 * 所以这里的函数全都显式收一个「现在」参数,谁偷偷用 Date.now() 谁挂。
 */
import { describe, it, expect } from 'vitest';
import { fmtDuration, fmtClock, elapsedOf, fmtPercent, fmtTokens } from './format.ts';
import type { Battle } from '@contract';

describe('fmtDuration —— 毫秒时长转人话', () => {
  it('秒级', () => {
    expect(fmtDuration(38_000)).toBe('38 秒');
  });
  it('分钟级只保留分', () => {
    expect(fmtDuration(47 * 60_000 + 12_000)).toBe('47 分');
  });
  it('小时级带分', () => {
    expect(fmtDuration(72 * 60_000)).toBe('1 时 12 分');
  });
  it('天级带时', () => {
    expect(fmtDuration(26 * 3_600_000)).toBe('1 天 2 时');
  });
  it('null 显示为占位,不是 0 秒', () => {
    expect(fmtDuration(null)).toBe('—');
  });
  it('负数(时钟漂移)钳到 0,不出现负时长', () => {
    expect(fmtDuration(-5_000)).toBe('0 秒');
  });
});

describe('elapsedOf —— 战斗已耗时,以 server_time 为「现在」', () => {
  const base: Omit<Battle, 'elapsed_ms' | 'started_at' | 'completed_at'> = {} as never;
  const battle = (patch: Partial<Battle>): Battle => ({ ...(base as Battle), ...patch });

  it('running:server_time - started_at,不用 elapsed_ms 之外自己再猜', () => {
    const b = battle({ status: 'running', started_at: '2026-09-06T10:00:00Z', completed_at: null, elapsed_ms: null });
    expect(elapsedOf(b, '2026-09-06T10:47:00Z')).toBe(47 * 60_000);
  });
  it('后端已算好 elapsed_ms 时直接采用', () => {
    const b = battle({ status: 'running', started_at: '2026-09-06T10:00:00Z', completed_at: null, elapsed_ms: 123_000 });
    expect(elapsedOf(b, '2026-09-06T10:47:00Z')).toBe(123_000);
  });
  it('从未开打(started_at null)返回 null,不是 0', () => {
    const b = battle({ status: 'aborted', started_at: null, completed_at: null, elapsed_ms: null });
    expect(elapsedOf(b, '2026-09-06T10:47:00Z')).toBeNull();
  });
});

describe('fmtClock —— 时间戳转本地钟点', () => {
  it('null 安全', () => {
    expect(fmtClock(null)).toBe('—');
  });
  it('合法时间产出 HH:mm 形式', () => {
    expect(fmtClock('2026-09-06T10:05:00Z')).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('fmtPercent —— 胜率', () => {
  it('0.9099 → 91%', () => {
    expect(fmtPercent(0.9099)).toBe('91%');
  });
  it('null(没打过)是占位,不是 0%', () => {
    expect(fmtPercent(null)).toBe('—');
  });
});

describe('fmtTokens —— 蓝条数字', () => {
  it('大数带千分位缩写', () => {
    expect(fmtTokens(1_306_500)).toBe('130.7 万');
    expect(fmtTokens(24_156)).toBe('2.4 万');
    expect(fmtTokens(36)).toBe('36');
  });
});
