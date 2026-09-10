# 指挥舱前端

五屏:主视图 / 角色详情 / 战役列表+地图 / 战斗回放 / 全站跳回本体。
产品口径、功能定义、交互逻辑、待后端配合项 → 同目录 `PRODUCT.md`。

## 平时用它:不用进这个目录

在**仓库根**跑 `npm start`,打开 `http://127.0.0.1:4780/` 就是完整的指挥舱 ——
BFF 自己把构建产物端出去,界面和接口同源同端口,**默认真数据**。
改了 `web/` 下的东西,下次 `npm start` 会自动重新构建。

## 改界面时:开发服(热更新)

```bash
cd web
npm install
npm run dev          # → http://localhost:5173/
```

开发服**默认吃 mock 演示数据**(结构严格等于 `../src/contract/types.ts` 的契约)——
调样式、走查状态形态时不打真接口,也不会误触发写操作。

要在开发服上打真数据:`http://localhost:5173/?source=live`,并且 BFF 那边得放行 Vite 的端口
(`COCKPIT_DEV_ORIGIN_PORTS=5173 npm start`)—— 5173 和 4780 是跨源,默认一个都不放行。

不需要测试账号 —— 本地单用户工具,没有登录。

**默认值是怎么定的**(`src/api/api.ts` 的 `pickSource`):
`?source=` > `localStorage.cockpit_source` > 兜底值;兜底值由构建产物还是开发服决定
(`import.meta.env.PROD`)。一个「看全队在干嘛」的工具默认给假数据,
会让人拿假状态做真决定 —— 所以端出去的那一份必须默认真。

**mock 里能走查到什么**(演给验收看的形态,一个不缺):
七种状态齐全(战斗/卡住/失败/待接力/空闲/离线/未知)、开机头 6 秒的「战绩加载中」骨架屏、
多线作战(Mika 2 场)、断链回放(顾检)、五棒接力链(策衡 MTM-277)、空装备栏、
deep_link 为 null 时按钮消失(内置助手)。顶栏「演示」菜单可开黄条(degraded)/
过期(stale)/ 重演加载相位。

## 测试怎么跑

```bash
npm test          # vitest,97 条:状态语义 / 时间口径 / 轮询稳态 / mock 契约行为 / 五屏关键交互
npm run typecheck # tsc:mock 结构全部 satisfies 契约类型 —— 这条就是「逐字段核契约」
npm run build     # 产物在 web/dist(已 gitignore)
```

端到端的五场景冒烟不在这里,在仓库根的 `e2e/`(Playwright,打真服务)。

> **测试文件必须叫 `*.test.tsx`(哪怕没有 JSX),也不许放进名为 `test` 的目录。**
> 仓库根的 `npm test` 是裸 `node --test` 全仓库自动发现(MTM-280 的设计),
> 它按名字认 `*.test.ts/js` —— 前端测试是 vitest 域,后缀撞了会被两个 runner 抢着跑,
> node 一跑就红。`.tsx` 不在 node 的发现规则里,恰好是干净的分界。

## 结构

```
web/
├─ src/
│  ├─ api/         数据源接口 + live 实现(打 /api/*,Vite 代理到 127.0.0.1:4780)
│  ├─ mock/        mock 世界(契约形状的小系统:会走时间、有加载相位)+ mock 数据源
│  ├─ lib/         states(七态→界面语义唯一映射)/ format(时间口径)/ usePoll(轮询,含稳态测试)
│  ├─ components/  bits(立绘/灯/角标/跳回)/ UnitCard(角色卡)/ StatusBanner
│  ├─ screens/     五屏:Roster / Agent / Projects / Campaign / Replay
│  └─ router.ts    迷你 hash 路由(#/、#/agents/:id、#/projects[/:id]、#/battles/:taskId)
├─ vite.config.ts  @contract → ../src/contract/types.ts;@pixel → ../pixel
└─ PRODUCT.md      产品文档六样(目标/清单/定义/交互/已实现/待后端)
```

## 前端 README 老四条的落点(周构点名必须画的)

| 要求 | 落在哪 |
|---|---|
| `meta.degraded` 非空 → 黄条不清屏 | `StatusBanner`,轮询失败也保留上一份好数据(`usePoll`) |
| `meta.stale` → 数据可能过期 | `StatusBanner` |
| `battles_loaded=false` → 骨架屏,绝不画 0 胜 0 败 | `UnitCard` / `AgentScreen`,有测试锁死 |
| `state='unknown'` → 灰色加载态 | 七态映射表 `lib/states.ts`,没见过的值也归 unknown |

其余口径:已耗时一律用 `meta.server_time` 算(`lib/format.ts` 里没有任何函数偷看本地时钟);
`current_battles` 按数组渲染;`deep_link` 为 null 不画按钮;`avatar_url` 三形态兜底(emoji:/data:/https:)。
