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

  /**
   * MTM-279 五场景走查捅出来的洞:卡住不等于「上一战打输了」。
   *
   * 实测那天主视图上苏绘、顾检两张卡写着「第 1/2 次失败,还会自动重试」——
   * 而这两个人的上一战 status 是 **won**。真正的原因(后端算好的 state_reason)是
   * 「名下有 1 条进行中的任务,但没有在跑的战斗」,卡上一个字都没有。
   *
   * 卡片当时对 stalled/defeated 一律套失败模板,不看上一战到底输没输。
   * 编一个没发生过的失败给人看,比什么都不显示更糟 —— 会让人照着假信息去处置。
   */
  describe('卡住的原因得是真的', () => {
    const stalled = (over: Partial<RosterEntry>): RosterEntry => ({
      ...byName('顾检'),
      state: 'stalled',
      state_reason: '名下有 1 条进行中的任务,但没有在跑的战斗',
      battles_loaded: true,
      current_battles: [],
      ...over,
    });

    it('上一战是赢的:说出真实原因,不许编一句「第 1/2 次失败」', () => {
      const won = byName('林澄').last_battle;
      expect(won?.status).toBe('won'); // 前提没了这条测试就没意义
      const { container } = render(<UnitCard entry={stalled({ last_battle: won })} serverTime={serverTime} />);
      expect(container.textContent).toMatch(/名下有 1 条进行中的任务/);
      expect(container.textContent).not.toMatch(/次失败/);
      expect(container.textContent).not.toMatch(/重试用尽/);
    });

    it('上一战真输了:失败明细照旧画出来(带关卡、重试次数、回放)', () => {
      const lost = byName('唐端').last_battle;
      expect(lost?.status).toBe('lost');
      const { container } = render(<UnitCard entry={stalled({ last_battle: lost })} serverTime={serverTime} />);
      expect(container.querySelector('[data-battle]')).not.toBeNull();
      expect(container.textContent).toMatch(/次失败|重试用尽/);
    });

    it('压根没有上一战:也得说句话,不许留一块空白', () => {
      const { container } = render(<UnitCard entry={stalled({ last_battle: null })} serverTime={serverTime} />);
      expect(container.textContent).toMatch(/名下有 1 条进行中的任务/);
    });
  });
});
