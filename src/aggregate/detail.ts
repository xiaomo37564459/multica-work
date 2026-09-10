/**
 * 角色 / 战役 / 回放 / 运行时的聚合 —— 把骨架棒留下的「501 待实现」全部填成真数据。
 *
 * 这个文件是 aggregate/ 的一员:全是纯函数,不碰 IO、不碰时钟(now 由调用方注入)。
 * 和 roster.ts 一样,测试可以直接喂固定样本,顾检不用起服务、不用连平台。
 *
 * 数据从哪来(全部已在轮询缓存里,不新增任何 CLI 读命令):
 *   - AgentDetail   = RosterEntry(复用 buildRoster 的行)+ agent list 内联的 skills
 *                     + agent mcp list(按需缓存,实测全员为空)+ 该 agent 的 tasks(温/巡档)
 *   - CampaignMap   = 冷档全量 issue 按 project 过滤、本地按 stage 分层。
 *                     队规父子同层:真实 workspace 里父 issue 一律不分关(stage=null),
 *                     所以「issue children」的分层树 ≡ 本地按 stage 分组,省掉按需 CLI 调用。
 *   - BattleChain   = 从焦点 task 沿 lineage.from_task_id 往上追,在全员 task 缓存里查。
 *                     查不到上一棒 = broken(契约里的断链,实测 855 条有 99 条);追满 30 棒 = truncated。
 *   - RuntimeVitals = runtime list ∪ usage ∪ activity,三个缓存拼装。
 */

import type {
  RawAgent, RawAgentMcp, RawIssue, RawProject, RawRuntime, RawRuntimeActivity,
  RawRuntimeUsage, RawSquad, RawTask,
} from '../multica/raw.ts';
import type {
  AgentDetail, Battle, BattleChain, BattleChainNode, CampaignMap, CampaignStage,
  ProjectRef, QuestNode, RuntimeVitals,
} from '../contract/types.ts';
import { CHAIN_MAX_DEPTH } from '../contract/types.ts';
import { buildRoster } from './roster.ts';
import {
  nullish, toBattle, toProjectRef, toQuestNode, toRuntimeVitals,
  type BattleContext, type DeepLinkConfig,
} from './normalize.ts';

/**
 * 「失败/卡死」的判定口径(由沈执拍板,2026-09-09,注释同步进契约防下一棒再猜):
 *    status_category=blocked 的关卡,或出击角色当前状态灯是 defeated 的 in_progress/in_review 关卡。
 *  与前端 mock 同口径 —— 验收时两边数字必须对得上。
 */
export function isFailedQuest(q: QuestNode): boolean {
  return q.status_category === 'blocked'
    || (q.assignee_battle_state === 'defeated'
      && (q.status_category === 'in_progress' || q.status_category === 'in_review'));
}

export interface AggregatesInput {
  agents: readonly RawAgent[];
  runtimes: readonly RawRuntime[];
  /** agent_id → 该 agent 的 task 列表(multica 原样返回,created_at 倒序;没拉到的 agent 不放 key)。 */
  tasksByAgent: ReadonlyMap<string, readonly RawTask[]>;
  activeIssues: readonly RawIssue[];
  allIssues: readonly RawIssue[];
  projects: readonly RawProject[];
  squads: readonly RawSquad[];
  /** agent_id → 该 agent 的 MCP 装备(按需缓存)。 */
  mcpByAgent: ReadonlyMap<string, readonly RawAgentMcp[]>;
  usageByRuntime: ReadonlyMap<string, readonly RawRuntimeUsage[]>;
  activityByRuntime: ReadonlyMap<string, readonly RawRuntimeActivity[]>;
  cfg: DeepLinkConfig;
  /** 统一的「现在」,保证所有已耗时口径一致。 */
  now: string;
  usageWindowDays: number;
}

export interface Aggregates {
  /** 主视图(顺带回灌状态灯给轮询器挑活跃集)。 */
  roster: ReturnType<typeof buildRoster>;
  agentDetails: ReadonlyMap<string, AgentDetail>;
  projectsView: readonly ProjectRef[];
  campaignMaps: ReadonlyMap<string, CampaignMap>;
  /** 全量已知 task 的回放链,key = task_id(每次全量重建,前端按需来取)。 */
  battleChains: ReadonlyMap<string, BattleChain>;
  runtimesView: readonly RuntimeVitals[];
}

/** 全链路共用的战斗归一上下文:issue 全量冷档兜底、全员 task id 集合判断链。 */
export function battleContext(input: AggregatesInput): BattleContext {
  const issuesById = new Map(input.allIssues.map((i) => [i.id, i]));
  const knownTaskIds = new Set<string>();
  for (const tasks of input.tasksByAgent.values()) {
    for (const t of tasks) knownTaskIds.add(t.id);
  }
  return {
    cfg: input.cfg, knownTaskIds,
    agentIds: new Set(input.agents.map((a) => a.id)),
    issuesById, now: input.now,
  };
}

/** agent_id → 所属小队 id(公会)。squad list 只有成员预览,拿不全就算了 —— 契约允许。 */
function squadsByAgent(squads: readonly RawSquad[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const s of squads) {
    const members = new Set<string>(s.member_preview?.map((m) => m.member_id) ?? []);
    if (s.leader_id != null) members.add(s.leader_id);
    for (const id of members) {
      const list = out.get(id) ?? [];
      if (!list.includes(s.id)) out.set(id, [...list, s.id]);
    }
  }
  return out;
}

/** task 列表按 created_at 倒序(multica 原样就是倒序,这里兜一次排序防平台变卦)。 */
function byCreatedDesc(tasks: readonly RawTask[]): RawTask[] {
  return [...tasks].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

export function buildAggregates(input: AggregatesInput): Aggregates {
  const roster = buildRoster({
    agents: input.agents,
    runtimes: input.runtimes,
    tasksByAgent: input.tasksByAgent,
    activeIssues: input.activeIssues,
    allIssues: input.allIssues,
    cfg: input.cfg,
    now: input.now,
  });

  const ctx = battleContext(input);
  const entryByAgent = new Map(roster.entries.map((e) => [e.agent_id, e]));
  const squads = squadsByAgent(input.squads);

  /* ── 角色详情 ── */
  const agentDetails = new Map<string, AgentDetail>();
  for (const e of roster.entries) {
    const agent = input.agents.find((a) => a.id === e.agent_id);
    if (!agent) continue;
    const loaded = entryByAgent.get(e.agent_id)?.battles_loaded ?? false;
    const recent = loaded ? byCreatedDesc(input.tasksByAgent.get(e.agent_id) ?? []).slice(0, 20) : [];
    agentDetails.set(e.agent_id, {
      ...e,
      skills: (agent.skills ?? []).map((s) => ({
        skill_id: nullish(s.id),
        name: s.name,
        description: nullish(s.description),
        enabled: s.enabled !== false,
        source: 'workspace' as const,
      })),
      equipment: (input.mcpByAgent.get(e.agent_id) ?? []).map((m) => ({
        name: m.name, enabled: m.enabled !== false,
      })),
      recent_battles: recent.map((t) => toBattle(t, ctx)),
      squad_ids: squads.get(e.agent_id) ?? [],
    });
  }

  /* ── 战役列表 + 地图 ── */
  const projectsView = input.projects.map((p) => toProjectRef(p, input.cfg));
  const stateByAgent = new Map(roster.entries.map((e) => [e.agent_id, e.state]));
  const agentsById = new Map(input.agents.map((a) => [a.id, a]));
  const questsById = new Map<string, QuestNode>();
  const issuesByProject = new Map<string, RawIssue[]>();
  for (const issue of input.allIssues) {
    questsById.set(issue.id, toQuestNode(issue, input.cfg, agentsById, (agentId) => stateByAgent.get(agentId) ?? null));
    const pid = nullish(issue.project_id);
    if (pid == null) continue;
    const list = issuesByProject.get(pid) ?? [];
    issuesByProject.set(pid, [...list, issue]);
  }

  const campaignMaps = new Map<string, CampaignMap>();
  for (const ref of projectsView) {
    const quests = (issuesByProject.get(ref.project_id) ?? []).map((i) => questsById.get(i.id)!);
    const staged = quests.filter((q) => q.stage != null);
    const stageNums = [...new Set(staged.map((q) => q.stage as number))].sort((a, b) => a - b);
    const stages: CampaignStage[] = stageNums.map((num) => {
      const group = staged.filter((q) => q.stage === num);
      return {
        stage: num,
        total: group.length,
        done: group.filter((q) => q.status_category === 'done').length,
        quests: group,
      };
    });
    campaignMaps.set(ref.project_id, {
      project: ref,
      stages,
      unstaged: quests.filter((q) => q.stage == null),
      totals: {
        total: quests.length,
        done: quests.filter((q) => q.status_category === 'done').length,
        failed: quests.filter(isFailedQuest).length,
        in_progress: quests.filter(
          (q) => q.status_category === 'in_progress' || q.status_category === 'in_review',
        ).length,
      },
    });
  }

  /* ── 战斗回放:全量已知 task 沿 from_task_id 往上追 ── */
  const taskById = new Map<string, RawTask>();
  for (const tasks of input.tasksByAgent.values()) {
    for (const t of tasks) taskById.set(t.id, t);
  }
  const battleChains = new Map<string, BattleChain>();
  for (const task of taskById.values()) {
    const nodes: BattleChainNode[] = [];
    const visited = new Set<string>();
    let broken = false;
    let truncated = false;
    let cur: RawTask | undefined = task;
    while (cur != null && nodes.length < CHAIN_MAX_DEPTH) {
      visited.add(cur.id);
      nodes.push(chainNode(cur, input, ctx));
      const from = nullish(cur.attribution?.delegated_from_task_id ?? null);
      if (from == null) break;
      const parent = taskById.has(from) ? taskById.get(from) : undefined;
      if (!parent) {
        broken = true; // 有 from_task_id 但查不到 —— 契约里必须画「往上还有,但查不到了」
        break;
      }
      if (visited.has(parent.id)) { broken = true; break; } // 数据异常成环,断开防死循环
      cur = parent;
    }
    truncated = nodes.length >= CHAIN_MAX_DEPTH
      && cur != null
      && nullish(cur.attribution?.delegated_from_task_id ?? null) != null
      && !visited.has(cur.id);
    nodes.reverse(); // depth 0 = 链首,时间正序
    const fixed = nodes.map((n, depth) => ({ ...n, depth }));
    battleChains.set(task.id, { focus_task_id: task.id, nodes: fixed, broken, truncated });
  }

  /* ── 运行时体征 ── */
  const runtimesView = input.runtimes.map((rt) => toRuntimeVitals(
    rt,
    input.usageByRuntime.get(rt.id) ?? EMPTY_USAGE,
    input.activityByRuntime.get(rt.id) ?? EMPTY_ACTIVITY,
    input.usageWindowDays,
  ));

  return { roster, agentDetails, projectsView, campaignMaps, battleChains, runtimesView };
}

/** task → 链上节点。agent 名字从 agent list 查,查不到就给 id(不让渲染端空指针)。 */
function chainNode(task: RawTask, input: AggregatesInput, ctx: BattleContext): BattleChainNode {
  const battle: Battle = toBattle(task, ctx);
  const agent = input.agents.find((a) => a.id === task.agent_id);
  return {
    battle,
    agent: {
      agent_id: task.agent_id,
      name: agent?.name ?? task.agent_id,
      avatar_url: nullish(agent?.avatar_url ?? null),
    },
    depth: 0, // buildAggregates 里按链位回填
    handoff_comment_ids: battle.delivered_comment_ids,
  };
}

/** 有上一棒(哪怕查不到)还算不算「被截断」—— 供单测与实现共用。 */
export function hasLineageParent(task: RawTask): boolean {
  return nullish(task.attribution?.delegated_from_task_id ?? null) != null;
}

/** toRuntimeVitals 形参是可变数组类型,给两个只读兜底常量,免得每次新建。 */
const EMPTY_USAGE: RawRuntimeUsage[] = [];
const EMPTY_ACTIVITY: RawRuntimeActivity[] = [];
