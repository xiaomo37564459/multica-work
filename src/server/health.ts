/**
 * /api/health 的响应组装 —— 纯函数,不碰 IO、不碰时钟。
 *
 * 为什么单独一个文件(而不是留在 index.ts 里):
 *   index.ts 一 import 就开始监听端口,单测碰不了。
 *   health 是**唯一一个直接面向缓存内部状态的接口**,也就是最容易把上游原始数据漏出去的地方,
 *   必须能被单测按住。test/health.test.ts 里那条「投毒探针」就是干这个的。
 *
 * 这里的每一行都在执行一条规矩:**契约边界只准逐字段显式挑,不准展开上游对象**
 * (docs/security.md 规则 D3)。改这个文件前先把 D3 读一遍。
 */

import type { Health, SourceName } from '../contract/types.ts';
import type { CacheHealth } from './cache.ts';

/**
 * last_error 是 health 里唯一的自由文本字段,内容来自 CLI 的 stderr。
 * source.ts 已经先截过一刀(400 字),这里再收紧到 200 字:
 * 它的用途是「让人看出哪条命令挂了」,不是数据通道。要看详情去看服务端日志。
 */
const LAST_ERROR_MAX = 200;

export interface HealthSourceInput {
  name: SourceName;
  health: CacheHealth;
}

export interface HealthInput {
  version: string;
  /** 服务实际绑定的地址,形如 127.0.0.1:4780。 */
  bind: string;
  /** multica CLI 的版本;拿不到传 null。 */
  cliVersion: string | null;
  deepLinkTemplate: string | null;
  sources: readonly HealthSourceInput[];
  now: string;
}

/**
 * 一个数据源的健康度。
 *
 * **逐字段列出来是刻意的,不要改成 `{ name, ...h }`。**
 * TypeScript 只对字面量做多余属性检查,变量传参会放宽 —— 形参声明得再窄,
 * 运行时展开也会把实参上多出来的字段(比如缓存里那份上游原始返回)一起拷进去,
 * 而 `tsc --noEmit` 一声不吭。这条口子实测漏过 1.27MB 和 3 个真实邮箱。
 */
function toSource(input: HealthSourceInput): Health['sources'][number] {
  const h = input.health;
  return {
    name: input.name,
    fetched_at: h.fetched_at,
    age_ms: h.age_ms,
    stale: h.stale,
    consecutive_failures: h.consecutive_failures,
    last_error: h.last_error == null ? null : h.last_error.slice(0, LAST_ERROR_MAX),
  };
}

export function buildHealth(input: HealthInput): Health {
  return {
    ok: true,
    version: input.version,
    bind: input.bind,
    cli: { available: input.cliVersion != null, version: input.cliVersion },
    workspace_id: null,
    deep_link_template: input.deepLinkTemplate,
    sources: input.sources.map(toSource),
    server_time: input.now,
  };
}

/**
 * health 响应的体积上限(字节)。
 *
 * 这不是性能考虑,是**安全断言**:契约形状撑死一两千字节,
 * 一旦超过这个数,唯一可能的原因就是有业务数据混进来了。
 * test/health.test.ts 拿它当红线;哪天真需要放宽,先回答「多出来的是什么」。
 */
export const HEALTH_MAX_BYTES = 5_120;
