# 技术栈选型与模块边界

## 一句话

**一个跑在 heory 本机的 Node 服务把 multica CLI 的数据嚼碎、缓存好,前端每 3 秒来拿一次现成的。**
前后端各管各的,中间靠一份写死的 JSON 契约对接。

## 整体形状

```
浏览器(像素风页面)
    │  每 3 秒 GET /api/roster  —— 只读内存缓存,实测 p50 41~48ms
    ▼
本机 BFF(Node,监听内网 0.0.0.0 —— heory 拍板 C 案,安全闸挡公网)
    │  分四档拉取:热 3s / 温 10s / 巡 60s / 冷 300s
    ▼
multica CLI(execFile,不走 shell)
    │
    ▼
Multica 平台
```

**这里最关键的一条结构决定:浏览器的刷新节奏和 CLI 的拉取节奏是两回事。**
浏览器每 3 秒问一次,永远从内存里拿到答案;后面拉多快、拉不拉得动,由 BFF 说了算。
没有这层隔离,前端的刷新频率就等于打 CLI 的频率,一定把本机打爆(实测全量一轮 5 秒起,见 `polling.md`)。

## 选型

### 本地服务:Node.js ≥ 22.18(实测机器 v24.15.0)+ TypeScript,**零运行时依赖、零构建步骤**

- **为什么是 Node**:唯一的数据源是 `multica` CLI,得靠子进程去调。
  Node 的 `child_process` + 异步并发天生合适,而且这台机器上已经装好了(Multica 运行时自己就是 Node)。
- **为什么零依赖**:直接用内置的 `node:http`。
  `git clone` 下来 **不用 `npm install` 就能 `npm start`** —— 这是「一条命令能跑」最硬的答案。
  一个本机单用户的只读聚合服务,框架带来的路由/中间件/校验没有一样是必需的。
- **为什么还能写 TypeScript**:Node 22.18+ 直接执行 `.ts`(类型擦除),Node 24 默认开启。
  **有类型,但没有构建步骤。** 我这一棒交付的核心就是一份契约,契约用可编译的类型写才有约束力。
- **类型检查怎么办**:`npm run typecheck`(需要 `npm install`,只装两个 devDependency)。
  Node 只擦类型不检查类型 —— **不跑 tsc 就等于没有契约约束,CI 和验收都要跑这条。**
- **测试用内置 `node:test`**:同样不需要装东西,`npm test` 直接跑。

> ⚠️ 一个副作用:Node 的类型擦除模式**不支持构造函数参数属性**(`constructor(private x: T)`)、
> 不支持 `enum`、不支持 namespace。`tsconfig.json` 里开了 `erasableSyntaxOnly: true`,
> 写错了 `npm run typecheck` 会当场报出来,不用等到运行时。

### 前端:React 19 + TypeScript + Vite

- **React**:苏绘 / 策衡 / 许界 手上的 `design-taste-frontend` 等技能都是围绕它的,上手成本最低。
- **Vite**:开发期热更新 + 代理到 BFF,构建产物是纯静态文件,`npm start` 直接托管。
- **不上 UI 组件库**:像素风皮肤是自己写 CSS,任何 Material/Ant 之类的库只会来打架。
- **轮询建议用 TanStack Query**:它自带 stale-while-revalidate、请求去重、失败退避 ——
  正好是本文要求的那套纪律,不用手写。**但这是建议不是约束**:契约是纯 HTTP + JSON,
  换任何数据层都不影响。
- 前端这一棒不在本 issue 范围内(苏绘 MTM-276 / 后面的界面棒),这里只把方向定下来,不占坑。

### 传输:浏览器轮询 BFF

父任务已定「平台没有推送通道,只能轮询」。浏览器 → BFF 这一跳也用轮询,因为够简单够好使
(实测 p50 41~48ms)。信封里带 `fetched_at` / `age_ms` / `stale`,前端能显示「数据 X 秒前」。

以后想换 SSE 让 BFF 主动推,**契约一个字都不用改** —— 推的还是同一个 `ApiEnvelope<T>`。

## 模块边界(谁能碰谁)

```
src/
├─ contract/types.ts     ← 契约的唯一权威定义。前端只认这个文件。
├─ multica/
│  ├─ raw.ts             ← multica CLI 的原始字段(实测得到)
│  └─ source.ts          ← 唯一的出网口:MulticaSource 接口 + CLI 实现
├─ aggregate/
│  ├─ normalize.ts       ← raw → contract 的归一
│  ├─ battle-state.ts    ← 状态灯判定规则(纯函数)
│  └─ roster.ts          ← 主视图聚合(纯函数)
└─ server/
   ├─ config.ts          ← 全部配置来自环境变量
   ├─ cache.ts           ← 分层缓存 / 单飞 / 退避
   ├─ guard.ts           ← 安全闸 + 入参校验
   ├─ poller.ts          ← 分档轮询
   └─ index.ts           ← HTTP 入口
```

四条边界规矩,每条都配一句「防的是什么」:

1. **只有 `multica/source.ts` 能碰 CLI、能出网。**
   防的是:出网口散在各处,安全边界没法审,超时和并发也管不住。
   顺带:以后要换传输(直接打 HTTP API),只换这一个文件的实现,上面两层一行不用改。

2. **`multica/raw.ts` 里的原始字段名不许漏到 `server/` 和前端。**
   防的是:平台改一个字段名,整条链一起烂,连界面都得改。
   有了归一层,平台变动只有 `normalize.ts` 会疼。

3. **`aggregate/` 全是纯函数:不碰 IO、不碰时钟(`now` 由调用方注入)。**
   防的是:状态判定这类最容易吵架的逻辑没法单独测。
   现在顾检可以不起服务、不连平台,直接对着 `test/battle-state.test.ts` 逐条核规则。

4. **未知枚举一律降级成 `unknown` 并保留原值,绝不抛异常。**
   防的是:平台以后加一个新状态,指挥舱白屏。
   代价是前端必须能渲染 `unknown` —— 这条写进契约了。

## 接口一览

| 方法 | 路径 | 返回类型 | 骨架状态 |
|---|---|---|---|
| GET | `/api/health` | `Health` | ✅ 真实现 |
| GET | `/api/roster` | `Roster` | ✅ 真实现(真数据) |
| GET | `/api/agents/:id` | `AgentDetail` | 501,契约已定 |
| GET | `/api/projects` | `ProjectRef[]` | 501,契约已定 |
| GET | `/api/projects/:id/map` | `CampaignMap` | 501,契约已定 |
| GET | `/api/battles/:taskId/chain` | `BattleChain` | 501,契约已定 |
| GET | `/api/runtimes` | `RuntimeVitals[]` | 501,契约已定 |
| POST | `/api/commands/dispatch` | `DispatchResult` | 501,契约+安全规则已定 |
| POST | `/api/commands/shout` | `ShoutResult` | 501,契约+安全规则已定 |

501 的那些**不是待设计,是待实现** —— 字段、枚举、空值约定全在 `src/contract/types.ts` 里写死了,
照着填就行,不用回来问我字段长什么样。

## 明确不做的(一期边界)

- 不做登录 / 多用户 / 权限体系。单用户本机工具。
- 不做手机端。桌面浏览器优先。
- 不改 Multica 本体。纯外挂,读 CLI,写只有两条。
- 不做持久化。全部数据在内存里,重启从头拉(冷启动 1.2 秒可应答,值不当再存一份)。
- 不做二期的「战斗直播」「等级经验成就」。

## 给后面几棒的交接要点

**韩程(真聚合)**:
- 契约在 `src/contract/types.ts`,原始字段和踩坑在 `docs/data-sources.md`。
- `/api/roster` 已经打通到真数据,照它的写法填其余接口;`aggregate/` 保持纯函数。
- 写操作接口接真实现时,`guard.ts` 的 W1~W5 必须同时生效,别先接通再补安全。
  `test/guard.test.ts` 已经把规则测好了。
- 别给 13 个人每轮都拉 `agent tasks`。理由和数字在 `docs/polling.md`,这是全局最大的性能坑。

**苏绘 / 许界(界面)**:
- 三个状态必须画出来,不能少:`state === 'unknown'` / `battles_loaded === false`(加载中,
  **不要显示成 0 胜 0 败**)、`meta.degraded` 非空(顶部黄条)、`meta.stale`(数据可能过期)。
- `avatar_url` 有三种形态:`emoji:🦋` / `data:image/svg+xml,...` / `https://...`,都要认。
- `deep_link` 可能是 `null`(没配跳转模板),那时别画跳转按钮。
- `current_battles` 是**数组**,一个角色可能同时打多场。
- 已耗时用 `meta.server_time` 算,不要用浏览器本地时钟。

**沈执**:PR 由你合,我不自己合。
