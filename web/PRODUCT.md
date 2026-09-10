# 指挥舱前端初版 · 产品文档(MTM-277)

六样齐:产品目标 / 功能清单 / 功能定义 / 交互逻辑 / 已实现前端 / 待后端配合项。

---

## 一、产品目标

**给谁用**:heory 一个人,桌面浏览器,本机运行。

**解决什么**:任务派出去之后智能体在干嘛是黑盒 —— 只能翻 issue 列表、等评论。
指挥舱把 13 个智能体变成一屏游戏角色列阵:谁在打怪、打哪只、打了多久、失败几次,打开 3 秒看清。

**一期的边界**:

- **写操作只有两个**:派活(建 issue + 指派)、喊话(发评论 + 唤醒)。
  两个都是「提交即真实发生」,UI 强制两段式确认;其余一切改动一律跳回 Multica 本体。
  (MTM-277 交付时这两个还是禁用的占位,MTM-278 接通成真实写操作。)
- **默认真数据**。`npm start` 端出来的界面默认打本机 BFF;mock 演示数据挂在 `?source=mock`,
  留给调界面和走查状态形态用 —— 它严格按周构契约(`src/contract/types.ts`)生成,结构与真数据一致。
- 不做手机端、不做多账号、不改 Multica 本体;低频操作一律跳回本体,不在舱内复刻。

## 二、功能清单

| # | 功能 | 屏 | 状态 |
|---|---|---|---|
| 1 | 全员列阵(状态灯/在打的怪/耗时/重试) | 主视图 `#/` | ✅ 本棒 |
| 2 | 告警计数条(失败+卡住独立分组,waiting 不算卡住) | 主视图 | ✅ 本棒 |
| 3 | 角色详情(职业/技能/装备/战绩/最近战斗与交付) | `#/agents/:id` | ✅ 本棒 |
| 4 | 战役列表(项目进度) | `#/projects` | ✅ 本棒 |
| 5 | 战役地图(stage 分层/done 点亮/failed 标红/挂头像/关卡侧栏) | `#/projects/:id` | ✅ 本棒 |
| 6 | 战斗回放(接力链时间轴/断链/推断血缘/本棒标记) | `#/battles/:taskId` | ✅ 本棒 |
| 7 | 跳回本体(角色卡/关卡/战斗行全有入口,deep_link null 时消失) | 全站 | ✅ 本棒 |
| 8 | 数据新鲜度(degraded 黄条/stale/失败不清屏) | 全站 | ✅ 本棒 |
| 9 | waiting(待接力)皮肤补齐:映射+角标+灯+token | pixel/ | ✅ 本棒(沈执点名) |
| 10 | 派活(真实建 issue 并指派) | 主视图入口已留 | ⏭ MTM-278 |
| 11 | 喊话(落 issue 评论并唤醒) | 角色详情入口已留 | ⏭ MTM-278 |
| 12 | 全局蓝条/运行时体征(`/api/runtimes`) | 未画屏 | ⏭ 后续(见「缺哪样」) |
| 13 | 战斗直播、等级经验 | — | ⏭ 二期,不碰 |

**缺哪样、为什么缺**:六样文档一样不缺;五屏全交。唯一没画的读接口是 `RuntimeVitals`(全局蓝条):
它不属于 issue 点名的五块,而且一期人均蓝条恒 null(契约注明摊不到人头),单独一屏信息量太薄 ——
建议并入 MTM-278 做完真数据后,在主视图顶栏挂一枚「运行时体征」小组件,已列入待后端配合项。

## 三、功能定义(输入 → 输出 → 成功 / 异常)

**1 全员列阵**:输入 `GET /api/roster`(Roster);每人一张角色卡:状态灯(七态)、立绘(状态姿势)、
在打的怪(`current_battles[]`,数组渲染,一人可多场)、已耗时(`meta.server_time` 现算)、重试次数、战绩、详情/回放/跳回入口。
成功 = 13 人齐、counts 与卡片一致。异常:`battles_loaded=false` → 骨架屏(绝不画 0 胜 0 败);
拉失败 → 保留上一份数据 + 顶部红字;`state` 未知值 → unknown 灰态。

**2 告警计数**:`counts` 里 `defeated+stalled` 单独一组置顶(「要出手」),`waiting` 明确不入组 —— 场景 1 的灯零误报。

**3 角色详情**:输入 `GET /api/agents/:id`(AgentDetail)。职业定位(class_desc)、技能栏(skills,含停用态)、
装备栏(MCP;**全空是真实状态**,画空槽说明)、战绩(胜/败/中止/胜率;**mana 恒 null,注明拆不到人头**)、
当前战斗、最近 20 场(失败带 failure_reason/error_text 与归因;胜利带交付摘要与「已截断」标)。
异常:id 查无 → not_found 错误态 + 回主视图;501 → 「下一棒接入」说明态。

**4/5 战役**:输入 `GET /api/projects` + `/api/projects/:id/map`(CampaignMap)。
地图按 `stages[]` 升序一行一关,`unstaged` 单列一层(不是边角料);节点样式:done ✓ 点亮 /
in_progress·in_review ▶ 发光 / blocked 或出击者 defeated ✕ 标红 / cancelled 封锁纹 / todo·backlog 待出击。
进行中节点挂出击角色头像(带其实时状态)。点节点 → 侧栏:状态/等级/出击角色/最近动静/跳回本体/角色详情。

**6 战斗回放**:输入 `GET /api/battles/:taskId/chain`(BattleChain)。时间正序时间轴,每棒:头像+名字+第 N 棒+
时刻+耗时+结局+交付(output_excerpt / 交付评论数)+交棒人;`broken=true` → 顶部「往上还有,但查不到了」;
`lineage.precise=false` → 虚线 + 「血缘为推断」标;`truncated` → 「只显示最近 30 棒」;焦点棒标「◈ 本棒」。

**7 跳回本体**:所有 `deep_link` 字段落成「↗ 跳回本体」新标签页链接;null(没配模板)时按钮不渲染。

**8 新鲜度**:`meta.degraded` 非空 → 黄条「数据没丢,只是旧了」;`meta.stale` → 「数据可能过期」;
轮询失败 → 红字说明 + 继续显示上一份好数据(不清屏)。

## 四、交互逻辑

**入口与路由**(hash 路由,可收藏可刷新):`#/` 主视图 → 点角色名/详情 → `#/agents/:id` →
点任一战斗「回放」→ `#/battles/:taskId`;顶栏「战役地图」→ `#/projects` → 进入战役 → `#/projects/:id` →
点关卡 → 侧栏 → 「出击角色详情」回到角色屏。每屏都有面包屑回退,没有死角。

**状态流转**:全站每 3~30 秒轮询(主视图 3s/详情 5s/地图 10s/列表 30s;页面切后台自动停,回来立刻补一拍)。
mock 会走时间:战斗耗时逐秒涨;开机头 6 秒许界、梁运是「战绩加载中」骨架,随后自动补齐 —— 和真系统的温档轮询一个节奏。

**页面联动**:角色状态在主视图卡、地图节点头像、侧栏状态胶囊三处同源一致;回放链上每棒都能跳到该角色详情。

**权限/空/错误/禁用态**:无登录(本机单用户);空态(无战斗记录/无关卡/装备栏空)均有专门文案;
错误态分三种口吻:not_found(回主视图)、501(下一棒接入,不是坏了)、网络失败(可重试,不清屏);
禁用态:「⚔ 派活」「📣 喊话」按钮 disabled + 斜纹 + tooltip 说明归 MTM-278。

**演示开关**(仅 mock):顶栏「🎛 演示」→ 黄条/过期/重演加载相位,给验收走查用,不碰真实系统。

## 五、已实现前端

- React 19 + TS + Vite,无 UI 组件库,皮肤 100% 走苏绘 `pixel/` token 与组件(主题 A 深空指挥舱);
  立绘直接用 `<pixel-avatar>`,agent_id 即插即用。
- **皮肤补齐 waiting**(沈执点名的坑 1):`STATE_FROM_CONTRACT` 加 `waiting→idle` 映射、
  `--pc-st-waiting` 三主题 token、`.pc-lamp--waiting`(下半实心)、`.pc-flag--waiting` 角标、
  `.pc-unit--waiting` 卡框,aria 标签、pixel 测试与 README 同步到 7 态。
- 测试:web 侧 vitest(状态语义/时间口径/mock 契约行为/五屏关键交互,先写红后转绿);
  仓库根 `npm test` 122 条不受影响,全绿。
- **哪些数据是假的:mock 模式下全部**(13 人名单取自苏绘名册的真实 agent_id,战斗/项目/链条是编排的演示剧本);
  `?source=live` 下 `/api/roster` 是真数据,其余接口等 MTM-278。mock 与契约的对齐由 `satisfies` + typecheck 压死。

## 六、待后端配合项(接口级,韩程照单接)

1. `GET /api/agents/:id` → `AgentDetail`:契约已定,前端已按 501 兜底,接通即亮。
2. `GET /api/projects` → `ProjectRef[]`;`GET /api/projects/:id/map` → `CampaignMap`:同上。
   注意 `totals.failed` 契约没写判定口径,前端 mock 用的是「status_category=blocked 或出击者 defeated」——
   请按同口径实现或在契约里补注释。
3. `GET /api/battles/:taskId/chain` → `BattleChain`:断链(broken)/截断(truncated)/precise=false 三形态前端都已渲染,别省。
4. **缺一个「按 issue 查战斗」的能力**(战役地图节点直开回放要用)。二选一,请周构/沈执定:
   **A.** `QuestNode` 加一个 `latest_task_id: string | null`(改契约,前端改动最小);
   **B.** 新增 `GET /api/issues/:id/battles` → `Battle[]`(不动现有类型,多一个接口)。
   前端现状:侧栏引导到出击角色详情(那里每场战斗都有回放),不阻塞验收。
   **【MTM-278 落实】走了 B 案:新增 `GET /api/issues/:id/battles` → `Battle[]`,战役地图侧栏已接「查这场战斗」,直接列出该关卡的战斗与回放入口;前端 `CockpitApi` 加了 `issueBattles()`。**
5. `POST /api/commands/dispatch` / `shout`:入口已留(主视图「派活」、详情「喊话」),
   请求/响应类型契约已定(`DispatchRequest/Result`, `ShoutRequest/Result`);接通时 guard W1~W5 同时生效。
6. `GET /api/runtimes` → `RuntimeVitals[]`:前端本版未画屏;建议接通后在主视图顶栏加「运行时体征」小组件
   (在线状态 + 7 日 token 总量 + 24h 活跃直方图,`activity_24h` 没有日期维度,别画成时间轴)。
7. deep_link:真实跳转地址靠 BFF 配 `COCKPIT_ISSUE_URL_TEMPLATE` / `COCKPIT_WORKSPACE_SLUG`
   (mock 用的占位域名 `multica.example`);没配时字段为 null,前端自动隐藏按钮,两边不用改代码。
8. 轮询频率:前端主视图 3s 打的是 BFF 内存缓存(周构实测 p50 41~48ms),不会穿透到 CLI;
   若 BFF 降档(HOT_MS 调大),前端不用改 —— 新鲜度全看 `meta`。
