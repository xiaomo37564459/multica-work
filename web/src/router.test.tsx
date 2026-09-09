/** hash 路由:五屏的地址就是导航契约,链接可收藏、刷新不丢。 */
import { describe, it, expect } from 'vitest';
import { parseHash, hashOf } from './router.ts';

describe('parseHash', () => {
  it('空/未知 → 主视图', () => {
    expect(parseHash('')).toEqual({ screen: 'roster' });
    expect(parseHash('#/')).toEqual({ screen: 'roster' });
    expect(parseHash('#/nope/xyz')).toEqual({ screen: 'roster' });
  });
  it('五屏各有其址', () => {
    expect(parseHash('#/agents/abc')).toEqual({ screen: 'agent', id: 'abc' });
    expect(parseHash('#/projects')).toEqual({ screen: 'projects' });
    expect(parseHash('#/projects/p1')).toEqual({ screen: 'campaign', id: 'p1' });
    expect(parseHash('#/battles/t1')).toEqual({ screen: 'replay', taskId: 't1' });
  });
  it('id 里的 URL 编码要解开', () => {
    expect(parseHash('#/agents/a%20b')).toEqual({ screen: 'agent', id: 'a b' });
  });
  it('hashOf 与 parseHash 互逆', () => {
    const r = { screen: 'campaign', id: 'p1' } as const;
    expect(parseHash(hashOf(r))).toEqual(r);
  });
});
