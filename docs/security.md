# 本地安全边界

## 为什么这份文档存在

指挥舱跑在 heory 本机上,用的是 **workspace owner 的凭据**。
它能派活、能发评论 —— 也就是说,**谁碰得到这个服务,谁就能用 heory 的身份指挥全队。**

这不是「本地工具随便点」的场景。这是一个把最高权限暴露成 HTTP 接口的服务。
下面每条规则都编了号,可以逐条 review、逐条测。**规则挂了 = 事故,不是瑕疵。**

## 网络面(N 系列)

> **边界变更记录**:2026-09-11,heory 在 [MTM-274](../../../issues/MTM-274) 评论区拍板 **C 案** ——
> 指挥舱对**内网**开放,任何内网设备都能打开页面查看,也能执行派活/喊话。
> N1/N2/N3 已同步改写。**「绝不暴露公网」这条红线不变**:不许做路由器端口转发、公网映射、
> 或者把服务挂到任何公网可达的地址上 —— 那等于让公网任何人用 heory 的身份指挥全队花真钱。

### N1 · 监听内网(0.0.0.0),想收回本机随时能收

```ts
// src/server/index.ts
server.listen(cfg.port, cfg.host);  // cfg.host 默认 0.0.0.0,可用 COCKPIT_HOST 覆盖
```

`cfg.host` 默认 **0.0.0.0**(监听全部网卡,内网设备可访问),这是 C 案的落地。
想收回「只有本机能开」,启动前设 `COCKPIT_HOST=127.0.0.1`,一行环境变量的事。
端口仍走 `COCKPIT_PORT`。

**监听面到此为止**:0.0.0.0 已经是物理上能听的最大范围,代码里不存在、也不需要
「允许公网」的开关。再往外暴露只剩路由器端口转发/公网映射一条路 —— 那是红线(见上),
不是配置项。Windows 防火墙放行见 README「内网访问」一节。

### N2 · 校验 Host 头,挡 DNS rebinding

只接受**内网/回环 IP 字面量**(RFC1918:10/8、172.16/12、192.168/16,加上
`127.0.0.1` / `localhost` / `[::1]`),带端口的写法必须端口对上,不带端口的写法也认。
其余一律 403 —— 包括:

- **公网 IP**(如 `8.8.8.8`):内网开放不等于公网开放。
- **任何域名**(如 `evil.com`,甚至内网机器名):判据是字面 IP,不认解析结果。

**关键性质**:允许列表里没有一个域名,`evil.com` 无论怎么解析到本机或内网,
它的 Host 头都伪造不成内网 IP 字面量 —— DNS rebinding 在这条闸前依然失效。

实现 `isAllowedHost()` / `isLanHost()`,测试 `test/guard.test.ts`。

### N3 · 不发任何 CORS 头,并校验 Origin

- 服务**从不**输出 `Access-Control-Allow-Origin`。
- 请求带了 `Origin` 且不是本机/内网 → 403。不带 `Origin`(同源导航)→ 放行。
- **本机来源**:只认 `http://127.0.0.1:<port>` / `http://localhost:<port>` / `http://[::1]:<port>`,端口必须在白名单里。
- **内网来源**(C 案):认 `http://<内网IP>:<端口>` —— 内网设备浏览器里打开的指挥舱地址长这样。

**挡的是什么**:任何人的浏览器里随便开着的某个网页,用 JS 打指挥舱接口。
没有 CORS 头,浏览器读不到响应;校了 Origin,请求根本进不来。

**开发端口默认不放行。** 前端开发期 Vite 跑在另一个端口,需要时设
`COCKPIT_DEV_ORIGIN_PORTS=5173`,不设就一个额外本机来源都没有。这里有个刻意的设计:
这个配置项**只收端口号、不收整条 Origin**,所以它被误配也**变不出一个外部域名**。

### N4 · 响应头

`Cache-Control: no-store`(别把队伍状态留在磁盘缓存里)、`X-Content-Type-Options: nosniff`、
`Referrer-Policy: no-referrer`。

## 写操作面(W 系列)

### W1 · 写操作白名单只有两条,硬编码

```ts
// src/server/guard.ts
export const WRITE_ALLOWLIST = Object.freeze({
  dispatch: 'issue create',
  shout:    'issue comment add',
});
```

**这个服务对 Multica 的写权限只有这两条,其余一律拒绝。**
明确不做的:改状态、改优先级、改负责人、建/改智能体、删任何东西、跑 autopilot、动 runtime。
低频操作一律跳回 Multica 本体(父任务定的边界)。

技术上怎么保证:
- `MulticaWriteSource` 接口只有 `createIssue` / `addComment` 两个方法,别的路径没有出口。
- 常量 `Object.freeze` 过,运行期加不进去(有单测)。
- 想加第三条 → 改这个常量 + 过一次架构评审。**这条是硬底线。**

### W2 · 写操作限流

每分钟 20 次滑动窗口。派活和喊话都是人手点出来的,20 次绰绰有余;
这条挡的是前端写出死循环、或者某个自动化脚本失控。

### W3 · 入参校验在拼命令之前

- 所有 UUID 必须过正则,不合法直接 400 —— 挡住把名字、路径、`../` 之类的东西透传给 CLI。
- `title` 不能以 `-` 开头(否则会被 CLI 当成 flag),长度 ≤ 200。
- `description` ≤ 20000 字,`content` ≤ 10000 字。
- `priority` 只认已知取值,`stage` 必须是 ≥1 的整数。

### W4 · 绝不拼命令字符串

```ts
execFile('multica', argv, { shell: false, ... })
```

**永远是 `execFile` + argv 数组,`shell: false`。** 不用 `exec`、不用模板字符串拼命令。
外加 `assertSafeArg()`:任何要进 argv 的值,不允许以 `-` 开头、不允许含控制字符。

`-` 开头这条是重点:如果放过去,调用方就能追加任意 CLI 参数
(比如 `--allow-external-file` 去读工作目录外的文件)。这是本服务最直接的一条提权路径。

### W5 · 长文本走文件,不走命令行

派活的正文、喊话的内容都写成临时 UTF-8 文件再用 `--description-file` / `--content-file` 传。
两个原因:一是 Windows 下管道会把非 ASCII 变成 `?`;二是命令行长度有限,长正文会被截断。

临时文件写在**服务自己的工作目录**里,不写 `/tmp`、不写共享路径,用完即删。
不传 `--allow-external-file`。

## 凭据面(C 系列)

### C1 · 服务从不接触凭据

**这是最重要的一条,而且是靠结构保证的,不是靠纪律。**

指挥舱通过 `execFile` 出去调 `multica`,由 CLI 自己读它自己的配置文件拿 token。
**token 从头到尾不进这个进程的内存** —— 也就不可能:进日志、进 core dump、进错误堆栈、
被某个 `JSON.stringify(config)` 顺手带出去、或者被提交进仓库。

服务里没有任何一行代码读 `~/.multica/config.json`、读 `MULTICA_*` 环境变量、或者拼 Authorization 头。

**改动警告**:如果哪天为了性能改成直接打 HTTP API(见 `polling.md`,能省 57 ms),
这条保护就没了 —— 那时必须重新做一遍凭据处理的设计评审。
`MulticaSource` 接口留了这个换实现的口子,但换之前先来找周构。

### C2 · 仓库里不许有凭据

这个仓库是 **PUBLIC** 的。`.gitignore` 里挡了 `.env*` / `*.pem` / `*.key` / `config.local.json` / `secrets/`。
所有配置走环境变量,没有配置文件模板里带真值。

### C3 · 日志不带内容

CLI 调用的调试钩子 `onCall` 只记 argv、耗时、成败,**从不记 stdout**
—— 返回体里有 issue 正文和智能体的交付内容。
错误信息里的 stderr 截断到 400 字符再往上抛。

## 数据面(D 系列)

### D1 · 契约里不传 PII

`agent tasks` 的 `attribution.initiator` / `originator` 原始返回带 `email`。
归一层**主动丢掉** —— 指挥舱不需要邮箱,传出去只是白白多一个泄露面。有单测。

### D2 · 未知枚举降级,不抛异常

平台以后加了新状态,指挥舱应该显示一个灰色的「未知」,而不是白屏或者 500。
所有枚举归一都走 `oneOf(..., 'unknown')`。

### D3 · 契约边界只准逐字段显式挑,不准展开上游对象

**规则**:凡是往契约结构里塞值的地方,一律写成 `{ a: src.a, b: src.b }`,
**禁止** `{ ...src }` / `{ name, ...src }`,哪怕形参类型看起来已经窄成了正确的形状。

**防的是什么**:TypeScript 的多余属性检查**只对字面量生效**,变量传参会放宽。
形参声明成只有 5 个字段、实参传进来一个有 6 个字段的对象 —— 类型检查一声不吭地过,
运行时 `...` 却会把第 6 个字段一起拷进响应里。`tsc --noEmit` 查不出来,单测不写也查不出来。

**这不是假想**:第一版 `/api/health` 就是这么把缓存里的 `value` 展开出去的,
一个自检接口交出了 **1.27MB** 上游原始返回、全 workspace 的 issue 正文和 **3 个真实邮箱**,
直接把 D1 绕过去了 —— 而归一层的 D1 单测全绿,因为压根没走归一层。

**配套的两条**:
1. 拿不到就漏不了。`CacheCell` 提供 `health()`,返回的对象里**根本没有 value**,
   `/api/health` 只准用它。让安全的那条路同时是最好走的那条,比靠人小心可靠。
2. 每个对外接口配一条**投毒探针**单测:往上游数据里塞一个一眼能认出来的字符串
   (邮箱、超长正文),断言序列化后的响应里找不到它。样板见 `test/health.test.ts`。
   再配一条体积红线 —— 自检类接口撑死一两千字节,超了必然是混进了业务数据。

**适用范围**:后面几棒新增的每一个接口。`/api/health` 的教训是,
**最不像会泄露数据的那个接口,反而是唯一直连缓存内部状态的那个。**

## 复核清单(顾检验收时逐条走)

| 编号 | 怎么验 |
|---|---|
| N1 | `npm start` 后看日志里的绑定地址(`0.0.0.0:4780`);内网另一台设备打开 `http://<本机内网IP>:4780` **应该能打开**(C 案);设 `COCKPIT_HOST=127.0.0.1` 再起,内网设备应该连不上(收回本机) |
| N2 | `curl -H "Host: evil.com" http://127.0.0.1:4780/api/roster` → 403;`curl -H "Host: 8.8.8.8:4780" ...` → **403(公网 IP 也拒)**;`curl -H "Host: 192.168.1.9:4780" ...` → 200(内网放行) |
| N3 | `curl -H "Origin: https://evil.com" http://127.0.0.1:4780/api/roster` → 403;正常响应里没有 `Access-Control-Allow-Origin` |
| N3(开发端口) | 不设环境变量时 `curl -H "Origin: http://localhost:5173" ...` → **403** |
| N3(内网) | `curl -H "Origin: http://192.168.1.9:4780" http://127.0.0.1:4780/api/roster` → 200(C 案放行) |
| W1 | `grep -rn "issue status\|issue update\|issue assign\|agent create" src/` → 应该一条都搜不到 |
| W2/W3/W4/W5 | `npm test`,看 `test/guard.test.ts` 全绿(含「公网 Host/Origin 仍 403」「内网放行」「写操作内网可用且保留校验限流」) |
| C1 | `grep -rn "config.json\|MULTICA_TOKEN\|Authorization\|Bearer" src/` → 应该一条都搜不到 |
| C2 | `git ls-files \| grep -E "\.env\|\.pem\|\.key"` → 空 |
| D1 | `test/normalize.test.ts` 里「Actor 不带 email」那条 |
| D3 | `curl -s http://127.0.0.1:4780/api/health \| wc -c` → 应在 1~2KB 量级;`test/health.test.ts` 全绿(含投毒探针和体积红线) |

## 待办(不在本棒范围,但得有人记着)

1. ~~前端上线后从 N3 的允许列表里删掉 `:5173`。~~ **已处理**:改成默认不放行 +
   `COCKPIT_DEV_ORIGIN_PORTS` 按需开,不再依赖「记得删」。
2. ~~写操作接口目前是 501 未实现。~~ **已处理**(MTM-278):真实现落地时 W1~W5 同时生效,
   `test/guard.test.ts` 与 `test/router.test.ts` 按住了全部规则。
