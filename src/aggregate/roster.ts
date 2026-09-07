/**
 * 主视图聚合:raw → Roster。
 *
 * 骨架阶段只把 /api/roster 打通到真数据 —— 它是「消除黑盒焦虑」这个第一目标的落点。
 * 其余接口(角色详情 / 战役地图 / 战斗回放)契约已定死,实现留给韩程那一棒。
 *
 * 这个函数是纯的:输入 raw 数据,输出契约对象,不碰 IO、不碰时钟(now 由调用方注入)。
 * 这样测试可以直接喂固定样本,顾检不用连平台也能验。
 */

import type { RawAgent, RawIssue, RawRuntime, RawTask } from '../multica/raw.ts';
import type { AgentStats, Battle, BattleState, Roster, RosterEntry } from '../contract/types.ts';
import { countStates, decideBattleState } from './battle-state.ts';
import {
  agentDeepLink, splitAgentName, toBattle, toRuntimeStatus, nullish,
  type BattleContext, type DeepLinkConfig,
} from './normalize.ts';

/** 一个 issue 算不算「活躺着」的判据。 */
const OPEN_CATEGORIES = new Set(['in_progress', 'blocked']);

export interface RosterInput {
  agents: readonly RawAgent[];
  runtimes: readonly RawRuntime[];
  /** agent_id → 该 agent 的 task 列表(created_at 倒序)。没拉到的 agent 直接不放 key。 */
  tasksByAgent: ReadonlyMap<string, readonly RawTask[]>;
  /** 当前 status_category 属于 in_progress / blocked 的 issue。 */
  activeIssues: readonly RawIssue[];
  cfg: DeepLinkConfig;
  /** 统一的「现在」,保证一屏里所有已耗时口径一致。 */
  now: string;
}

export function buildRoster(input: RosterInput): Roster {
  const { agents, runtimes, tasksByAgent, activeIssues, cfg, now } = input;

  const runtimeById = new Map(runtimes.map((r) => [r.id, r]));
  const agentIds = new Set(agents.map((a) => a.id));
  const issuesById = new Map(activeIssues.map((i) => [i.id, i]));

  const knownTaskIds = new Set<string>();
  for (const tasks of tasksByAgent.values()) {
    for (const t of tasks) knownTaskIds.add(t.id);
  }

  const ctx: BattleContext = { cfg, knownTaskIds, agentIds, issuesById, now };

  const openByAgent = new Map<string, RawIssue[]>();
  for (const issue of activeIssues) {
    if (!issue.assignee_id || issue.assignee_type !== 'agent') continue;
    if (!OPEN_CATEGORIES.has(issue.status_category)) continue;
    const list = openByAgent.get(issue.assignee_id) ?? [];
    list.push(issue);
    openByAgent.set(issue.assignee_id, list);
  }

  const entries: RosterEntry[] = agents
    .filter((a) => a.archived_at == null)
    .map((agent) => {
      // 分档轮询下,不是每个角色每轮都有战斗历史。没拉到 ≠ 没打过,两者必须分得开。
      const loadedTasks = tasksByAgent.get(agent.id);
      const battlesLoaded = loadedTasks != null;
      const tasks = loadedTasks ?? [];
      const runtime = agent.runtime_id ? runtimeById.get(agent.runtime_id) : undefined;
      const runtimeStatus = runtime ? toRuntimeStatus(runtime.status) : 'unknown';
      const openIssues = openByAgent.get(agent.id) ?? [];

      const verdict = decideBattleState({
        agentId: agent.id,
        runtimeStatus,
        battlesLoaded,
        tasks,
        openIssues,
      });

      const battles = tasks.map((t) => toBattle(t, ctx));
      const current = battles.filter((b) => b.status === 'running');
      const lastFinished = battles.find((b) => b.status !== 'running') ?? null;
      const { display, role } = splitAgentName(agent.name);

      return {
        agent_id: agent.id,
        name: agent.name,
        display_name: display,
        role_title: role,
        avatar_url: nullish(agent.avatar_url),
        class_desc: nullish(agent.description),
        model: nullish(agent.model),
        runtime_id: nullish(agent.runtime_id),
        runtime_status: runtimeStatus,
        state: verdict.state,
        state_reason: verdict.reason,
        battles_loaded: battlesLoaded,
        current_battles: current,
        last_battle: lastFinished,
        stats: battlesLoaded ? buildStats(battles) : null,
        deep_link: agentDeepLink(cfg, agent.id),
      } satisfies RosterEntry;
    });

  return {
    entries,
    counts: countStates(entries.map((e) => e.state)),
  };
}

/**
 * 战绩统计。
 * 口径写死:胜 = completed,败 = failed,中止 = cancelled(**中止不计入胜率**,
 * 因为取消大多是人改主意,不是角色打输了 —— 算进去会冤枉人)。
 */
export function buildStats(battles: readonly Battle[]): AgentStats {
  let won = 0, lost = 0, aborted = 0, running = 0, retried = 0;
  let lastActive: string | null = null;

  for (const b of battles) {
    if (b.status === 'won') won += 1;
    else if (b.status === 'lost') lost += 1;
    else if (b.status === 'aborted') aborted += 1;
    else if (b.status === 'running') running += 1;
    if (b.retries > 0) retried += 1;

    const stamp = b.completed_at ?? b.started_at ?? b.created_at;
    if (stamp && (lastActive == null || stamp > lastActive)) lastActive = stamp;
  }

  const decided = won + lost;
  return {
    total: battles.length,
    won,
    lost,
    aborted,
    running,
    win_rate: decided === 0 ? null : won / decided,
    retried,
    last_active_at: lastActive,
    mana: null,
  };
}

/**
 * 决定这一轮要给哪些 agent 拉 `agent tasks`(热档的活跃集)。
 *
 * 为什么要挑:`agent tasks` 没有分页,一次返回全部历史。实测沈执一个人 356 条 = 1.28MB / 1.9 秒,
 * 13 个人全拉一轮就要 3.8~4.4 秒,而且历史只会越积越多。详见 docs/polling.md。
 *
 * 挑法:名下有 in_progress / blocked issue 的 + 上一轮状态是 fighting/stalled/defeated 的。
 * 其余的靠冷档轮巡兜底。
 */
export function pickActiveAgents(
  activeIssues: readonly RawIssue[],
  previousStates: ReadonlyMap<string, BattleState>,
): string[] {
  const picked = new Set<string>();
  for (const issue of activeIssues) {
    if (issue.assignee_type === 'agent' && issue.assignee_id && OPEN_CATEGORIES.has(issue.status_category)) {
      picked.add(issue.assignee_id);
    }
  }
  for (const [agentId, state] of previousStates) {
    if (state === 'fighting' || state === 'stalled' || state === 'defeated') picked.add(agentId);
  }
  return [...picked];
}
