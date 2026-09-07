# 指挥舱前端(初版,MTM-277)

五屏能点能走的前端初版:主视图 / 角色详情 / 战役列表+地图 / 战斗回放 / 全站跳回本体。
**默认吃 mock 数据**(结构严格等于 `../src/contract/types.ts` 的契约),加 `?source=live` 切到真 BFF。
产品口径、功能定义、交互逻辑、待后端配合项 → 同目录 `PRODUCT.md`。

## 跑起来(照着做就能跑)

```bash
# 1. 装依赖(只有前端需要装;仓库根的 BFF 仍是零依赖)
cd web
npm install

# 2. 启动
npm run dev

# 3. 打开
#    http://localhost:5173/        ← 默认 mock 演示数据,开箱即看
#    http://localhost:5173/?source=live   ← 切真数据(要先在仓库根 npm start 起 BFF;
#                                            /api/roster 是真数据,其余接口 501 有专门说明态)
```

不需要测试账号 —— 本地单用户工具,没有登录。

**mock 里能走查到什么**(演给验收看的形态,一个不缺):
七种状态齐全(战斗/卡住/失败/待接力/空闲/离线/未知)、开机头 6 秒的「战绩加载中」骨架屏、
多线作战(Mika 2 场)、断链回放(顾检)、五棒接力链(策衡 MTM-277)、空装备栏、
deep_link 为 null 时按钮消失(内置助手)。顶栏「演示」菜单可开黄条(degraded)/
过期(stale)/ 重演加载相位。

## 测试怎么跑

```bash
npm test          # vitest,76 条:状态语义 / 时间口径 / mock 契约行为 / 五屏关键交互
npm run typecheck # tsc:mock 结构全部 satisfies 契约类型 —— 这条就是「逐字段核契约」
npm run build     # 产物在 web/dist(已 gitignore)
```

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
│  ├─ lib/         states(七态→界面语义唯一映射)/ format(时间口径)/ usePoll(轮询)
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
