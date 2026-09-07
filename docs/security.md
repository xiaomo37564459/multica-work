# 本地安全边界

## 为什么这份文档存在

指挥舱跑在 heory 本机上,用的是 **workspace owner 的凭据**。
它能派活、能发评论 —— 也就是说,**谁碰得到这个服务,谁就能用 heory 的身份指挥全队。**

这不是「本地工具随便点」的场景。这是一个把最高权限暴露成 HTTP 接口的服务。
下面每条规则都编了号,可以逐条 review、逐条测。**规则挂了 = 事故,不是瑕疵。**

## 网络面(N 系列)

### N1 · 只监听 127.0.0.1,不提供改成 0.0.0.0 的开关

```ts
// src/server/index.ts
server.listen(cfg.port, cfg.host);  // cfg.host 恒为 '127.0.0.1'
```

`cfg.host` 在 `src/server/config.ts` 里是**硬编码常量**,没有对应的环境变量。
端口可以改(`COCKPIT_PORT`),绑定地址不行。

**为什么不给开关**:给了就一定有人在某次「临时从手机上看一眼」的时候打开它,然后忘了关。
真需要远程访问,应该走 SSH 端口转发,而不是让这个服务自己监听公网。

### N2 · 校验 Host 头,挡 DNS rebinding

只接受这五个值,别的一律 403:
`127.0.0.1:<port>` / `localhost:<port>` / `[::1]:<port>`,以及**不带端口**的 `127.0.0.1` / `localhost`。

后两个为什么也放行:HTTP/1.1 允许省略默认端口,某些客户端就是这么发的。
放行它们不构成漏洞 —— 关键性质是**这五个值里没有一个是域名**,
`evil.com` 无论怎么解析到本机,它的 Host 头都伪造不成这几个字面量。
带端口的写法要求端口对得上,不带端口的写法本身就已经把域名挡在外面了。

**挡的是什么**:攻击者把 `evil.com` 的 DNS 解析到 `127.0.0.1`,
heory 浏览器里打开 `evil.com` 的页面,页面里的 JS 就能同源访问本机服务。
浏览器发出的请求里 `Host: evil.com` —— 校验 Host 就能识破。

实现 `isAllowedHost()`,测试 `test/guard.test.ts`。

### N3 · 不发任何 CORS 头,并校验 Origin

- 服务**从不**输出 `Access-Control-Allow-Origin`。
- 请求带了 `Origin` 且不是本机 → 403。不带 `Origin`(同源导航)→ 放行。

**挡的是什么**:heory 浏览器里随便开着的某个网页,用 JS 打 `http://127.0.0.1:4780/api/commands/dispatch`。
没有 CORS 头,浏览器读不到响应;校了 Origin,请求根本进不来。

**开发端口默认不放行。** 前端开发期 Vite 跑在另一个端口,需要时设
`COCKPIT_DEV_ORIGIN_PORTS=5173`,不设就一个额外来源都没有。

这里有个刻意的设计:这个配置项**只收端口号,不收整条 Origin**。
放行的永远是 `http://127.0.0.1:<port>` 和 `http://localhost:<port>` 两个字面量,
所以它被误配、被复制到别处、甚至被人当成「加个白名单」来用,也**变不出一个外部域名**。
一个只能开本机的开关,和一个能开任意来源的开关,风险差着数量级。
(第一版把 5173 硬编码在允许列表里,等于默认长期开着这个口子。)

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
| N1 | `npm start` 后看日志里的绑定地址;从另一台机器访问 `http://<本机IP>:4780` 应该连不上 |
| N2 | `curl -H "Host: evil.com" http://127.0.0.1:4780/api/roster` → 403 |
| N3 | `curl -H "Origin: https://evil.com" http://127.0.0.1:4780/api/roster` → 403;正常响应里没有 `Access-Control-Allow-Origin` |
| N3(开发端口) | 不设环境变量时 `curl -H "Origin: http://localhost:5173" ...` → **403** |
| W1 | `grep -rn "issue status\|issue update\|issue assign\|agent create" src/` → 应该一条都搜不到 |
| W2/W3/W4/W5 | `npm test`,看 `test/guard.test.ts` 全绿 |
| C1 | `grep -rn "config.json\|MULTICA_TOKEN\|Authorization\|Bearer" src/` → 应该一条都搜不到 |
| C2 | `git ls-files \| grep -E "\.env\|\.pem\|\.key"` → 空 |
| D1 | `test/normalize.test.ts` 里「Actor 不带 email」那条 |
| D3 | `curl -s http://127.0.0.1:4780/api/health \| wc -c` → 应在 1~2KB 量级;`test/health.test.ts` 全绿(含投毒探针和体积红线) |

## 待办(不在本棒范围,但得有人记着)

1. ~~前端上线后从 N3 的允许列表里删掉 `:5173`。~~ **已处理**:改成默认不放行 +
   `COCKPIT_DEV_ORIGIN_PORTS` 按需开,不再依赖「记得删」。
2. 写操作接口目前是 501 未实现。韩程那一棒接上真实现时,**W1~W5 必须同时生效**,
   不能先接通再补安全。`test/guard.test.ts` 已经把规则测好了,直接接上即可。
