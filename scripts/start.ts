/**
 * `npm start` 的入口 —— 指挥舱唯一需要记住的那一条命令。
 *
 * 干两件事,顺序固定:
 *   1. 界面该构建就构建(scripts/build-web.ts,常态是几毫秒的跳过)
 *   2. 起服务(src/server/index.ts,它自己把 web/dist 端出去)
 *
 * 只要接口不要界面(比如脚本里 curl)用 `npm run start:api`,那条完全零构建、零依赖。
 */

import { ensureWebBuild } from './build-web.ts';

ensureWebBuild();
await import('../src/server/index.ts');
