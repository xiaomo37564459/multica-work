/**
 * 时间与数字 → 人话。
 * 契约硬规定:一切「已耗时 / 多久前」以 meta.server_time 为「现在」,
 * 所以本模块没有任何函数偷看 Date.now() —— 「现在」永远由调用方传进来。
 */
import type { Battle } from '@contract';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** 毫秒时长 → 「47 分」「1 时 12 分」。null(契约:从未开打)显示占位。 */
export function fmtDuration(ms: number | null): string {
  if (ms == null) return '—';
  const v = Math.max(0, ms);
  if (v >= DAY) return `${Math.floor(v / DAY)} 天 ${Math.floor((v % DAY) / HOUR)} 时`;
  if (v >= HOUR) return `${Math.floor(v / HOUR)} 时 ${Math.floor((v % HOUR) / MIN)} 分`;
  if (v >= MIN) return `${Math.floor(v / MIN)} 分`;
  return `${Math.floor(v / 1000)} 秒`;
}

/**
 * 一场战斗的已耗时。
 * 后端算好的 elapsed_ms 优先;running 且后端没给时用 server_time 现算;
 * started_at 为 null(排队超时/被取消)时返回 null —— 显示占位,不是 0。
 */
export function elapsedOf(b: Battle, serverTime: string): number | null {
  if (b.elapsed_ms != null) return b.elapsed_ms;
  if (b.started_at == null) return null;
  const end = b.completed_at ?? serverTime;
  return Math.max(0, Date.parse(end) - Date.parse(b.started_at));
}

/** 多久之前(相对 server_time)。 */
export function fmtAgo(at: string | null, serverTime: string): string {
  if (at == null) return '—';
  const d = Date.parse(serverTime) - Date.parse(at);
  if (d < MIN) return '刚刚';
  return `${fmtDuration(d)}前`;
}

/** 时间戳 → 本地钟点 HH:mm(只用于展示,不参与任何时长计算)。 */
export function fmtClock(at: string | null): string {
  if (at == null) return '—';
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 胜率。契约:分母为 0 时是 null,显示占位而不是 0%。 */
export function fmtPercent(ratio: number | null): string {
  if (ratio == null) return '—';
  return `${Math.round(ratio * 100)}%`;
}

/** token 数 → 万为单位的缩写。 */
export function fmtTokens(n: number): string {
  if (n >= 10_000) return `${(Math.round(n / 1000) / 10).toLocaleString('zh-CN')} 万`;
  return n.toLocaleString('zh-CN');
}
