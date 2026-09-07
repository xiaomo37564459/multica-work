# AetherLab 指挥舱

跑在自己机器上的智能体工作中心。13 个智能体像游戏角色一样列阵:谁在打怪、打哪只、打了多久、失败几次,
打开页面一眼看清;还能在页面里直接派活、对阵中的角色喊话。

当前是**地基阶段** —— 后端骨架 + 数据契约已就位,界面还没开始做。

## 装什么

只要 **Node.js ≥ 22.18**(推荐 24)和 **已登录的 `multica` CLI**。

```bash
node --version      # 应该 >= v22.18
multica version     # 应该能打印版本号
```

服务**没有任何运行时依赖**,不需要 `npm install`。

## 一条命令跑起来

```bash
npm start
```

看到这两行就是好了:

```
指挥舱已就绪 → http://127.0.0.1:4780/api/roster
自检 → http://127.0.0.1:4780/api/health
```

浏览器打开 `http://127.0.0.1:4780/api/roster`,应该看到全队 13 个人的实时状态。
实测冷启动 **1.2 秒**拿到完整名单,再过几秒战绩补齐。

想换端口:`COCKPIT_PORT=4791 npm start`。

> **服务只监听 127.0.0.1,而且没有改成对外监听的开关。**
> 它握着能指挥全队的凭据,理由和全部安全规则见 `docs/security.md`。

## 别的命令

```bash
npm test          # 单测(75 条),不需要 npm install
npm run typecheck # 类型检查,需要先 npm install(只装两个 devDependency)
```

> Node 只擦类型不检查类型 —— **`npm run typecheck` 不跑就等于没有契约约束**,验收和 CI 都要跑这条。

## 现在能用什么

| 接口 | 状态 |
|---|---|
| `GET /api/health` | ✅ 自检:绑定地址、CLI 可用性、各数据源新鲜度。**只有元数据,不含任何业务数据**(规则 D3) |
| `GET /api/roster` | ✅ 全员角色状态(真数据) |
| `GET /api/agents/:id` | 501 —— 契约已定,待实现 |
| `GET /api/projects` · `/api/projects/:id/map` | 501 —— 契约已定,待实现 |
| `GET /api/battles/:taskId/chain` | 501 —— 契约已定,待实现 |
| `GET /api/runtimes` | 501 —— 契约已定,待实现 |
| `POST /api/commands/dispatch` · `/shout` | 501 —— 契约 + 安全规则已定,待实现 |

501 的**不是待设计,是待实现**:字段、枚举、空值约定全部写死在 `src/contract/types.ts`,照着填即可。

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
├─ aggregate/          raw → 契约的归一 + 状态判定(纯函数,可单独测)
└─ server/             HTTP 入口 / 分档轮询 / 缓存 / 安全闸
docs/
├─ architecture.md     技术栈选型、模块边界、谁能碰谁
├─ data-contract.md    契约的人话版(为什么这么定)
├─ data-sources.md     每个字段对应哪条 multica 命令(全部实测)
├─ polling.md          轮询与限流策略 + 实测数字
└─ security.md         本地安全边界,逐条编号可 review
web/                   前端(还没开始)
```

## 从哪儿开始读

- **要接着写后端** → `docs/architecture.md` 看边界,`src/contract/types.ts` 看契约,
  `docs/data-sources.md` 看每个字段从哪来(以及哪些坑已经踩过了)。
- **要写界面** → `docs/data-contract.md`,重点看「全局约定」和几个必须画出来的状态。
- **觉得刷新慢** → `docs/polling.md`,里面有全部实测数字和该调哪个旋钮。
- **审安全** → `docs/security.md`,规则都编了号,末尾有复核清单。
