/**
 * 角色卡 —— 主视图的最小单元。这里锁死几条验收红线:
 *   - battles_loaded=false 画「战绩加载中」,绝不能画成 0 胜 0 败(契约原话:那是在骗人)
 *   - waiting 用空闲灯 + 「待接力」角标
 *   - deep_link 为 null 时跳转按钮消失,而不是一个死链接
 *   - current_battles 是数组,多线作战全都要显示
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UnitCard } from './UnitCard.tsx';
import { createWorld } from '../mock/world.ts';
import type { RosterEntry } from '@contract';

const T0 = 1_757_000_000_000;
const world = createWorld(() => T0);
const roster = world.roster();
const serverTime = new Date(T0).toISOString();

const byName = (n: string): RosterEntry => {
  const e = roster.entries.find((x) => x.display_name === n);
  if (!e) throw new Error(`没有 ${n}`);
  return e;
};

describe('UnitCard', () => {
  it('战绩加载中:画骨架,绝不出现「0 胜」', () => {
    const { container } = render(<UnitCard entry={byName('许界')} serverTime={serverTime} />);
    expect(screen.getByText(/战绩加载中/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/0\s*胜/);
    expect(container.querySelector('.pc-skel')).not.toBeNull();
  });

  it('待接力:waiting 灯 + 角标,卡片不打成卡住也不打成空闲', () => {
    const { container } = render(<UnitCard entry={byName('沈执')} serverTime={serverTime} />);
    expect(container.querySelector('.pc-flag--waiting')).not.toBeNull();
    expect(container.querySelector('.pc-lamp--waiting')).not.toBeNull();
    expect(container.querySelector('.pc-lamp--stuck')).toBeNull();
    expect(container.querySelector('.pc-unit--idle')).toBeNull();
  });

  it('战斗中:显示在打的怪、已耗时、重试次数,并给回放入口', () => {
    render(<UnitCard entry={byName('策衡')} serverTime={serverTime} />);
    expect(screen.getByText(/MTM-277/)).toBeInTheDocument();
    expect(screen.getByText(/47 分/)).toBeInTheDocument();
    const replay = screen.getByRole('link', { name: /回放/ });
    expect(replay).toHaveAttribute('href', expect.stringContaining('#/battles/'));
  });

  it('多线作战:两场都要列出来', () => {
    const { container } = render(<UnitCard entry={byName('Mika')} serverTime={serverTime} />);
    expect(container.querySelectorAll('[data-battle]').length).toBe(2);
  });

  it('失败:亮失败灯,给出失败原因与重试用尽信息', () => {
    const { container } = render(<UnitCard entry={byName('唐端')} serverTime={serverTime} />);
    expect(container.querySelector('.pc-unit--failed')).not.toBeNull();
    expect(screen.getByText(/重试用尽|3 次/)).toBeInTheDocument();
  });

  it('deep_link:有值给 ↗ 链接,null(内置助手)不画按钮', () => {
    const { container: c1 } = render(<UnitCard entry={byName('策衡')} serverTime={serverTime} />);
    expect(c1.querySelector('a[data-deeplink]')).not.toBeNull();
    const { container: c2 } = render(<UnitCard entry={byName('Multica Helper')} serverTime={serverTime} />);
    expect(c2.querySelector('a[data-deeplink]')).toBeNull();
  });

  it('状态原因挂在 tooltip 上(验收对着它核规则)', () => {
    const { container } = render(<UnitCard entry={byName('顾检')} serverTime={serverTime} />);
    expect(container.querySelector(`[title*="重试"]`)).not.toBeNull();
  });
});
