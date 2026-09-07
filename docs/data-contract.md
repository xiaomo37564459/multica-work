# 数据契约

> **权威定义在 `src/contract/types.ts`**(可编译、有类型检查)。这份文档讲人话,讲为什么。
> 两边不一致时以代码为准,并且回来提醒我改这里。

## 全局约定(所有接口一律遵守)

1. **字段永远存在。** 缺失 / 不适用一律 `null` —— 不用空字符串、不用 0、不用省略字段。
   *防的是*:前端写出 `if (x.foo)`,把合法的 `0` 和 `""` 当成「没有」。
2. **列表缺失一律 `[]`,不用 `null`。**
   *防的是*:每处 `.map()` 前都得判一次空。
3. **时间一律 RFC3339 UTC 带 `Z`**,例 `2026-09-04T07:56:39Z`。
4. **时长一律毫秒整数**,字段名以 `_ms` 结尾。
5. **ID 一律小写 UUID 字符串**;issue 另有给人看的编号 `identifier`,例 `MTM-275`。
6. **未知枚举值归一成 `'unknown'`,原值放进同名 `*_raw` 字段。**
   *防的是*:平台以后加一个新状态,指挥舱白屏。**代价是前端必须能渲染 `unknown`。**

## 信封

每个 GET 接口都返回这个形状,没有例外:

```jsonc
{
  "ok": true,
  "data": { /* 各接口的具体类型 */ },
  "meta": {
    "fetched_at": "2026-09-04T08:33:13Z",  // 这份数据是什么时候从 multica 拉到的
    "age_ms": 1211,                         // 距 fetched_at 多久(首次未拉到时 null)
    "stale": false,                         // 超过该资源的新鲜度阈值
    "degraded": [],                         // 本轮哪些数据源拉失败了,空数组=全绿
    "server_time": "2026-09-04T08:33:14Z"  // 服务器当前时刻
  }
}
```

失败时:

```jsonc
{ "ok": false, "error": { "code": "upstream_timeout", "message": "…中文人话…", "retryable": true }, "meta": { … } }
```

**三条给前端的硬要求:**

- **`meta.age_ms` / `meta.stale` 是数据新鲜度的唯一来源。** 别自己拿本地时钟算。
- **算「已耗时」用 `meta.server_time`,不要用浏览器时钟。** 两边时钟可能差几秒,一屏里口径必须一致。
- **`meta.degraded` 非空时顶部挂黄条。** 这时数据还是好的(只是旧了),
  **不要清空界面** —— 服务端已经保证拉取失败绝不丢缓存。

`error.code` 取值:`not_implemented` / `upstream_failed` / `upstream_timeout` / `not_found` /
`bad_request` / `forbidden` / `rate_limited` / `internal`。

## 主视图:`GET /api/roster` → `Roster`

主视图是「消除黑盒焦虑」这个第一目标的落点,所以骨架阶段只有它接了真数据。

```jsonc
{
  "entries": [ /* RosterEntry[] —— 每人一张角色卡 */ ],
  "counts": { "fighting": 2, "stalled": 3, "defeated": 0, "waiting": 1, "idle": 7, "offline": 0, "unknown": 0 }
}
```

### 状态灯 `state`

判定顺序**自上而下,先命中先算**。顺序本身就是规则的一部分。

| 值 | 中文 | 什么时候 |
|---|---|---|
| `offline` | 联系不上 | 该智能体所在 runtime 不在线 |
| `unknown` | 还不知道 | 战斗数据这一轮还没拉到(开机头几秒会这样) |
| `fighting` | 战斗中 | 有 `running` 的任务 |
| `defeated` | 失败 | 最近一条任务 failed **且重试用尽**(`attempt >= max_attempts`) |
| `stalled` | 卡住 | (a) 最近一条 failed 但还能重试;或 (b) 名下有 in_progress/blocked 的 issue、没有在跑的任务,**且至少有一条底下没有活着的子任务** |
| `waiting` | 待接力 | 名下**每条** in_progress issue 底下都有活着的子任务 —— 活派下去了,本人在等接力回来 |
| `idle` | 空闲 | 其它(手上真没活) |

三条容易搞错的:

- **派单的人既不算卡住,也不算空闲 —— 单独一种 `waiting`(待接力)。**
  指挥官把子任务派出去以后,他本人当然没有在跑的战斗。画成卡住,「卡住」这盏灯就有了已知误报,
  场景 1 立不住;画成空闲,等于说他可以接新活,那是另一种说谎。
  (实测触发过:沈执持有父 issue MTM-274,子任务都派出去了,被误报成卡住。)

  判定细则(产品口径由策衡定,2026-09-04):

  1. **什么算「活着的子任务」**:`status_category ∈ todo / in_progress / in_review`。
     刻意**用子 issue 的状态判,不用「有没有 run 在跑」** —— 棒与棒交接的空档里一个 run 都没有,
     用 run 判会让状态灯一闪一闪。
  2. **混合时卡住优先**:只要有一条 issue 底下没有活着的子任务,照旧 `stalled`,
     而且**只数躺着的那几条**。三种情况都该亮灯:没有子 issue(普通执行者)、
     子 issue 全 blocked(整条链卡死,指挥官该出手)、子 issue 全收完还不结单(该收口不收口)。
  3. **`blocked` 压过 `waiting`**:issue 本身被标 blocked 是人明确发出的求助信号,照亮不误。
  4. **「卡住」计数不含 `waiting`**(`ALARM_STATES` 只有 `defeated` / `stalled`)。
     界面一期不加第五张立绘:待接力 = 空闲立绘 + 一个角标。

  **数据从哪来**:按 `parent_issue_id` 在内存里过滤,**不加任何平台调用**。
  数据源是**热档 `issue_active` ∪ 冷档 `issue_all`** —— 冷档(300s)才有 todo / in_review 的子任务,
  热档(3s)保证 in_progress / blocked 的状态是新的;同一条 issue 按 id 去重、以热档为准。
  只喂热档的话,子任务处在 in_review 的指挥官会被误判成卡住。

- **`runtime_status` 是 `unknown` 时不判 `offline`。** 查不到 runtime 比确认离线弱得多,
  不能因为一次数据缺失就把全员点灰。
- **`unknown` 这一档存在的意义就是「不许猜」。** 没有任务数据时看不出在打还是卡住,
  硬判一个只会让状态灯乱跳。

每张卡都带一个 `state_reason`(中文一句话,例「最近一战失败,等第 2 次重试(agent_error.unknown)」)。
**界面做 tooltip,验收时对着它核规则。**

> `waiting` 是 2026-09-04 由策衡拍板加进枚举的第七种状态,规则与实现都已落在本 PR 里,
> 单测见 `test/battle-state.test.ts`「派单的人 vs 躺活的人」一节和 `test/roster.test.ts` 末尾三条。

### 一张角色卡长这样

```jsonc
{
  "agent_id": "f01791eb-…",
  "name": "苏绘｜UI/UX",
  "display_name": "苏绘",          // 全角竖线前半段
  "role_title": "UI/UX",           // 后半段,切不出来时 null
  "avatar_url": "emoji:🦋",        // 三种形态都可能:emoji: / data: / https:
  "class_desc": "负责复杂体验设计…", // 职业定位
  "model": "claude-opus-5",
  "runtime_id": "208b4218-…",
  "runtime_status": "online",      // online | offline | unknown
  "state": "fighting",
  "state_reason": "正在打一只怪",
  "battles_loaded": true,          // ← 见下,很重要
  "current_battles": [ /* Battle[] —— 数组,不是单值 */ ],
  "last_battle": { /* Battle | null,最近一场已结束的 */ },
  "stats": { /* AgentStats | null */ },
  "deep_link": null                // 没配跳转模板时为 null
}
```

**`battles_loaded` 为什么必须有**:`agent tasks` 属于温档/巡档,不是每轮全拉
(原因见 `polling.md` —— 沈执一个人的历史就是 1.28 MB / 1.9 秒)。
开机头几秒会有一批角色还没轮到,此时 `stats` 是 `null`、`current_battles` 是空、`state` 是 `unknown`。

> **`battles_loaded === false` 时界面画骨架屏或「加载中」,绝不能渲染成「0 胜 0 败」「空闲」。**
> 那是在骗人 —— 沈执有 344 场战绩,显示成 0 胜 0 败比不显示更糟。

**`current_battles` 是数组**:`max_concurrent_tasks` 实测取值 3 / 6,
一个角色可以同时打多场。界面别写死「一个角色一场仗」。

### 战绩 `stats`

```jsonc
{
  "total": 344, "won": 313, "lost": 31, "aborted": 0, "running": 0,
  "win_rate": 0.9099,        // won/(won+lost);分母为 0 时 null,不是 0
  "retried": 12,             // attempt > 1 的场次数
  "last_active_at": "2026-09-04T07:49:00Z",
  "mana": null               // 人均蓝条 —— 一期恒 null,见下
}
```

- **中止(`cancelled`)不计入胜率。** 取消大多是人改主意,不是角色打输了,算进去会冤枉人。
- **`mana` 恒为 `null`。** 平台的 token 用量只到 runtime 粒度,13 个智能体全在同一个 runtime 上,
  **摊不到人头**。全局蓝条走 `RuntimeVitals`。

## 一场战斗:`Battle`

```jsonc
{
  "task_id": "01a06b72-…",
  "agent_id": "f01791eb-…",
  "status": "running",        // running | won | lost | aborted | unknown
  "status_raw": "running",    // multica 原值:running/completed/failed/cancelled
  "kind": "issue",            // issue | chat | quick_create | comment | autopilot | unknown
  "kind_raw": "direct",
  "issue": {                  // chat/quick_create/autopilot 时为 null
    "issue_id": "01a06b6b-…", "identifier": "MTM-276",
    "title": "指挥舱像素视觉…", "status": "in_progress",
    "level": "high",          // 怪物等级 = 优先级
    "project_id": "4a694547-…", "deep_link": null
  },
  "attempt": 1, "max_attempts": 2,
  "retries": 0,               // = attempt - 1,角色卡直接用这个
  "created_at": "2026-09-04T08:04:35Z",
  "started_at": "2026-09-04T08:04:36Z",   // 从未开打过时 null
  "completed_at": null,
  "elapsed_ms": 1720327,      // started_at 为 null 时是 null,不是 0
  "failure_reason": null,     // 仅 lost 时非空
  "failure_kind": null,       // agent | runtime | unknown
  "error_text": null,         // 仅 lost 时非空
  "output_excerpt": null,     // 仅 won 时非空,取 result.output 前 800 字
  "output_truncated": false,
  "pr_url": null,             // 实测本 workspace 全为空,别依赖它有值
  "delivered_comment_ids": [],// 这一棒交付了哪几条评论
  "lineage": { /* 见下 */ }
}
```

**`failure_kind` 为什么要分家**:`agent_*` 是智能体/模型侧的问题(值得 heory 看一眼),
`runtime` 是调度侧的(通常重试就好)。界面上要区别对待,别一律标成红色惊叹号。

**重试的表示法**:平台的重试是**新建一条 `attempt+1` 的 task**,不是原地改。
所以同一个 issue 下会有多条 Battle。

## 接力血缘:`Lineage`

```jsonc
{
  "source": "delegation",       // direct_human | delegation | owner_fallback | trigger_owner | unknown
  "precise": true,              // 平台自己标的置信度;false 表示是兜底推断的
  "from_task_id": "01a06b64-…", // 上一棒;链首为 null
  "from_resolved": true,        // ← 见下
  "evidence_kind": "issue_assignment",  // issue_assignment | comment | chat | autopilot_run | unknown
  "evidence_ref_id": "01a06b6b-…",
  "initiator": { "id": "…", "name": "heory", "kind": "member", "avatar_url": "…" },
  "originator": { "…" }
}
```

> ⚠️ **接力链一定会断。** 实测 855 条有上一棒的记录里,**99 条的上一棒查不到**
> (都是 2026-08-25 之前的老数据)。
> `from_resolved: false` 就是这种情况。**战斗回放必须能画「往上还有,但查不到了」,
> 不能假装那就是链条起点。** `BattleChain.broken` 就是给界面用的那个开关。

`precise: false` 时血缘是平台推断的,**界面别把接力链画成实线** —— 画虚线或者标个问号。

`Actor` 里刻意**不带 email**。平台原始返回有,归一层主动丢掉了 —— 指挥舱用不到,传出去只是多一个泄露面。

## 战役地图:`GET /api/projects/:id/map` → `CampaignMap`

```jsonc
{
  "project": { "project_id": "…", "title": "multica-work", "issue_count": 7, "done_count": 0, … },
  "stages": [ { "stage": 1, "total": 2, "done": 0, "quests": [ /* QuestNode[] */ ] }, … ],
  "unstaged": [ /* QuestNode[] */ ],
  "totals": { "total": 7, "done": 0, "failed": 0, "in_progress": 2 }
}
```

> **`unstaged` 不是边角料。** 实测 254 条 issue 里 **142 条 `stage` 为 null** ——
> 界面得给不分关的那一堆留个像样的位置,不能只画分关的那部分。

`QuestNode.level`(怪物等级)= issue 优先级:`urgent` / `high` / `medium` / `low` / `none`。
`QuestNode.assignee_battle_state` 让关卡节点上能直接挂出击角色的状态灯。

## 战斗回放:`GET /api/battles/:taskId/chain` → `BattleChain`

```jsonc
{
  "focus_task_id": "…",
  "nodes": [ { "battle": {…}, "agent": {…}, "depth": 0, "handoff_comment_ids": ["…"] }, … ],
  "broken": false,      // 链条断过没有
  "truncated": false    // 往上追满了 CHAIN_MAX_DEPTH(30)棒
}
```

`nodes` 时间正序,`depth` 0 在前。`handoff_comment_ids` 就是每一棒的交付评论 ——
「每棒交付了什么」靠它拿(实测 614/1191 条 task 有值)。

## 角色详情:`GET /api/agents/:id` → `AgentDetail`

在 `RosterEntry` 基础上多四样:

- `skills[]` —— 技能栏。来源是 `agent list` 内联的 `skills`(不用另外调 `agent skills list`)。
- `equipment[]` —— 装备栏(MCP)。**实测 13 个智能体全部为空**,接口是通的、这个 workspace 就是没人挂。
  **界面要能画「装备栏空着」这一态。**
- `recent_battles[]` —— 最近 20 场,时间倒序。
- `squad_ids[]` —— 所属公会。

## 全局蓝条:`GET /api/runtimes` → `RuntimeVitals[]`

```jsonc
{
  "runtime_id": "208b4218-…", "name": "Claude (DESKTOP-…)", "status": "online",
  "mana": {
    "window_days": 7,
    "input_tokens": 36, "output_tokens": 24156,
    "cache_read_tokens": 1186559, "cache_write_tokens": 95749,
    "total_tokens": 1306500,
    "by_model": [ { "model": "claude-fable-5", "total_tokens": … }, … ],
    "cost_usd": null      // 平台的 cost_usd_ticks 实测恒为 0,当不了真
  },
  "activity_24h": [ { "hour": 0, "count": 53 }, … ]   // 固定 24 条
}
```

**口径说清楚:这是整个 runtime 的,不是某个人的。** 界面上别写成「全队消耗」,
写「运行时消耗」——13 个智能体共用同一个 runtime,分不出谁烧了多少。
`activity_24h` 只有小时桶,**没有日期维度**,别画成时间轴。

## 写操作

### `POST /api/commands/dispatch` —— 派活

```jsonc
// 请求
{ "title": "…", "description": "…", "assignee_agent_id": "uuid",
  "project_id": null, "priority": "high", "parent_issue_id": null, "stage": null }
// 响应 data
{ "issue_id": "…", "identifier": "MTM-280", "deep_link": null }
```

### `POST /api/commands/shout` —— 阵中喊话

```jsonc
// 请求
{ "issue_id": "uuid", "content": "…", "parent_comment_id": null }
// 响应 data
{ "comment_id": "…", "issue_id": "…" }
```

**写操作只有这两个,别的一律拒绝。** 限制、校验规则、为什么这么定,全在 `docs/security.md`。
入参不合法返回 `400 bad_request`,超频返回 `429 rate_limited`。

## 自检:`GET /api/health` → `Health`

给运维和排查用:绑定地址、CLI 是否可用、每个数据源的新鲜度和连续失败次数、deep_link 模板配没配。
出问题先看这个。

## 改契约的规矩

`src/contract/types.ts` 是三棒共同的合同。要改:

- **加字段**:直接加,但必须遵守上面的全局约定,并在这里补一段说明。
- **改字段含义 / 删字段 / 改枚举值**:先在 MTM-275 上说一声,让前端和后端都知道。
- **改状态灯规则**:必须同步改 `test/battle-state.test.ts`,否则验收 FAIL。
