# 像素资产与 UI 皮肤

AetherLab 指挥舱的全部视觉资产。**这里没有一张图片文件** —— 立绘是代码画出来的,
所以「13 个人是同一套画风」不靠画师自觉,靠下面几条硬约束。

## 一条命令看样张

```bash
node pixel/tools/serve.js
# → http://127.0.0.1:5178/styleguide/
```

零依赖,不用 `npm install`。只监听 `127.0.0.1`。
这个服务器只为看样张;正式页面跑在主干骨架里,不依赖它。

## 目录

```
pixel/
├─ tokens.css              颜色/间距/字号/动效 token,三套主题
├─ components.css          像素 UI 组件皮肤(按钮/卡片/状态灯/进度条/关卡节点/时间轴…)
├─ sprites/
│  ├─ index.js             ← 用的人只需要认识这一个文件
│  ├─ roster.js            13 个角色的名册,每人一条记录
│  ├─ palette.js           主控色板 + 配色推导
│  ├─ parts.js             部件库:头发头饰 / 服装 / 道具
│  ├─ body.js              共用身体 + 四态表情
│  ├─ grid.js              像素画布与绘图原语
│  └─ renderer.js          组装 + 姿势 + 状态覆盖 + 描边 + 图集
├─ styleguide/             一页样张(上面那条命令打开的就是它)
└─ tools/
   ├─ serve.js             静态服务器
   └─ export-png.js        导出 PNG(贴文档、发附件用)
```

## 命名约定

| 东西 | 规矩 | 例 |
|---|---|---|
| CSS 变量 | `--pc-<层>-<名>`,`pc` = pixel cockpit | `--pc-st-failed`、`--pc-unit-gu` |
| CSS 类 | `pc-<组件>`,修饰用 `--`,子元素用 `__` | `pc-unit`、`pc-unit--failed`、`pc-unit__band` |
| 角色 key | 姓氏拼音小写,短且不重 | `shen` `zhou` `gu` `mika` `help` |
| 状态 | 全代码库只用这四个词,不许另造 | `working` `idle` `stuck` `failed` |
| 部件函数 | 描述长相,不描述人名 | `hardhat`、`beret`、`dbstack` |

**状态四个词是全站契约**:聚合接口、CSS 类、立绘、日志都用同一套,不要在某一层
换成 `running`/`busy`/`error`。

## 怎么用

```html
<link rel="stylesheet" href="/pixel/tokens.css">
<link rel="stylesheet" href="/pixel/components.css">
<script type="module" src="/pixel/sprites/index.js"></script>

<body class="pc-root" data-theme="deep-space">
  <pixel-avatar agent="gu" state="working" scale="4"></pixel-avatar>
</body>
```

`agent` 填名册 key 或直接填 Multica 的 agent id,两种都认 ——
聚合接口给什么就填什么,业务代码里不用做映射。

原生 ES 模块 + 自定义元素,**没有构建步骤**,React / Vue / 原生都能直接用。
需要在 JS 里操作就 `import { ROSTER, applySprite, spriteCanvas } from '/pixel/sprites/index.js'`。

换皮肤只需改 `<html data-theme="...">`:`deep-space` / `dusk-forge` / `tactical-board`。

## 加一个新角色

只改 `sprites/roster.js` 一个文件,加一条记录:

```js
{
  key: 'xxx', name: '某某', title: '职业', agentId: '从 multica agent list 拿',
  unit: '#4f7fe0',          // 身份色。只给这一个,暗部亮部由 ramp() 推,不要手写
  head: 'slick',            // 从 parts.js 的 HEADS 里挑,或去加一个新的
  hair: HAIR.black,
  skin: SKIN.mid,
  outfit: 'coat',           // OUTFITS
  prop: 'setsquare',        // PROPS
  propColor: '#8fd8ea',     // 道具颜色,必须和衣服拉开,否则糊成一坨
  accent: '#e8762c',        // 领带/帽子这类小面积配色
  note: '一句话说清他长什么样',
},
```

四个状态、图集位置、头像片、失败态摔道具**全部自动生成**,不用再画。
最后把 `unit` 同步到 `tokens.css` 的 `--pc-unit-<key>`(卡片顶条要用同一个颜色)。

新头饰/道具就去 `parts.js` 加一个函数,签名照抄旁边的。
道具以「右手中心」`(hx, hy)` 为锚点往上画,姿势变化会自动带着它走。

## 为什么 13 个人看起来是一套的

这不是运气,是四条机制卡住的:

1. **只有一个描边色**。所有角色画完统一走一次 `Grid.outline(INK)`,线条粗细和包裹方式不可能因人而异。
2. **暗部亮部不许手写**。名册里每人只给一个基色,`ramp()` 统一推导 —— 所有暗部往同一个冷紫偏,所有亮部往同一个暖奶白偏。**统一的光源色温**是不同色相看起来同处一个世界的根本原因。
3. **身体是同一个函数画的**。`body.js` 一份骨架,差异只允许来自头饰/服装/道具三个位置。
4. **下半身全员同色**。裤子鞋子统一 `PANTS`/`SHOE`,身份色只在上半身出现,注意力不会被扯散。

想改画风,改 `palette.js` 里的 `SHADOW_HUE` / `LIGHT_HUE` 就够了,13 个人一起变。

## 为什么四个状态不用看字也分得清

不是只换颜色 —— 色觉障碍的人、或者截图被压成灰度,只靠颜色就废了。四态在**姿势、
标记、形状**三个维度同时拉开:

| 状态 | 姿势 | 头顶标记 | 状态灯形状 |
|---|---|---|---|
| `working` 干活 | 前倾,道具高举,两帧一上一下 | 落点炸出火花 | 实心■ + 中心亮点,脉动 |
| `idle` 空闲 | 站直,只有呼吸起伏 | **什么都没有** | 空心□ |
| `stuck` 卡住 | 头歪,道具垂下,全身褪色 | 大问号气泡 + 汗滴 | 三角▲,慢闪 |
| `failed` 失败 | 上半身塌坐,道具摔在地上 | 头顶裂痕 + ✕ 眼 | 实心 + ✕ |

「空闲什么标记都没有」是故意的:三个状态有标记、一个没有,扫一屏时眼睛先被有标记的抓走。

## 字体

不外挂 webfont。这是本机离线工具,不该为了字形去连 CDN;像素观感由立绘、描边和
网格承担,文字只要求点阵感 + 中文不糊。

想要全像素中文字形,本机装一个像素字体(Zpix / Fusion Pixel / Ark Pixel),
`tokens.css` 的 `--pc-font` 里已经把它们排在最前面,装上自动生效。要打包进项目就加一段
`@font-face` 指到本地文件 —— **布局不依赖它**,不装也不会错位。

## 导出 PNG

```bash
node pixel/tools/export-png.js --scale 6 --bg "#171d2e"
```

写到 `pixel/dist/`(已 gitignore):一张总图集 + 每个角色一张四态条。
网页本身不需要它 —— 页面运行时直接生成图集,不依赖任何构建产物。

## 边界

- 桌面浏览器优先,不做手机端适配。
- 二期的等级/经验/成就/战报视觉不在这里。
- 这一层只管长什么样。数据怎么来、状态怎么判,是聚合服务那一棒的事;
  本层只认 `working|idle|stuck|failed` 四个字符串。
