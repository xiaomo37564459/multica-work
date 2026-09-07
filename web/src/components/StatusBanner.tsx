/**
 * 数据新鲜度横幅 —— 前端 README 点名的四个必画状态里的两个:
 *   meta.degraded 非空 → 黄条:数据还是好的(只是旧了),绝不清屏
 *   meta.stale → 「数据可能过期」
 * 外加:拉取失败但手上还有旧数据 → 红字说明,同样不清屏。
 */
import type { ApiError, ApiMeta } from '@contract';
import { fmtAgo } from '../lib/format.ts';

export function StatusBanner(props: { meta: ApiMeta | null; error: ApiError | null }) {
  const { meta, error } = props;
  const banners: Array<{ kind: 'warn' | 'bad'; text: string }> = [];
  if (error) {
    banners.push({ kind: 'bad', text: `刷新失败(${error.message})—— 显示的是上一份数据` });
  }
  if (meta && meta.degraded.length > 0) {
    banners.push({ kind: 'warn', text: `部分数据源拉取失败:${meta.degraded.join('、')} —— 数据没丢,只是旧了` });
  }
  if (meta?.stale) {
    banners.push({ kind: 'warn', text: `数据可能过期(拉取于 ${fmtAgo(meta.fetched_at, meta.server_time)})` });
  }
  if (banners.length === 0) return null;
  return (
    <div className="app-banners" role="status">
      {banners.map((b) => (
        <div key={b.text} className={`app-banner app-banner--${b.kind}`}>{b.kind === 'warn' ? '▲' : '✕'} {b.text}</div>
      ))}
    </div>
  );
}
