/**
 * mock 世界的行为测试。mock 不是把页面撑起来的假数据,
 * 是「按周构契约运转的一个小系统」:
 *   - 字段名与结构由 TypeScript 压死在 @contract 上(typecheck 就是逐字段核对)
 *   - 这里测行为:计数一致、加载相位、耗时会走、链条会断
 */
import { describe, it, expect } from 'vitest';
import { createWorld, LOAD_DELAY_MS } from './world.ts';
import { createMockApi } from './api.ts';
import { BATTLE_STATES } from '@contract';

/** 可拨动的假时钟 —— 测加载相位用 */
function fakeClock(start = 1_757_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
  };
}

describe('roster —— 主视图数据', () => {
  it('counts 与 entries 严格一致,且全队 13 人', () => {
    const w = createWorld(fakeClock().now);
    const r = w.roster();
    expect(r.entries).toHaveLength(13);
    const tally: Record<string, number> = Object.fromEntries(BATTLE_STATES.map((s) => [s, 0]));
    for (const e of r.entries) tally[e.state] = (tally[e.state] ?? 0) + 1;
    expect(r.counts).toEqual(tally);
  });

  it('开机相位:七种状态一个不缺(验收要能一屏看全)', () => {
    const w = createWorld(fakeClock().now);
    const states = new Set(w.roster().entries.map((e) => e.state));
    for (const s of BATTLE_STATES) expect(states.has(s), `缺状态 ${s}`).toBe(true);
  });

  it('battles_loaded=false 的人:stats 为 null、没有战斗、状态是 unknown —— 界面必须画骨架屏', () => {
    const w = createWorld(fakeClock().now);
    const loading = w.roster().entries.filter((e) => !e.battles_loaded);
    expect(loading.length).toBeGreaterThan(0);
    for (const e of loading) {
      expect(e.stats).toBeNull();
      expect(e.current_battles).toEqual([]);
      expect(e.state).toBe('unknown');
    }
  });

  it('过了加载窗口战绩补齐:unknown 清零,stats 不再是 null', () => {
    const clock = fakeClock();
    const w = createWorld(clock.now);
    clock.advance(LOAD_DELAY_MS + 1000);
    const r = w.roster();
    expect(r.counts.unknown).toBe(0);
    for (const e of r.entries) expect(e.battles_loaded).toBe(true);
  });

  it('战斗中的耗时随时间增长(elapsed 用注入时钟算,不用真实时钟)', () => {
    const clock = fakeClock();
    const w = createWorld(clock.now);
    const pick = () => w.roster().entries.find((e) => e.state === 'fighting')!.current_battles[0]!;
    const before = pick().elapsed_ms!;
    clock.advance(60_000);
    expect(pick().elapsed_ms!).toBe(before + 60_000);
  });

  it('存在多线作战的人(current_battles 是数组,不许写死一人一场)', () => {
    const w = createWorld(fakeClock().now);
    const multi = w.roster().entries.filter((e) => e.current_battles.length > 1);
    expect(multi.length).toBeGreaterThan(0);
  });

  it('waiting 的人有 in_progress 的 issue 在名下、但没有在跑的战斗', () => {
    const w = createWorld(fakeClock().now);
    const waiting = w.roster().entries.find((e) => e.state === 'waiting')!;
    expect(waiting.current_battles).toHaveLength(0);
    expect(waiting.state_reason).toContain('接力');
  });
});

describe('agent —— 角色详情', () => {
  it('查得到全队每个人,并带技能/装备/最近战斗', () => {
    const w = createWorld(fakeClock().now);
    for (const e of w.roster().entries) {
      const d = w.agent(e.agent_id);
      expect(d, e.name).not.toBeNull();
      expect(Array.isArray(d!.skills)).toBe(true);
      expect(Array.isArray(d!.equipment)).toBe(true);
    }
  });
  it('recent_battles 时间倒序', () => {
    const w = createWorld(fakeClock().now);
    const d = w.agent(w.roster().entries.find((e) => e.state === 'stalled')!.agent_id)!;
    const times = d.recent_battles.map((b) => b.created_at);
    expect([...times].sort().reverse()).toEqual(times);
  });
  it('装备栏全空 —— 复刻真实 workspace(13 人零 MCP),界面必须有空态', () => {
    const w = createWorld(fakeClock().now);
    for (const e of w.roster().entries) expect(w.agent(e.agent_id)!.equipment).toEqual([]);
  });
  it('查不到的 id 返回 null', () => {
    const w = createWorld(fakeClock().now);
    expect(w.agent('no-such-id')).toBeNull();
  });
});

describe('campaign —— 战役地图', () => {
  it('项目列表非空,每个项目都能出地图', () => {
    const w = createWorld(fakeClock().now);
    const ps = w.projects();
    expect(ps.length).toBeGreaterThanOrEqual(3);
    for (const p of ps) expect(w.campaign(p.project_id)).not.toBeNull();
  });
  it('stages 按 stage 升序,每关 total/done 与 quests 一致', () => {
    const w = createWorld(fakeClock().now);
    const m = w.campaign(w.projects()[0]!.project_id)!;
    const nums = m.stages.map((s) => s.stage);
    expect([...nums].sort((a, b) => a - b)).toEqual(nums);
    for (const s of m.stages) {
      expect(s.total).toBe(s.quests.length);
      expect(s.done).toBe(s.quests.filter((q) => q.status_category === 'done').length);
    }
  });
  it('unstaged 不是边角料 —— 主项目里必须有不分关的任务', () => {
    const w = createWorld(fakeClock().now);
    expect(w.campaign(w.projects()[0]!.project_id)!.unstaged.length).toBeGreaterThan(0);
  });
  it('totals 与全部节点一致', () => {
    const w = createWorld(fakeClock().now);
    const m = w.campaign(w.projects()[0]!.project_id)!;
    const all = [...m.stages.flatMap((s) => s.quests), ...m.unstaged];
    expect(m.totals.total).toBe(all.length);
    expect(m.totals.done).toBe(all.filter((q) => q.status_category === 'done').length);
    expect(m.totals.in_progress).toBe(all.filter((q) => q.status_category === 'in_progress').length);
  });
  it('地图上能看到:done 节点、进行中挂出击角色、失败节点(blocked 或出击者 defeated)', () => {
    const w = createWorld(fakeClock().now);
    const all = w.projects().flatMap((p) => {
      const m = w.campaign(p.project_id)!;
      return [...m.stages.flatMap((s) => s.quests), ...m.unstaged];
    });
    expect(all.some((q) => q.status_category === 'done')).toBe(true);
    expect(all.some((q) => q.status_category === 'in_progress' && q.assignee !== null)).toBe(true);
    expect(all.some((q) => q.status_category === 'blocked' || q.assignee_battle_state === 'defeated')).toBe(true);
  });
});

describe('chain —— 战斗回放', () => {
  it('主链:depth 0 起时间正序,棒棒相连', () => {
    const w = createWorld(fakeClock().now);
    const focus = w.roster().entries.find((e) => e.name.startsWith('策衡'))!.current_battles[0]!;
    const c = w.chain(focus.task_id)!;
    expect(c.focus_task_id).toBe(focus.task_id);
    expect(c.nodes.length).toBeGreaterThanOrEqual(4);
    expect(c.nodes.map((n) => n.depth)).toEqual(c.nodes.map((_, i) => i));
    for (let i = 1; i < c.nodes.length; i++) {
      expect(c.nodes[i]!.battle.lineage.from_task_id).toBe(c.nodes[i - 1]!.battle.task_id);
    }
    expect(c.broken).toBe(false);
  });
  it('断链:from_task_id 有值但查不到上一棒 → broken=true(界面要画「往上还有,但查不到了」)', () => {
    const w = createWorld(fakeClock().now);
    const stalled = w.roster().entries.find((e) => e.state === 'stalled')!;
    const c = w.chain(w.agent(stalled.agent_id)!.recent_battles[0]!.task_id)!;
    expect(c.broken).toBe(true);
    const first = c.nodes[0]!;
    expect(first.battle.lineage.from_task_id).not.toBeNull();
    expect(first.battle.lineage.from_resolved).toBe(false);
  });
  it('查不到的 task 返回 null', () => {
    const w = createWorld(fakeClock().now);
    expect(w.chain('no-such-task')).toBeNull();
  });
});

describe('mock api —— 信封与错误形状和真后端一致', () => {
  it('成功信封:ok/data/meta 齐全,server_time 来自注入时钟', async () => {
    const clock = fakeClock();
    const api = createMockApi({ latencyMs: 0, now: clock.now });
    const env = await api.roster();
    expect(env.ok).toBe(true);
    if (env.ok) {
      expect(env.data.entries.length).toBe(13);
      expect(env.meta.server_time).toBe(new Date(clock.now()).toISOString());
      expect(env.meta.degraded).toEqual([]);
    }
  });
  it('not_found 信封与契约错误码一致', async () => {
    const api = createMockApi({ latencyMs: 0 });
    const env = await api.agent('no-such-id');
    expect(env.ok).toBe(false);
    if (!env.ok) {
      expect(env.error.code).toBe('not_found');
      expect(env.error.message.length).toBeGreaterThan(0);
    }
  });
  it('演示开关:degraded 亮黄条、stale 标过期 —— 给验收走查用', async () => {
    const api = createMockApi({ latencyMs: 0 });
    api.demo.degraded = true;
    api.demo.stale = true;
    const env = await api.roster();
    expect(env.meta.degraded.length).toBeGreaterThan(0);
    expect(env.meta.stale).toBe(true);
  });
});
