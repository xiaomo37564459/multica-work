/**
 * 分档轮询器 —— 「3 秒刷新」这个目标真正落地的地方。
 *
 * 为什么要分档(实测结论,数字见 docs/polling.md):
 *   全量拉一轮 = 26 次 CLI 调用、5.2MB、并发 12 时中位数 5.0 秒。**做不到 3 秒。**
 *   最贵的是 `agent tasks`:没有分页,一次返回全部历史,沈执一个人 356 条 = 1.28MB / 1.9 秒,
 *   而且只会越积越多。所以不能每轮全拉。
 *
 * 分成四档:
 *   热  3s   —— issue list --status in_progress / blocked。2 次调用,实测 ~465ms、52KB。
 *   温  10s  —— 只给「活跃集」拉 agent tasks(通常 1~4 人)。
 *   巡  60s  —— 给 2 个不活跃的 agent 补历史,~6 分钟覆盖全员。
 *   冷  300s —— 世界设定:agent/project/squad/runtime/usage/activity + 全量 issue 3 页。
 */

import type {
  RawAgent, RawIssue, RawProject, RawRuntime, RawRuntimeActivity, RawRuntimeUsage,
  RawSquad, RawTask,
} from '../multica/raw.ts';
import type { MulticaSource } from '../multica/source.ts';
import type { BattleState, SourceName } from '../contract/types.ts';
import { pickActiveAgents } from '../aggregate/roster.ts';
import { CacheCell, KeyedCache, RoundRobin } from './cache.ts';
import type { CockpitConfig } from './config.ts';

/** 各档的 stale 阈值。超过就在 meta 里标「数据可能过期」,但值照样返回。 */
const MAX_AGE = {
  hot: 15_000,
  warm: 40_000,
  cold: 900_000,
} as const;

export class Poller {
  private timers: NodeJS.Timeout[] = [];
  private readonly sweeper = new RoundRobin();
  private lastStates = new Map<string, BattleState>();
  private stopped = false;

  readonly activeIssues: CacheCell<RawIssue[]>;
  readonly agents: CacheCell<RawAgent[]>;
  readonly projects: CacheCell<RawProject[]>;
  readonly squads: CacheCell<RawSquad[]>;
  readonly runtimes: CacheCell<RawRuntime[]>;
  readonly allIssues: CacheCell<RawIssue[]>;
  readonly tasks: KeyedCache<RawTask[]>;
  readonly usage: KeyedCache<RawRuntimeUsage[]>;
  readonly activity: KeyedCache<RawRuntimeActivity[]>;

  private readonly cfg: CockpitConfig;

  constructor(src: MulticaSource, cfg: CockpitConfig) {
    this.cfg = cfg;
    this.activeIssues = new CacheCell('issue_active', MAX_AGE.hot, async () => {
      // 两条状态并行拉。todo / in_review 不进热档:它们不代表「正在打」,冷档的全量兜得住。
      const [inProgress, blocked] = await Promise.all([
        src.issuesByStatus('in_progress'),
        src.issuesByStatus('blocked'),
      ]);
      return [...inProgress, ...blocked];
    });

    this.agents = new CacheCell('agent_list', MAX_AGE.cold, () => src.agentList());
    this.projects = new CacheCell('project_list', MAX_AGE.cold, () => src.projectList());
    this.squads = new CacheCell('squad_list', MAX_AGE.cold, () => src.squadList());
    this.runtimes = new CacheCell('runtime_list', MAX_AGE.cold, () => src.runtimeList());

    this.allIssues = new CacheCell('issue_all', MAX_AGE.cold, async () => {
      // 分页拉全量。254 条 = 3 页;这里顺着拉,靠 CLI 层的并发闸控住压力。
      const out: RawIssue[] = [];
      let offset = 0;
      for (let page = 0; page < 20; page += 1) {
        const res = await src.issuesPage(offset);
        out.push(...(res.issues ?? []));
        if (!res.has_more) break;
        offset += res.issues?.length ?? 0;
        if ((res.issues?.length ?? 0) === 0) break;
      }
      return out;
    });

    this.tasks = new KeyedCache('agent_tasks', MAX_AGE.warm, (agentId) => src.agentTasks(agentId));
    this.usage = new KeyedCache('runtime_usage', MAX_AGE.cold, (id) => src.runtimeUsage(id, cfg.usageWindowDays));
    this.activity = new KeyedCache('runtime_activity', MAX_AGE.cold, (id) => src.runtimeActivity(id));
  }

  /** 记下上一轮各角色的状态,供活跃集判定用。 */
  recordStates(states: ReadonlyMap<string, BattleState>): void {
    this.lastStates = new Map(states);
  }

  private currentAgentIds(): string[] {
    return (this.agents.snapshot().value ?? []).filter((a) => a.archived_at == null).map((a) => a.id);
  }

  private activeAgentIds(): string[] {
    const issues = this.activeIssues.snapshot().value ?? [];
    return pickActiveAgents(issues, this.lastStates);
  }

  private async hotTick(): Promise<void> {
    await this.activeIssues.refresh();
  }

  private async warmTick(): Promise<void> {
    const ids = this.activeAgentIds();
    await Promise.all(ids.map((id) => this.tasks.refresh(id)));
  }

  private async sweepTick(): Promise<void> {
    const active = new Set(this.activeAgentIds());
    const idle = this.currentAgentIds().filter((id) => !active.has(id));
    const batch = this.sweeper.next(idle, this.cfg.sweepBatchSize);
    await Promise.all(batch.map((id) => this.tasks.refresh(id)));
  }

  private async coldTick(): Promise<void> {
    await Promise.all([
      this.agents.refresh(),
      this.projects.refresh(),
      this.squads.refresh(),
      this.runtimes.refresh(),
      this.allIssues.refresh(),
    ]);
    const runtimes = this.runtimes.snapshot().value ?? [];
    await Promise.all(runtimes.flatMap((r) => [this.usage.refresh(r.id), this.activity.refresh(r.id)]));
  }

  /**
   * 启动时把全员的战斗历史补一遍。
   *
   * 只做这一次。稳态下靠 60 秒轮巡 2 人慢慢刷就够了,但开机那一下不能等 ——
   * 不然 heory 打开页面看到的是一半角色「战绩加载中」,要等四分钟才齐。
   * 实测 13 个人在并发闸(4)下约 4 秒跑完。由 index.ts 在 listen 之后调用,不挡首屏。
   */
  async initialSweep(): Promise<void> {
    const ids = this.currentAgentIds();
    await Promise.all(ids.map((id) => this.tasks.refresh(id)));
  }

  /**
   * 首屏用不到、但详情页 / 战役地图要用的那批冷档数据。
   * 由 index.ts 在 listen 之后调用 —— 它们慢(全量 issue 三页 + 每个 runtime 两次调用),
   * 放在首屏路径上会把 8 秒的启动等待还给用户。
   */
  async primeColdInBackground(): Promise<void> {
    await this.coldTick();
  }

  /**
   * 开跑前只拉「主视图必需的三样」:角色名单、运行时、进行中的 issue。
   *
   * 不在这里拉的东西和理由(实测数字见 docs/polling.md):
   *   - 全量 issue / 用量 / 活跃直方图:详情页和战役地图才用,一起拉会把首次可应答从 1 秒拖到 8.1 秒。
   *   - agent tasks:沈执一个人就要 1.9 秒,加进来是 4.4 秒。
   *     没有它时角色状态会是 unknown(见 battle-state.ts),界面画加载态即可 ——
   *     **宁可诚实地说「还不知道」,也不要猜一个状态灯给 heory 看。**
   * 父任务的验收线是「首屏 ≤3 秒」,所以首屏路径上只能有主视图必需的东西。
   */
  async primeAndStart(): Promise<void> {
    await Promise.all([this.agents.refresh(), this.runtimes.refresh(), this.hotTick()]);

    const every = (ms: number, fn: () => Promise<void>): void => {
      const t = setInterval(() => {
        if (this.stopped) return;
        void fn().catch(() => { /* 每个 cell 自己记失败,这里不需要再处理 */ });
      }, ms);
      // 定时器不该拖着进程不退出。
      t.unref?.();
      this.timers.push(t);
    };

    every(this.cfg.hotIntervalMs, () => this.hotTick());
    every(this.cfg.warmIntervalMs, () => this.warmTick());
    every(this.cfg.sweepIntervalMs, () => this.sweepTick());
    every(this.cfg.coldIntervalMs, () => this.coldTick());
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /** 哪些源现在是坏的 —— 直接进 ApiMeta.degraded。 */
  degradedSources(): SourceName[] {
    const out: SourceName[] = [];
    const cells: Array<[SourceName, CacheCell<unknown>]> = [
      ['issue_active', this.activeIssues as CacheCell<unknown>],
      ['agent_list', this.agents as CacheCell<unknown>],
      ['project_list', this.projects as CacheCell<unknown>],
      ['squad_list', this.squads as CacheCell<unknown>],
      ['runtime_list', this.runtimes as CacheCell<unknown>],
      ['issue_all', this.allIssues as CacheCell<unknown>],
    ];
    for (const [name, cell] of cells) {
      if (cell.snapshot().consecutive_failures > 0) out.push(name);
    }
    if (this.tasks.worstFailures() > 0) out.push('agent_tasks');
    if (this.usage.worstFailures() > 0) out.push('runtime_usage');
    if (this.activity.worstFailures() > 0) out.push('runtime_activity');
    return out;
  }

  /** 主视图数据的新鲜度以热档为准 —— 那才是 heory 盯的那一格。 */
  freshness(): { fetched_at: string | null; age_ms: number | null; stale: boolean } {
    const s = this.activeIssues.snapshot();
    return { fetched_at: s.fetched_at, age_ms: s.age_ms, stale: s.stale };
  }

  tasksByAgent(): Map<string, RawTask[]> {
    const out = new Map<string, RawTask[]>();
    for (const id of this.tasks.keys()) {
      const v = this.tasks.get(id).value;
      if (v) out.set(id, v);
    }
    return out;
  }
}
