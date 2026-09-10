# AetherLab 指挥舱

跑在自己机器上的智能体工作中心。13 个智能体像游戏角色一样列阵:谁在打怪、打哪只、打了多久、失败几次,
打开页面一眼看清;还能在页面里直接派活、对阵中的角色喊话。

一期已收口:五屏跑真数据,派活/喊话是真实写操作。

## 装什么

只要 **Node.js ≥ 22.18**(推荐 24)和 **已登录的 `multica` CLI**。

```bash
node --version      # 应该 >= v22.18
multica version     # 应该能打印版本号
```

不用先 `npm install` —— 界面的依赖 `npm start` 自己会装。

## 一条命令跑起来

克隆下来,在仓库根敲:

```bash
npm start
```

看到这两行就是好了:

```
指挥舱已就绪 → http://127.0.0.1:4780/
自检 → http://127.0.0.1:4780/api/health
```

**浏览器打开 `http://127.0.0.1:4780/`** —— 界面和接口是同一个端口,不用再单独起前端。
顶栏应该显示「● 实时数据」,底下是全队 13 个人。

第一次跑会多花十几秒装前端依赖并构建一次界面(会打印「界面还没构建过,构建一次」);
之后每次启动都跳过,只有改了 `web/`、`pixel/` 或契约才会重新构建。

实测冷启动(安静环境,5 次):**中位 1.8 秒 / 最坏 3.5 秒**看到全队名单,
再过 20~35 秒全员战绩补齐(在那之前个别人是「战绩加载中」骨架屏,不是坏了)。
已经开着的时候,浏览器打开到看清全队 **< 1 秒**。数字怎么测的见 `docs/polling.md`。

想换端口:`COCKPIT_PORT=4791 npm start`。端口被占会直接告诉你被占了,不甩报错栈。

> **服务只监听 127.0.0.1,而且没有改成对外监听的开关。**
> 它握着能指挥全队的凭据,理由和全部安全规则见 `docs/security.md`。

## 别的命令

```bash
npm test          # 全仓库单测(171 条),不需要 npm install
npm run typecheck # 类型检查,需要先 npm install(只装两个 devDependency)
npm run build:web # 强制重新构建界面(平时不用,npm start 会自动判断)
npm run start:api # 只起接口不带界面:零构建、零依赖,给脚本 curl 用
```

**改界面**(热更新)用 `cd web && npm install && npm run dev` → `http://localhost:5173/`。
开发服默认吃 mock 演示数据(改样式不打真接口),`?source=live` 切真数据 ——
要走 Vite 代理打 BFF,得先 `COCKPIT_DEV_ORIGIN_PORTS=5173 npm start`。
前端自己的 97 条测试用 vitest 跑(`cd web && npm test`),不在上面 171 条里。

**主流程冒烟**(五个关键场景端到端):`cd e2e && npm install && npm run install-browser && npm run smoke`。
跑法和覆盖范围见 `e2e/README.md`。

> Node 只擦类型不检查类型 —— **`npm run typecheck` 不跑就等于没有契约约束**,验收和 CI 都要跑这条。

### 测试是怎么被找到的(新增测试前先看这段)

`npm test` 就是一条光秃秃的 `node --test`,**脚本里不写任何 glob** —— 由 Node 自己从仓库根往下递归找。
所以新开目录放测试,不用改任何脚本,它自动就跑上了。

这是刻意的。MTM-280 之前脚本里写死了一条只覆盖 `test/` 的 glob,`pixel/tests/` 的 27 条一条都没跑到,
屏幕上却是「93 全绿」,**没有任何报错**。测试挂了会被看见,测试不跑不会 —— 这类故障最贵。

**上面那个 171 是全仓库总数**(骨架棒 122 + MTM-278 新增 41 + MTM-279 新增 8),不是某个目录的数。
新增测试后请把这个数字改掉;数字只是给人对账用的,真正兜底的是下面这条:

- **测试文件必须叫 `xxx.test.js` / `xxx.test.ts`**,或者放在名为 `test` 的目录里。
  `.spec.` 和 `.tests.` 都**不在** `node --test` 的发现规则内 —— 前端习惯用 `.spec.`,在这个仓库里不行。
- 这条由 `test/test-discovery.test.ts` 按住:凡是 import 了 `node:test` 的文件,只要 `npm test` 发现不了它,
  这条元测试就红并打印文件名。**名字起错 = 红灯,不会再悄悄消失。**

两个用得上的细节:
`node --test <目录>` 在 Node 24 上是坏的(会被当成模块去 require),要单跑某个目录得写 glob,
例如 `node --test "pixel/tests/*.test.js"`;另外 `node --test` 不看 `.gitignore`,本地构建过前端之后
`dist/` 里的产物也会被扫(干净克隆和 CI 没这问题,`dist/` 不进仓库)。

**web/ 和 e2e/ 是另外两个 runner 的地盘**:前端单测归 vitest,文件一律 `*.test.tsx`(哪怕没有 JSX),
且不放进名为 `test` 的目录;e2e 冒烟归 playwright,文件一律 `*.spec.ts`。
`.tsx` 和 `.spec.` 都不在 `node --test` 的发现规则里,三套 runner 才不会抢同一个文件
(`.test.ts` 会被根上的 `npm test` 扫走然后当场跑红,MTM-277 实测过)。规则详见 `web/README.md` 和 `e2e/README.md`。

## 现在能用什么

| 接口 | 状态 |
|---|---|
| `GET /api/health` | ✅ 自检:绑定地址、CLI 可用性、各数据源新鲜度。**只有元数据,不含任何业务数据**(规则 D3) |
| `GET /api/roster` | ✅ 全员角色状态(真数据) |
| GET /api/agents/:id | ✅ 角色详情(技能/装备/最近 20 场/公会) |
| GET /api/projects · /api/projects/:id/map | ✅ 战役列表 + 关卡地图 |
| GET /api/battles/:taskId/chain | ✅ 战斗回放(断链/截断标记) |
| GET /api/issues/:id/battles | ✅ 按 issue 查战斗(MTM-278 新增) |
| GET /api/runtimes | ✅ 全局蓝条/运行时体征 |
| POST /api/commands/dispatch · /shout | ✅ **真实写操作**:派活建 issue + 指派;喊话发评论 + 唤醒。仅此两条 |

上面标 501 的时代结束了(MTM-278 全部填真)。写操作**只有这两条**,其余一律拒绝,规则见 docs/security.md。

## 派活 / 喊话(真实写操作,仅这两条)

这是本仓库**仅有的两个会真实写 Multica 的入口**,都是「提交即真实发生」的动作
(会拉起一次真实运行、消耗用量):UI 上强制两段式确认;BFF 层另有白名单、
限流(每分钟 20 次)、入参校验、临时文件中转四道闸,规则见 `docs/security.md` 的 W1~W5。

```bash
# 派活:给指定角色建 issue 并指派(平台会自动拉起该角色的运行)
curl -X POST http://127.0.0.1:4780/api/commands/dispatch \
  -H 'content-type: application/json' \
  -d '{"title":"修一下首页文案","description":"把 hero 区标题改成中文","assignee_agent_id":"<角色UUID>","priority":"high"}'

# 喊话:对进行中的 issue 发一条评论(平台会唤醒阵地上的角色)
curl -X POST http://127.0.0.1:4780/api/commands/shout \
  -H 'content-type: application/json' \
  -d '{"issue_id":"<issue的UUID>","content":"优先把回归用例跑完再交付"}'
```

请求/响应字段见 `src/contract/types.ts` 的 DispatchRequest / ShoutRequest。
## 配置

全部走环境变量,**仓库里不放任何凭据**(这个仓库是 public 的)。
服务自己不碰 token —— 它调 `multica` CLI,由 CLI 读自己的配置。

```bash
COCKPIT_PORT=4780               # 端口(绑定地址恒为 127.0.0.1,不可改)
COCKPIT_HOT_MS=3000             # 战况刷新间隔;觉得卡就先调这个(3000 → 5000)
COCKPIT_WARM_MS=10000
COCKPIT_SWEEP_MS=60000
COCKPIT_COLD_MS=300000
COCKPIT_MAX_CONCURRENCY=4       # 别调大,实测收益递减还会抖
COCKPIT_DEV_ORIGIN_PORTS=       # 前端开发期额外放行的本机端口(Vite 填 5173);默认空 = 一个都不放

# 跳回 Multica 本体的链接模板。不配的话 deep_link 全是 null,界面不画跳转按钮。
COCKPIT_ISSUE_URL_TEMPLATE='https://<你的 Multica 地址>/{workspace}/issue/{identifier}'
COCKPIT_WORKSPACE_SLUG=mtmwork
```

## 目录

```
src/
├─ contract/types.ts   契约的唯一权威定义 —— 前端只认这个文件
├─ multica/            唯一的出网口:CLI 调用 + 原始字段类型
├─ aggregate/
│  ├─ normalize.ts     raw → 契约的归一
│  ├─ battle-state.ts  状态灯判定规则(纯函数)
│  ├─ roster.ts        主视图聚合(纯函数)
│  └─ detail.ts        详情/地图/回放/运行时聚合(MTM-278)
└─ server/
   ├─ config.ts        全部配置来自环境变量
   ├─ cache.ts         分层缓存 / 单飞 / 退避
   ├─ guard.ts         安全闸 + 入参校验
   ├─ poller.ts        分档轮询
   ├─ router.ts        HTTP 路由(安全闸 + 全部接口 + 写操作,MTM-278)
   ├─ static.ts        把 web/dist 端出去 —— 界面与接口同源同端口(MTM-279)
   ├─ health.ts        /api/health 响应组装
   └─ index.ts         HTTP 入口
scripts/
├─ start.ts            `npm start` 的入口:该构建就构建,然后起服务
└─ build-web.ts        按 mtime 判断界面要不要重新构建
docs/
├─ architecture.md     技术栈选型、模块边界、谁能碰谁
├─ data-contract.md    契约的人话版(为什么这么定)
├─ data-sources.md     每个字段对应哪条 multica 命令(全部实测)
├─ polling.md          轮询与限流策略 + 实测数字
└─ security.md         本地安全边界,逐条编号可 review
pixel/                 像素资产:立绘 + UI 皮肤(零依赖 ES 模块,自带 package.json 和 tests/)
web/                   前端五屏(React+Vite;BFF 端出来时默认真数据,跑法见 web/README.md)
e2e/                   五场景主流程冒烟(Playwright,自带 package.json;跑法见 e2e/README.md)
```

## 从哪儿开始读

- **要接着写后端** → `docs/architecture.md` 看边界,`src/contract/types.ts` 看契约,
  `docs/data-sources.md` 看每个字段从哪来(以及哪些坑已经踩过了)。
- **要写界面** → `docs/data-contract.md`,重点看「全局约定」和几个必须画出来的状态。
- **觉得刷新慢** → `docs/polling.md`,里面有全部实测数字和该调哪个旋钮。
- **审安全** → `docs/security.md`,规则都编了号,末尾有复核清单。
- **想确认主流程没坏** → `cd e2e && npm run smoke`,五个关键场景跑一遍就知道。
