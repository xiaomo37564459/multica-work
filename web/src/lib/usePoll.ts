/**
 * 轮询钩子 —— 指挥舱的「准实时」全靠它(平台没有推送通道,父任务已定轮询)。
 *
 * 三条纪律(都来自契约/前端 README 的硬要求):
 *   1. 拉失败**不清屏**:上一份好数据留着继续显示,错误单独暴露 —— 顶部黄条负责说明。
 *   2. 页面被切到后台就停手(document.hidden),回来立刻补一拍 —— 不空转打接口。
 *   3. 竞态兜底:回来的响应如果已经不是当前这轮的,丢弃。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiEnvelope, ApiError, ApiMeta } from '@contract';

export interface PollState<T> {
  /** 最近一次成功的数据;失败时保留上一份好数据 */
  data: T | null;
  /** 与 data 配套的 meta(新鲜度、server_time) */
  meta: ApiMeta | null;
  /** 最近一次请求的错误(有 data 时表示「数据是旧的」) */
  error: ApiError | null;
  /** 第一份数据还没到 */
  loading: boolean;
  refresh: () => void;
}

export function usePoll<T>(fetcher: () => Promise<ApiEnvelope<T>>, intervalMs: number, key: string): PollState<T> {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [state, setState] = useState<{ data: T | null; meta: ApiMeta | null; error: ApiError | null; loading: boolean }>(
    { data: null, meta: null, error: null, loading: true },
  );
  const [bump, setBump] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    let generation = 0;
    setState({ data: null, meta: null, error: null, loading: true });

    const tick = async () => {
      const gen = ++generation;
      const env = await fetcherRef.current();
      if (!alive || gen !== generation) return;
      setState((prev) => env.ok
        ? { data: env.data, meta: env.meta, error: null, loading: false }
        : { data: prev.data, meta: prev.meta ?? env.meta, error: env.error, loading: false });
      schedule();
    };

    const schedule = () => {
      if (!alive || intervalMs <= 0) return;
      timer = window.setTimeout(() => {
        if (document.hidden) { schedule(); return; } // 后台页不打接口,醒着再说
        void tick();
      }, intervalMs);
    };

    const onVisible = () => { if (!document.hidden) { window.clearTimeout(timer); void tick(); } };
    document.addEventListener('visibilitychange', onVisible);
    void tick();

    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, intervalMs, bump]);

  const refresh = useCallback(() => setBump((n) => n + 1), []);
  return { ...state, refresh };
}
