# 数据来源映射(实测)

> 契约里的每个字段对应哪条 `multica` 命令的哪个返回字段。
> **表里出现的每一条命令我都真跑过**;拉不到的东西在文末「一期不做」里点名,契约里不留想象中的字段。
>
> 实测时间:2026-09-04 · workspace `mtmwork` · 采样 13 个智能体 / 1191 条 task / 254 条 issue / 6 个项目 / 3 个 runtime。

## 命令清单(全部实跑通过)

| 命令 | 用途 | 返回形状 | 档位 |
|---|---|---|---|
| `multica agent list --output json` | 角色名单 + 职业定位 + **技能栏** | 数组 | 冷 |
| `multica agent tasks <id> --output json` | 战斗记录 + 血缘 | 数组,`created_at` 倒序 | 温/巡 |
| `multica agent mcp list <id> --output json` | 装备栏 | 数组(**实测全员为空**) | 按需 |
| `multica issue list --status <s> --limit 100 --output json` | 谁在打什么 | **信封对象** | 热 |
| `multica issue list --limit 100 --offset N --output json` | 全量关卡 | 信封对象 | 冷 |
| `multica issue list --project <id> ...` | 某战役的关卡 | 信封对象 | 按需 |
| `multica issue children <id> --output json` | 按 stage 分层的关卡树 | 对象 `{stages,unstaged,total}` | 按需 |
| `multica project list --output json` | 章节列表 | 数组 | 冷 |
| `multica squad list --output json` | 公会 | 数组 | 冷 |
| `multica runtime list --output json` | 运行时在线状态 | 数组 | 冷 |
| `multica runtime usage <id> --days N --output json` | 蓝条(token) | 数组 | 冷 |
| `multica runtime activity <id> --output json` | 小时级活跃 | 数组,固定 24 条 | 冷 |
| `multica issue create ...` | **派活**(写) | 对象 | 用户触发 |
| `multica issue comment add ...` | **喊话**(写) | 对象 | 用户触发 |

## 踩过的坑(照抄就能省事)

1. **`agent list` 已经内联了完整技能栏。** `skills` 字段就是 `agent skills list` 的内容 ——
   一次调用拿全 13 人,不用逐个调,省 13 次往返。
2. **`issue list` 返回的是信封不是数组**:`{issues, total, limit, offset, has_more}`。
3. **`issue list --limit` 服务端硬上限 100。** 传 500 会被静默截到 100,`has_more` 才是真话。
   254 条 issue = 3 页。
4. **`--status` 不支持逗号分隔多值。** 一次一个状态。
5. **`agent tasks` 没有分页,一次返回全部历史。** 这是整套设计最大的约束,详见 `polling.md`。
6. **`task.issue_id` 用空字符串 `""` 表示「没有 issue」,不是 `null`。** 实测 108 条这样
   (chat 16 / quick_create 85 / autopilot 7)。归一层统一转成 `null`。
7. **`task.failure_reason` 只在 `status=failed` 时存在**,其余情况这个 key 直接不出现。156/156 命中。
8. **`task.error` 是字符串,不是对象。**
9. **`task.result` 只在 `status=completed` 时非空**(911/911),failed / cancelled / running 全为 `null`。
10. **`avatar_url` 有三种形态**:`emoji:🦋`、`data:image/svg+xml,...`、`https://...`。
    前端渲染要三种都认(苏绘那一棒的像素立绘会覆盖掉它,但兜底逻辑还得在)。
11. **`--output json` 只写 stdout,提示和警告走 stderr。** 别合并两个流去解析。

## 字段级映射

### 角色状态(`RosterEntry`)

| 契约字段 | 来源 | 备注 |
|---|---|---|
| `agent_id` / `name` / `avatar_url` / `model` / `runtime_id` | `agent list` → `id` / `name` / `avatar_url` / `model` / `runtime_id` | |
| `display_name` / `role_title` | `agent list` → `name` 按全角竖线 `｜` 拆 | 「周构｜架构师」→「周构」+「架构师」 |
| `class_desc` | `agent list` → `description` | 职业定位 |
| `runtime_status` | `runtime list` → 按 `agent.runtime_id` 匹配 → `status` | 实测只见过 `online` |
| `state` / `state_reason` | 由 `agent tasks` + 热档 issue + `runtime list` 推导 | 规则见 `src/aggregate/battle-state.ts` |
| `battles_loaded` | 服务自己的缓存状态 | 分档轮询下不是每轮都有 |
| `current_battles[]` | `agent tasks` → `status == "running"` 的条目 | **数组**:`max_concurrent_tasks` 实测取值 3 / 6 |
| `last_battle` | `agent tasks` → 第一条非 running 的 | 列表本身就是倒序 |
| `stats.*` | `agent tasks` 全量聚合 | 口径见下 |
| `deep_link` | 配置模板 | **唯一未实测项**,见文末 |

### 一场战斗(`Battle`)

| 契约字段 | 来源 | 归一规则 |
|---|---|---|
| `task_id` / `agent_id` / `attempt` / `max_attempts` | `agent tasks` 同名字段 | |
| `retries` | `attempt - 1` | 重试 = 平台新建一条 `attempt+1` 的 task,不是原地改 |
| `status` | `task.status` | `completed`→`won` / `failed`→`lost` / `cancelled`→`aborted` / `running`→`running`;原值留在 `status_raw` |
| `kind` | `task.kind` | `direct`→`issue`;其余 `chat`/`quick_create`/`comment`/`autopilot` 原样 |
| `issue` | `task.issue_id` → 从 issue 缓存里查 | `""` 归一成 `null`;查不到时给只有 id 的壳 |
| `created_at` / `started_at` / `completed_at` | 同名字段 | `started_at` 实测 115 条为 `null`(cancelled 111 / failed 4) |
| `elapsed_ms` | running: `now - started_at`;已结束: `completed_at - started_at` | `started_at` 为 null 时 `null`,不是 0 |
| `failure_reason` / `error_text` | `task.failure_reason` / `task.error` | 仅 `lost` 时非空 |
| `failure_kind` | 由 `failure_reason` 前缀推 | `agent_error.*`→`agent`;`runtime_offline`/`runtime_reconnect_timeout`/`idle_watchdog`/`queued_expired`→`runtime` |
| `output_excerpt` / `output_truncated` | `task.result.output` 前 800 字 | 仅 `won` 时非空 |
| `pr_url` | `task.result.pr_url` | 空串归一成 `null`;**实测本 workspace 1191 条全为空** |
| `delivered_comment_ids` | 同名字段 | 实测 614/1191 条非空 —— 战斗回放靠它找「每棒交付了什么」 |

**`failure_reason` 实测全部取值**(1191 条样本):
`agent_error.model_not_found_or_unavailable` / `agent_error.provider_network` /
`agent_error.provider_capacity_or_rate_limit` / `agent_error.provider_server_error` /
`agent_error.provider_quota_limit` / `agent_error.process_failure` / `agent_error.unknown` /
`runtime_offline` / `runtime_reconnect_timeout` / `idle_watchdog` / `queued_expired`

**战绩口径**:胜 = `completed`,败 = `failed`,中止 = `cancelled`。
**中止不计入胜率** —— 取消大多是人改主意,不是角色打输了,算进去会冤枉人。
胜率分母为 0 时返回 `null`,不返回 0。

### 血缘 / 接力链(`Lineage`)

来源全在 `agent tasks` → `attribution`。

| 契约字段 | 来源 | 实测 |
|---|---|---|
| `source` | `attribution.source` | 取值:`direct_human` / `delegation` / `owner_fallback` / `trigger_owner` |
| `precise` | `attribution.precise` | 平台自己标的置信度,`false` 表示是兜底推断的 |
| `from_task_id` | `attribution.delegated_from_task_id` | 855/1191 条有值 |
| `from_resolved` | 服务自己判断能不能在当前数据里找到那条 task | **855 条里有 99 条找不到**(全是 2026-08-25 之前的老数据) |
| `evidence_kind` / `evidence_ref_id` | `attribution.evidence.kind` / `.ref_id` | 取值:`issue_assignment` / `comment` / `chat` / `autopilot_run` |
| `initiator` / `originator` | `attribution.initiator` / `.originator` | 原始返回带 `email`,**契约里刻意不传**(PII,指挥舱用不到) |

> ⚠️ **接力链一定会断。** 99/855 的上一棒查不到。战斗回放必须能画「往上还有,但查不到了」,
> 不能假装那就是链条起点。契约里的 `BattleChain.broken` 就是干这个的。

### 关卡 / 战役地图(`QuestNode` / `CampaignMap`)

| 契约字段 | 来源 |
|---|---|
| `issue_id` / `identifier` / `title` | `issue list` → `id` / `identifier` / `title` |
| `status` / `status_category` | `issue.status` / `issue.status_category` |
| `level`(怪物等级) | `issue.priority`。实测分布:high 126 / medium 58 / low 40 / none 22 / urgent 8 |
| `stage`(第几关) | `issue.stage`。**实测 254 条里 142 条为 `null`** —— 不分关的那一堆不小,界面得有地方放 |
| `parent_issue_id` | 同名字段 |
| `assignee` | `issue.assignee_id` + `assignee_type`,名字从 `agent list` 查 |
| `assignee_battle_state` | 该智能体当前状态 |
| 分层结构 | `issue children <parent-id>` → `{stages:[{stage,total,done,issues}], unstaged, total}` |

`issue.status` 实测分布(254 条):done 221 / backlog 18 / cancelled 7 / in_progress 6 / blocked 1 / todo 1。
`status_name` 实测全为空串 —— 没人用自定义状态名。

### 蓝条 / 运行时(`RuntimeVitals`)

| 契约字段 | 来源 |
|---|---|
| `runtime_id` / `name` / `status` / `last_seen_at` / `provider` / `device_info` | `runtime list` 同名字段 |
| `mana.input_tokens` 等 | `runtime usage <id> --days N` → 一行 = 一个 `(date, model)` 组合,服务端聚合 |
| `mana.by_model[]` | 按 `model` 分组 |
| `activity_24h[]` | `runtime activity <id>` → 固定 24 条 `{hour, count}` |

## 一期不做(拉不到,不是没做)

| 想要的东西 | 为什么不做 |
|---|---|
| **人均蓝条 / 人均花费** | `runtime usage` 的粒度是 **runtime,不是 agent**。13 个智能体全跑在同一个 runtime(`208b4218…`)上,**token 用量摊不到人头**。契约里 `AgentStats.mana` 恒为 `null`,全局蓝条走 `RuntimeVitals`。 |
| **花费(美元)** | `runtime usage` 的 `cost_usd_ticks` **实测恒为 0**,当不了真。`ManaStats.cost_usd` 恒为 `null`。 |
| **装备栏(MCP)有内容** | `agent mcp list` 对 13 个人全部返回 `[]`,`agent list` 的 `mcp_config` 全为 `null`。接口是通的,这个 workspace 现在就是没人挂 MCP。**契约保留字段,界面要能画「装备栏空着」。** |
| **按日期看活跃** | `runtime activity` 只给 24 个小时桶,没有日期维度。 |
| **PR 链接** | `task.result.pr_url` 实测 1191 条全为空串。字段保留,界面不要依赖它有值。 |
| **公会全量成员** | `squad list` 只给 `member_preview`(前几个)。要全量得 `squad get`,一期用不上。 |
| **「这一战实际用了什么技能」** | 平台没有结构化记录。技能栏只展示「会什么」,不展示「用了什么」(父任务已定的天花板)。 |
| **进行中任务的过程步骤** | 平台只给开始/结束/成败。二期的「战斗直播」要读本地 daemon 日志才行。 |

## 唯一一个没实测的东西:deep_link

跳回 Multica 本体的 URL 形状,我没法在这台机器上从 CLI 反推出来 —— CLI 的任何返回里都没有网页 URL。

处理方式:**做成配置,不做成猜测。**

```
COCKPIT_ISSUE_URL_TEMPLATE=https://<你的 Multica 地址>/{workspace}/issue/{identifier}
COCKPIT_AGENT_URL_TEMPLATE=...
COCKPIT_PROJECT_URL_TEMPLATE=...
COCKPIT_WORKSPACE_SLUG=mtmwork
```

没配时所有 `deep_link` 都是 `null`,界面不画跳转按钮,其它功能一律不受影响。

**联调第一件事**:在浏览器里打开一个真实 issue,把地址栏的 URL 形状抄进这几个变量,核一次就定死。
(workspace slug 可以从 `multica workspace list` 拿到,实测本 workspace 是 `mtmwork`。)
