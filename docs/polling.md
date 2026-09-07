# 轮询与限流策略

> 全部数字都是 2026-09-04 在 heory 本机(DESKTOP-0L0T1UR,Windows 11)实测的,不是估的。
> 复测方法见文末。

## 一句话结论

**界面 3 秒刷新达标,但「每轮全量拉取」做不到 —— 实测最快 5.0 秒,而且只会越来越慢。**
所以改成分四档:heory 盯着看的那部分 3 秒一刷,全量兜底 5 分钟一轮。

## 先说最要命的那个数

`multica agent tasks <id>` **没有分页参数,一次返回该智能体的全部历史**。

| 智能体 | 历史条数 | 返回体积 | 单次耗时(中位数) |
|---|---:|---:|---:|
| 沈执｜总指挥 | 356 | 1.28 MB | 1945 ms |
| 顾检｜质量官 | 294 | 1.03 MB | 2096 ms |
| 梁运｜运维 | 151 | 461 KB | 495 ms |
| 周构｜架构师 | 11 | 22 KB | 298 ms |
| **13 人合计** | **1191** | **3.9 MB** | — |

这条曲线只会往上走 —— 沈执每天要接十几棒。**任何「每轮给 13 个人都拉一次 tasks」的方案,今天就已经要 3.8~4.4 秒,三个月后会更难看。**
这是整套轮询设计绕开的核心障碍。

## 单条命令的实测基线

5 次采样,同一台机器。

| 命令 | 中位数 | 最快 | 最慢 | 返回体积 |
|---|---:|---:|---:|---:|
| `agent list` | 384 ms | 317 | 479 | 92.6 KB |
| `agent tasks <id>`(11 条历史) | 301 ms | 272 | 336 | 22.7 KB |
| `issue list --limit 100` | 765 ms | 437 | 2367 | 460 KB |
| `issue list --status in_progress` | 348 ms | — | — | 47 KB |
| `issue list --status blocked` | 257 ms | — | — | 6.3 KB |
| `issue children <id>` | 296 ms | 282 | 302 | 23 KB |
| `issue get <id>` | 300 ms | 294 | 346 | 5.0 KB |
| `project list` | 291 ms | 289 | 297 | 3.3 KB |
| `squad list` | 306 ms | 292 | 366 | 4.4 KB |
| `runtime list` | 312 ms | 281 | 469 | 3.0 KB |
| `runtime usage --days 7` | 269 ms | 244 | 570 | 2.2 KB |
| `runtime activity` | 277 ms | 244 | 323 | 1.0 KB |
| `multica version`(不出网) | **57 ms** | 57 | 64 | — |

**拆解:57 ms 是进程启动,剩下约 200 ms 是网络往返。**
服务端在 `multica.copliot.cloud`,不是本机 —— 所以「换成直接打 HTTP API」最多省掉那 57 ms,
省不掉大头。这也是为什么一期直接用 CLI:省下来的那点时间不值得多开一个凭据处理面。

## 全量拉一轮到底要多久(实测)

一轮「全量」= 26 次调用:`agent list` ×1 + `agent tasks` ×13 + `issue list` ×3 页 +
`project/squad/runtime list` ×3 + `runtime usage/activity` ×3 个 runtime ×2。总计 5.2 MB。

| 并发上限 | 三次运行 | 中位数 |
|---:|---|---:|
| 1 | 14933 / 16398 / 17155 ms | 16398 ms |
| 2 | 9146 / 9373 / 9705 ms | 9373 ms |
| 4 | 6201 / 6444 / 6538 ms | 6444 ms |
| 6 | 5706 / 7180 / 7807 ms | 7180 ms |
| 8 | 5431 / 5765 / 6608 ms | 5765 ms |
| 12 | 4735 / 5034 / 5723 ms | **5034 ms** |
| 16 | 5605 / 5672 / **9205** ms | 5672 ms |

**读法:并发从 4 提到 12 只快了 22%,再往上开始抖(16 并发跑出过 9.2 秒)。**
所以并发上限定 **4** —— 收益递减,而且这台机器上还有真在干活的智能体要抢资源,把 CLI 打爆得不偿失。

## 分四档

| 档 | 间隔 | 拉什么 | 实测成本 |
|---|---:|---|---|
| **热** | 3 s | `issue list --status in_progress` + `--status blocked` | 2 次调用,**465 ms / 52 KB** |
| **温** | 10 s | 只给「活跃集」拉 `agent tasks` | 活跃集通常 1~4 人 |
| **巡** | 60 s | 给 2 个不活跃的智能体补历史,轮流覆盖 | ~6.5 分钟走完 13 人 |
| **冷** | 300 s | `agent list` / `project` / `squad` / `runtime list` / `usage` / `activity` / 全量 `issue list` 3 页 | 那 26 次调用的大头都在这 |
| **按需** | 不轮询 | `issue children`(开战役地图)、`issue get`、`issue comment list` | 结果缓存 30 s |

**活跃集怎么挑**(`pickActiveAgents`):名下有 `in_progress` / `blocked` issue 的人,
∪ 上一轮状态是 `fighting` / `stalled` / `defeated` 的人。其余人交给巡档。

**为什么热档只拉这两个状态**:`todo` / `in_review` 不代表「正在打」,实测各 0 条、85 字节,
放进热档纯属浪费一次往返;全量冷档兜得住它们。

## 浏览器那一侧

**浏览器每 3 秒问一次 BFF,BFF 只读内存缓存,不触发任何 CLI 调用。**
这条边界是「3 秒刷新」能成立的全部原因 —— 没有它,前端的刷新频率会直接变成打 CLI 的频率。

实测(每 3 秒打一次 `/api/roster`,连打 10~20 轮):

- 响应耗时 **p50 41~48 ms,p95 59~97 ms**
- 数据年龄 **p50 1.2 秒,最坏 4.2 秒**(= 热档间隔 3 秒 + 一次拉取耗时,符合父任务「3~5 秒」的定档)
- 全程 `degraded` 为空

前端别自己算新鲜度,直接读 `meta.age_ms` / `meta.stale`。

## 冷启动(实测)

| 里程碑 | 耗时 |
|---|---:|
| 服务可应答、`/api/roster` 返回完整 13 人名单 | **1183 ms** |
| 全员战绩(`battles_loaded` 全部为 true) | 6191 ms |

启动路径上**只拉主视图必需的三样**(`agent list` / `runtime list` / 热档 issue)。
全量 issue、用量、活跃直方图、全员 `agent tasks` 都挪到 listen 之后异步补 ——
一起放进启动路径实测要 8149 ms,过不了「首屏 ≤3 秒」那条线。

补齐之前,那些角色的 `battles_loaded` 是 `false`、`state` 是 `unknown`。
**界面要画加载态,不许显示成「0 胜 0 败」或「空闲」** —— 那是在骗人。

## 缓存 / 退避 / 单飞

实现在 `src/server/cache.ts`,单测在 `test/cache.test.ts`。

1. **拉取失败绝不清空缓存。** 宁可显示 30 秒前的旧数据 + 顶部一条黄条,也不能白屏。
   `refresh()` 失败时返回旧值且不抛出。
2. **单飞(single-flight)。** 同一个 key 同一时刻只允许一个在飞的请求,后到的复用同一个 Promise。
3. **退避。** 连续失败:间隔 ×2,基数 2 秒,封顶 60 秒;成功立刻复位。
   退避期内 `canRefresh()` 返回 false,定时器空转不发请求。
4. **分片独立。** `agent tasks` 每个人一格缓存,一个人拉挂了不拖累其他人。
5. **降级可见。** 任何源连续失败 > 0 次,它的名字进 `meta.degraded`,前端据此挂黄条。
6. **单条命令超时 15 秒。** 实测最慢单次 2.4 秒,留 6 倍余量;超时算该源本轮失败。

## 可调的旋钮

全部走环境变量,默认值即上表(见 `src/server/config.ts`):

```
COCKPIT_HOT_MS=3000        热档间隔
COCKPIT_WARM_MS=10000      温档间隔
COCKPIT_SWEEP_MS=60000     巡档间隔
COCKPIT_COLD_MS=300000     冷档间隔
COCKPIT_SWEEP_BATCH=2      巡档一次带几个人
COCKPIT_MAX_CONCURRENCY=4  全局并发上限
COCKPIT_CLI_TIMEOUT_MS=15000
```

**如果哪天觉得卡**:第一个该调大的是 `COCKPIT_HOT_MS`(3000 → 5000),
父任务给的窗口就是 3~5 秒。不要去调大并发 —— 实测那条路收益递减还会抖。

## 怎么复测

基准脚本是一次性的,没进仓库(过程文件不进仓库,见 git-workflow)。要复现照下面做:

```bash
# 单条命令基线:对每条命令跑 5 次取中位数
multica agent tasks <agent-id> --output json

# 全量一轮:把 26 次调用按并发上限跑,计时
# 端到端:起服务后每 3 秒打一次 /api/roster,记响应耗时和 meta.age_ms
npm start
curl http://127.0.0.1:4780/api/health
```

数据量变了(比如某人历史突破 500 条),该重跑一次并更新本文的表。
