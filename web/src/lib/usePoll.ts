/**
 * 轮询钩子 —— 指挥舱的「准实时」全靠它(平台没有推送通道,父任务已定轮询)。
 *
 * 四条纪律(前三条来自契约/前端 README,第四条是 MTM-279 收口时补的):
 *   1. 拉失败**不清屏**:上一份好数据留着继续显示,错误单独暴露 —— 顶部黄条负责说明。
 *   2. 页面被切到后台就停手(document.hidden),回来立刻补一拍 —— 不空转打接口。
 *   3. 竞态兜底:回来的响应如果已经不是当前这轮的,丢弃。
 *   4. **下一拍无论如何都要排上**。数据源约定失败也走信封(ok:false),但只要有一次
 *      真的抛出来(旧版在这里 await 没包 try),整条轮询就永久停摆 —— 而且界面不报错,
 *      它继续显示最后一份好数据、时间戳慢慢变旧。这种「安静地死掉」比报错难查得多。
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
      let env: ApiEnvelope<T>;
      try {
        env = await fetcherRef.current();
      } catch (err) {
        // 纪律 4:数据源不该抛,但抛了也不能让轮询停在这儿(那会安静地死掉)。
        env = {
          ok: false,
          error: {
            code: 'internal',
            message: err instanceof Error ? err.message : '数据源抛异常了',
            retryable: true,
          },
          meta: { fetched_at: null, age_ms: null, stale: true, degraded: [], server_time: new Date().toISOString() },
        };
      }
      // 过期的一拍:不写状态,也不排下一拍 —— 排下一拍的是接替它的那一拍。
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
