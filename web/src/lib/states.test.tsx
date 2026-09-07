/**
 * 状态语义的唯一映射表:七种契约状态 → 灯 / 中文 / 卡片样式 / 排序。
 * 这里锁死的是产品口径,顾检验收时对着 docs/data-contract.md 核:
 *   - 「卡住」告警只数 defeated / stalled,不含 waiting(待接力)
 *   - waiting 用空闲立绘 + 角标,不发明第五张立绘
 *   - 没见过的状态一律当 unknown 渲染,绝不白屏
 */
import { describe, it, expect } from 'vitest';
import {
  STATE_UI, stateUi, ALARM_STATES, ATTENTION_ORDER, sortEntries,
  levelPips, questNodeUi, parseAvatarUrl, battleStatusUi,
} from './states.ts';
import { BATTLE_STATES, type RosterEntry } from '@contract';

describe('七种契约状态每一种都有完整的界面语义', () => {
  it('BATTLE_STATES 与 STATE_UI 一一对应,契约加状态这里就红', () => {
    expect(Object.keys(STATE_UI).sort()).toEqual([...BATTLE_STATES].sort());
  });
  it('每种状态都有中文名、灯样式、卡片修饰', () => {
    for (const s of BATTLE_STATES) {
      const ui = stateUi(s);
      expect(ui.label.length, s).toBeGreaterThan(0);
      expect(ui.lamp.length, s).toBeGreaterThan(0);
      expect(ui.card.length, s).toBeGreaterThan(0);
    }
  });
  it('waiting:空闲立绘 + 专属灯 + 角标(一期不加第五张立绘,MTM-277 在皮肤里补了灯和角标)', () => {
    const ui = stateUi('waiting');
    expect(ui.label).toBe('待接力');
    expect(ui.badge).toBe(true);
    expect(ui.lamp).toBe('pc-lamp--waiting');
    expect(ui.card).toBe('pc-unit--waiting');
  });
  it('没见过的状态按 unknown 渲染,不抛错', () => {
    const ui = stateUi('battle_royale' as never);
    expect(ui.label).toBe(stateUi('unknown').label);
  });
});

describe('告警口径 —— 场景 1 的「卡住」计数', () => {
  it('只有 defeated 和 stalled 算告警,waiting 明确不算', () => {
    expect([...ALARM_STATES].sort()).toEqual(['defeated', 'stalled']);
  });
});

describe('主视图排序 —— 需要人看的排前面', () => {
  it('注意力顺序:失败 > 卡住 > 战斗 > 待接力 > 未知 > 空闲 > 离线', () => {
    expect(ATTENTION_ORDER).toEqual(['defeated', 'stalled', 'fighting', 'waiting', 'unknown', 'idle', 'offline']);
  });
  it('sortEntries 按注意力排序,同状态保持原序', () => {
    const e = (agent_id: string, state: RosterEntry['state']) => ({ agent_id, state }) as RosterEntry;
    const sorted = sortEntries([e('a', 'idle'), e('b', 'fighting'), e('c', 'defeated'), e('d', 'idle')]);
    expect(sorted.map((x) => x.agent_id)).toEqual(['c', 'b', 'a', 'd']);
  });
});

describe('怪物等级 → 点数', () => {
  it('urgent 4 格且标红,none 0 格', () => {
    expect(levelPips('urgent')).toEqual({ pips: 4, urgent: true, label: '紧急' });
    expect(levelPips('none')).toEqual({ pips: 0, urgent: false, label: '无' });
    expect(levelPips('high').pips).toBe(3);
    expect(levelPips('medium').pips).toBe(2);
    expect(levelPips('low').pips).toBe(1);
  });
  it('unknown 等级也能渲染', () => {
    expect(levelPips('unknown').label).toBe('未知');
  });
});

describe('关卡节点样式 —— done 点亮 / failed 标红 / 进行中挂头像', () => {
  it('done → 点亮', () => {
    expect(questNodeUi('done', null).cls).toBe('pc-node--done');
  });
  it('in_progress / in_review → 进行中', () => {
    expect(questNodeUi('in_progress', 'fighting').cls).toBe('pc-node--active');
    expect(questNodeUi('in_review', null).cls).toBe('pc-node--active');
  });
  it('blocked → 标红;出击角色 defeated 也标红', () => {
    expect(questNodeUi('blocked', null).cls).toBe('pc-node--failed');
    expect(questNodeUi('in_progress', 'defeated').cls).toBe('pc-node--failed');
  });
  it('cancelled → 封锁纹;todo/backlog → 普通未点亮', () => {
    expect(questNodeUi('cancelled', null).cls).toBe('pc-node--locked');
    expect(questNodeUi('todo', null).cls).toBe('');
    expect(questNodeUi('backlog', null).cls).toBe('');
  });
});

describe('avatar_url 三种形态都要认(契约实测形态)', () => {
  it('emoji: 前缀', () => {
    expect(parseAvatarUrl('emoji:🦋')).toEqual({ kind: 'emoji', value: '🦋' });
  });
  it('data: 与 https: 都当图片', () => {
    expect(parseAvatarUrl('data:image/svg+xml,abc').kind).toBe('image');
    expect(parseAvatarUrl('https://x/y.png').kind).toBe('image');
  });
  it('null → none', () => {
    expect(parseAvatarUrl(null).kind).toBe('none');
  });
});

describe('战斗结局 → 中文与色调', () => {
  it('五种结局都有中文', () => {
    for (const s of ['running', 'won', 'lost', 'aborted', 'unknown'] as const) {
      expect(battleStatusUi(s).label.length).toBeGreaterThan(0);
    }
  });
  it('lost 标失败色,won 标完成色', () => {
    expect(battleStatusUi('lost').tone).toBe('failed');
    expect(battleStatusUi('won').tone).toBe('done');
  });
});
