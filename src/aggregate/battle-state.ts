/**
 * 角色状态灯的判定规则 —— 整个指挥舱最容易吵架的一段逻辑,所以单独拎出来做成纯函数。
 *
 * 为什么单独一个文件:
 *   状态灯是 heory 每天第一眼看的东西,判错一次就等于骗人。
 *   做成无副作用的纯函数,顾检可以对着单测逐条核规则,不用起服务、不用连平台。
 *
 * 改规则的规矩:改 decideBattleState 必须同时改 test/battle-state.test.ts,否则验收 FAIL。
 */

import type { RawIssue, RawTask } from '../multica/raw.ts';
import type { BattleState, RuntimeStatus } from '../contract/types.ts';

export interface StateInput {
  agentId: string;
  /** 该 agent 所在 runtime 的在线状态。查不到 runtime 时传 'unknown'。 */
  runtimeStatus: RuntimeStatus;
  /**
   * 这个角色的战斗历史这一轮拉到了没有。
   * 分档轮询下开机头几秒会有一批角色还没拉到 —— 那时候**不许猜状态**,老实报 unknown。
   */
  battlesLoaded: boolean;
  /** 该 agent 的 task,按 created_at 倒序(multica 原样返回就是倒序,实测已验证)。 */
  tasks: readonly RawTask[];
  /** 当前分派给该 agent 且 status_category 属于 in_progress / blocked 的 issue。 */
  openIssues: readonly RawIssue[];
  /**
   * issue id → 该 issue 底下「活着的」子任务条数(status_category ∈ todo/in_progress/in_review)。
   * 没有活子任务的 issue 不放 key。
   *
   * 用来把**派单的人**和**躺活的人**分开:指挥官手里长期握着父 issue,
   * 子任务派出去以后他本人当然没有在跑的战斗 —— 那既不是卡住,也不是空闲。
   * 没有这个输入,持有父 issue 的人会被 5b 长期常亮误报成「卡住」,
   * 场景 1「谁卡住一眼看清」就废了。口径见 docs/data-contract.md「状态灯」一节。
   *
   * **刻意用子 issue 的状态判,不用「有没有 run 在跑」**:
   * 棒与棒交接的空档里一个 run 都没有,用 run 判会让状态灯闪 stalled(抖动)。
   */
  liveChildCounts: ReadonlyMap<string, number>;
}

export interface StateVerdict {
  state: BattleState;
  /** 中文一句话,说明为什么判成这个状态。界面做 tooltip,验收时对着它核。 */
  reason: string;
}

/**
 * 判定顺序自上而下,**先命中先算**。顺序本身就是规则的一部分,不要随手调换。
 *
 * 1. offline  —— runtime 不在线。此时 task 数据一定是旧的,先说清楚「联系不上」再说别的。
 * 2. unknown  —— 战斗历史还没拉到。开机头几秒会这样。
 *                **这一档存在的意义就是不许猜**:没有 task 数据时看不出「在打」还是「卡住」,
 *                硬判一个只会让 heory 看到状态灯乱跳。界面画成加载态即可。
 * 3. fighting —— 有 running 的 task。正在打就是正在打,压倒一切。
 * 4. defeated —— 最近一条 task failed 且 attempt >= max_attempts。重试用尽 = 真死了,得有人管。
 * 5. stalled  —— 两种情况:
 *      a) 最近一条 task failed 但还能重试 —— 平台会自动再来一次,但此刻没在动;
 *      b) 名下有 in_progress / blocked 的 issue、没有 running task,
 *         **且至少有一条 issue 底下没有活着的子任务** —— 活躺着没人打(队规第 7 条要防的就是这个)。
 *         「混合时卡住优先」:一条派出去了、一条躺着,算卡住,而且只数躺着的那条。
 *         blocked 例外 —— 那是人明确标出来的求助信号,不管子任务动没动都要亮灯。
 * 6. waiting  —— 待接力:名下**每条** in_progress issue 底下都有活着的子任务。
 *                派完活的指挥官落在这里。它不进「卡住」计数,也不等于空闲。
 * 7. idle     —— 其它(手上真没活)。
 *
 * 注意:runtimeStatus 传 'unknown' 时**不判 offline**。
 * 查不到 runtime 比确认离线弱得多,不能因为一次数据缺失就把全员点成灰的。
 */
export function decideBattleState(input: StateInput): StateVerdict {
  const { runtimeStatus, battlesLoaded, tasks, openIssues, liveChildCounts } = input;

  if (runtimeStatus === 'offline') {
    return { state: 'offline', reason: '所在运行时离线,联系不上' };
  }

  if (!battlesLoaded) {
    return { state: 'unknown', reason: '战斗数据还没拉到,稍等' };
  }

  const running = tasks.filter((t) => t.status === 'running');
  if (running.length > 0) {
    const issueCount = running.filter((t) => t.issue_id).length;
    return {
      state: 'fighting',
      reason: running.length === 1
        ? (issueCount > 0 ? '正在打一只怪' : '正在处理一条非 issue 任务(聊天/快建)')
        : `同时在打 ${running.length} 场`,
    };
  }

  // tasks 已是 created_at 倒序,第 0 条就是最近一条。这里不再排序,避免大数组白排一遍。
  const latest = tasks[0];

  if (latest?.status === 'failed') {
    const attempt = latest.attempt ?? 1;
    const max = latest.max_attempts ?? 1;
    if (attempt >= max) {
      return {
        state: 'defeated',
        reason: `最近一战失败,已重试 ${attempt - 1} 次、重试用尽(${latest.failure_reason ?? '原因未知'})`,
      };
    }
    return {
      state: 'stalled',
      reason: `最近一战失败,等第 ${attempt + 1} 次重试(${latest.failure_reason ?? '原因未知'})`,
    };
  }

  if (openIssues.length > 0) {
    const blocked = openIssues.filter((i) => i.status_category === 'blocked');
    if (blocked.length > 0) {
      return { state: 'stalled', reason: `名下有 ${blocked.length} 条被标为 blocked 的任务` };
    }
    // 底下有活子任务的 issue,持有人不该被算成躺着 —— 他是在等接力。
    const ownWork = openIssues.filter((i) => !liveChildCounts.has(i.id));
    if (ownWork.length > 0) {
      // 混合时卡住优先:只按真正躺着的那几条数,派出去的不算。
      return {
        state: 'stalled',
        reason: `名下有 ${ownWork.length} 条进行中的任务,但没有在跑的战斗`,
      };
    }

    const childTotal = openIssues.reduce((n, i) => n + (liveChildCounts.get(i.id) ?? 0), 0);
    const first = openIssues[0];
    return {
      state: 'waiting',
      reason: openIssues.length === 1 && first
        ? `${first.identifier} 的 ${childTotal} 个子任务在推进,等接力回来`
        : `名下 ${openIssues.length} 条已派下去,${childTotal} 个子任务在推进,等接力回来`,
    };
  }

  return { state: 'idle', reason: '手上没活' };
}

/** 主视图顶部的状态计数。顺序即界面展示顺序:先看要紧的。 */
export const STATE_DISPLAY_ORDER: readonly BattleState[] = [
  'defeated', 'stalled', 'fighting', 'waiting', 'idle', 'offline', 'unknown',
];

/**
 * 场景 1 的「卡住」计数只数这两种 —— **不含 waiting**。
 * 这盏灯要零已知误报才立得住:混进「派完活在等接力」的人,数字就不可信了。
 */
export const ALARM_STATES: readonly BattleState[] = ['defeated', 'stalled'];

export function countStates(states: readonly BattleState[]): Record<BattleState, number> {
  const counts = {
    fighting: 0, stalled: 0, defeated: 0, waiting: 0, idle: 0, offline: 0, unknown: 0,
  } satisfies Record<BattleState, number>;
  for (const s of states) counts[s] += 1;
  return counts;
}
