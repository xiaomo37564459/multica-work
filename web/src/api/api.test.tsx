/**
 * 数据源选择的测试。
 *
 * 收口棒(MTM-279)改了默认值,这里按住的就是那个改动:
 * 初版默认吃 mock —— 那时界面只能靠 `cd web && npm run dev` 起,mock 是唯一开箱能看的东西。
 * 现在 BFF 自己端界面(src/server/static.ts),打开 http://127.0.0.1:4780/ 就该是**真数据**:
 * 一个「看全队在干嘛」的工具,默认给假数据是会让人看着假状态做真决定的。
 *
 * mock 没有删,也不该删 —— 它是唯一能演七种状态齐全的形态,验收和调界面都要用,
 * 现在挂在 `?source=mock` 上。
 */
import { describe, it, expect } from 'vitest';
import { pickSource } from './api.ts';

describe('pickSource', () => {
  it('URL 上写死的最大 —— 不管默认是什么,?source= 说了算', () => {
    expect(pickSource('?source=mock', null, 'live')).toBe('mock');
    expect(pickSource('?source=live', null, 'mock')).toBe('live');
    expect(pickSource('?a=1&source=mock&b=2', 'live', 'live')).toBe('mock');
  });

  it('URL 没写就看 localStorage', () => {
    expect(pickSource('', 'live', 'mock')).toBe('live');
    expect(pickSource('', 'mock', 'live')).toBe('mock');
  });

  it('都没有就用默认值 —— BFF 端出来的界面传 live', () => {
    expect(pickSource('', null, 'live')).toBe('live');
    expect(pickSource('', null, 'mock')).toBe('mock');
  });

  it('不传默认值时仍然是 mock —— 老调用点行为不变', () => {
    expect(pickSource('', null)).toBe('mock');
  });

  it('乱填的值不当真,回落到默认值', () => {
    expect(pickSource('?source=prod', null, 'live')).toBe('live');
    expect(pickSource('', 'LIVE', 'mock')).toBe('mock');
  });
});
