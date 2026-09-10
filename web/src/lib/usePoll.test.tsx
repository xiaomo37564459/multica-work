/**
 * 轮询钩子的测试 —— 收口棒(MTM-279)按住「长时间开着不炸」的那一层。
 *
 * 这一层的失败模式很特别:**轮询死了,界面不会报错**。
 * 它继续显示手上最后一份好数据,时间戳慢慢变旧,人要盯着看好一会儿才反应过来
 * 「这个数好像十分钟没动了」—— 而那期间 heory 是在拿十分钟前的状态做决定。
 * 所以下面第一条测的就是「拉取抛异常之后,下一拍还得来」。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ApiEnvelope } from '@contract';
import { usePoll } from './usePoll.ts';

function envelope<T>(data: T): ApiEnvelope<T> {
  return {
    ok: true,
    data,
    meta: { fetched_at: null, age_ms: null, stale: false, degraded: [], server_time: '2026-09-10T00:00:00Z' },
  };
}

function failure(message: string): ApiEnvelope<never> {
  return {
    ok: false,
    error: { code: 'upstream_failed', message, retryable: true },
    meta: { fetched_at: null, age_ms: null, stale: true, degraded: [], server_time: '2026-09-10T00:00:00Z' },
  };
}

/** 让 document.hidden 可控 —— 默认 jsdom 里它是只读的 false。 */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('usePoll', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); setHidden(false); });

  it('拉取抛异常不会让轮询停摆 —— 下一拍照常来', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('BFF 半路挂了');
      return envelope({ n: calls });
    });

    // 间隔取大一点,免得下一拍自己跑掉,断言不到「第一拍抛了」这个中间态。
    const { result } = renderHook(() => usePoll(fetcher, 10_000, 'k'));

    // 第一拍抛了:不该白屏,该记下错误
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();

    // 关键:第二拍必须还会来。轮询在异常上停掉的话,这里永远等不到。
    await act(async () => { await vi.advanceTimersByTimeAsync(10_100); });
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
    expect(result.current.error).toBeNull();
  });

  it('拉取失败不清屏 —— 上一份好数据留着,错误单独暴露', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? envelope({ n: 1 }) : failure('CLI 超时');
    });

    const { result } = renderHook(() => usePoll(fetcher, 10_000, 'k'));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));

    await act(async () => { await vi.advanceTimersByTimeAsync(10_100); });
    await waitFor(() => expect(result.current.error?.message).toBe('CLI 超时'));
    expect(result.current.data).toEqual({ n: 1 }); // 数据没被清掉
  });

  it('窗口切走就不打接口,切回来立刻补一拍', async () => {
    const fetcher = vi.fn(async () => envelope({ t: Date.now() }));
    renderHook(() => usePoll(fetcher, 50, 'k'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    setHidden(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    // 后台页一次都不该打 —— 六拍的时间过去了,调用数不动
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => { setHidden(false); });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });

  it('卸载之后不再有新的拉取 —— 换屏不留后台轮询', async () => {
    const fetcher = vi.fn(async () => envelope({ n: 1 }));
    const { unmount } = renderHook(() => usePoll(fetcher, 50, 'k'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('切回来时正在飞的那一拍不会插队覆盖新结果', async () => {
    const resolvers: Array<(v: ApiEnvelope<{ n: number }>) => void> = [];
    const fetcher = vi.fn(() => new Promise<ApiEnvelope<{ n: number }>>((r) => { resolvers.push(r); }));

    const { result } = renderHook(() => usePoll(fetcher, 50, 'k'));
    await waitFor(() => expect(resolvers.length).toBe(1));

    // 第一拍还没回来,人切走又切回来 → 起了第二拍
    await act(async () => { setHidden(true); setHidden(false); });
    await waitFor(() => expect(resolvers.length).toBe(2));

    // 新的先回、旧的后回:界面上必须是新的那份
    await act(async () => { resolvers[1]!(envelope({ n: 2 })); });
    await act(async () => { resolvers[0]!(envelope({ n: 1 })); });
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
  });
});
