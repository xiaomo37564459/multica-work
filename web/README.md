# 前端(还没开始)

界面这一棒不在 MTM-275 范围内 —— 这里只留位置和方向。

## 已定的方向

- **React 19 + TypeScript + Vite**,理由见 `../docs/architecture.md`。
- **不上 UI 组件库** —— 像素风皮肤是自己写 CSS,组件库只会来打架。
- 轮询建议用 TanStack Query(自带 stale-while-revalidate / 去重 / 退避),但这是建议不是约束:
  契约是纯 HTTP + JSON,换任何数据层都不影响。
- 开发期 Vite 代理到 `http://127.0.0.1:4780`;构建产物放 `web/dist`,由 `npm start` 一起托管。

## 开工前先看

1. `../docs/data-contract.md` —— 契约的人话版。
2. `../src/contract/types.ts` —— 类型的权威定义,可以直接 import 复用。

## 四个不能漏的状态

1. **`meta.degraded` 非空** → 顶部黄条。这时数据还是好的(只是旧了),**不要清空界面**。
2. **`meta.stale === true`** → 标一句「数据可能过期」。
3. **`battles_loaded === false`** → 骨架屏 / 「战绩加载中」。
   **绝不能渲染成「0 胜 0 败」或「空闲」** —— 沈执有 344 场战绩,显示成 0 比不显示更糟。
4. **`state === 'unknown'`** → 灰色加载态,不是一个错误。

## 几个容易踩的点

- `avatar_url` 有三种形态:`emoji:🦋` / `data:image/svg+xml,...` / `https://...`,都要能渲染。
  (苏绘那一棒的像素立绘会覆盖掉它,但兜底逻辑还得在。)
- `current_battles` 是**数组**,一个角色可以同时打多场。
- 算「已耗时」用 `meta.server_time`,不要用浏览器本地时钟。
- `deep_link` 可能是 `null`(没配跳转模板),那时别画跳转按钮。
- 战役地图里 `unstaged` 不是边角料 —— 实测 254 条 issue 里 142 条不分关,得给它留位置。
- 所有枚举都可能是 `'unknown'`,别写穷举 switch 不给 default。

## 像素资产

风格、13 角色 4 态立绘、UI 皮肤由苏绘定(MTM-276)。
资产的命名和目录约定由那一棒写进这份 README。
