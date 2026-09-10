/**
 * 分层缓存 + 单飞 + 退避。
 *
 * 核心结构决定:**浏览器的刷新节奏和 CLI 的拉取节奏是两回事。**
 * 浏览器每 3 秒问一次,永远从内存里拿到答案(<20ms);
 * 后面 CLI 拉多快、拉不拉得动,由这里说了算,前端只看 meta.age_ms / meta.stale。
 *
 * 这条边界是整个服务能不能达到「3 秒刷新」的关键 ——
 * 没有它,前端的刷新频率会直接变成打 CLI 的频率,一定把本机打爆。
 *
 * 三条硬规矩:
 *   1. 拉取失败**绝不清空缓存**。宁可显示 30 秒前的旧数据 + 一条黄条,也不能白屏。
 *   2. 同一个 key 同一时刻只允许一个在飞的请求(single-flight),后到的复用同一个 Promise。
 *   3. 连续失败就退避:间隔 ×2,封顶 60 秒;成功立刻复位。
 */

export interface CacheEntryState<T> {
  value: T | null;
  fetchedAt: number | null;
  consecutiveFailures: number;
  lastError: string | null;
  /** 退避期结束前不再发起拉取。 */
  nextAllowedAt: number;
}

/**
 * 一个缓存格子的**元数据**:新鲜度和健康度,**不含 value**。
 *
 * 为什么单独拎出来:`/api/health` 只该讲「数据几点拉的、拉挂没有」,
 * 一个字节的业务数据都不该出现在那里。让 health 拿得到的对象里**根本没有 value**,
 * 比靠调用方小心翼翼地不去展开它可靠得多 —— 见 docs/security.md 规则 D3。
 */
export interface CacheHealth {
  fetched_at: string | null;
  age_ms: number | null;
  stale: boolean;
  consecutive_failures: number;
  last_error: string | null;
}

export interface CacheSnapshot<T> extends CacheHealth {
  value: T | null;
}

export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 60_000;

export class CacheCell<T> {
  private state: CacheEntryState<T> = {
    value: null, fetchedAt: null, consecutiveFailures: 0, lastError: null, nextAllowedAt: 0,
  };
  private inFlight: Promise<T | null> | null = null;

  readonly name: string;
  /** 超过这个年龄就标 stale。只影响展示,不影响是否返回值。 */
  readonly maxAgeMs: number;
  private readonly loader: () => Promise<T>;
  private readonly now: () => number;

  constructor(
    name: string,
    maxAgeMs: number,
    loader: () => Promise<T>,
    now: () => number = Date.now,
  ) {
    this.name = name;
    this.maxAgeMs = maxAgeMs;
    this.loader = loader;
    this.now = now;
  }

  /** 只要元数据,不带业务数据。/api/health 只准用这个。 */
  health(): CacheHealth {
    const t = this.now();
    const age = this.state.fetchedAt == null ? null : t - this.state.fetchedAt;
    return {
      fetched_at: this.state.fetchedAt == null ? null : new Date(this.state.fetchedAt).toISOString(),
      age_ms: age,
      stale: age == null || age > this.maxAgeMs,
      consecutive_failures: this.state.consecutiveFailures,
      last_error: this.state.lastError,
    };
  }

  /** 元数据 + 业务数据。窄的展进宽的是安全的;反过来就是那条 1.27MB 的口子。 */
  snapshot(): CacheSnapshot<T> {
    return { value: this.state.value, ...this.health() };
  }

  /** 现在允许发起一次拉取吗(退避窗口过了没)。 */
  canRefresh(): boolean {
    return this.now() >= this.state.nextAllowedAt;
  }

  /**
   * 拉一次。失败不抛,返回缓存里的旧值(可能是 null)。
   * 调用方靠 snapshot().consecutive_failures / last_error 判断降级。
   */
  refresh(): Promise<T | null> {
    if (this.inFlight) return this.inFlight;
    if (!this.canRefresh()) return Promise.resolve(this.state.value);

    this.inFlight = this.loader()
      .then((value) => {
        this.state = {
          value,
          fetchedAt: this.now(),
          consecutiveFailures: 0,
          lastError: null,
          nextAllowedAt: 0,
        };
        return value;
      })
      .catch((err: unknown) => {
        const failures = this.state.consecutiveFailures + 1;
        const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1));
        this.state = {
          ...this.state,
          consecutiveFailures: failures,
          lastError: err instanceof Error ? err.message : String(err),
          nextAllowedAt: this.now() + backoff,
        };
        // 关键:不清 value,不 rethrow。旧数据继续服务。
        return this.state.value;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }
}

/**
 * 一个按 key 分片的缓存(用于 agent_tasks 这种「每个 agent 一份」的数据)。
 * 每个 key 独立退避 —— 一个 agent 拉挂了不该拖累其他人。
 */
export class KeyedCache<T> {
  private cells = new Map<string, CacheCell<T>>();

  readonly name: string;
  readonly maxAgeMs: number;
  private readonly loader: (key: string) => Promise<T>;
  private readonly now: () => number;

  constructor(
    name: string,
    maxAgeMs: number,
    loader: (key: string) => Promise<T>,
    now: () => number = Date.now,
  ) {
    this.name = name;
    this.maxAgeMs = maxAgeMs;
    this.loader = loader;
    this.now = now;
  }

  private cell(key: string): CacheCell<T> {
    let c = this.cells.get(key);
    if (!c) {
      c = new CacheCell<T>(`${this.name}:${key}`, this.maxAgeMs, () => this.loader(key), this.now);
      this.cells.set(key, c);
    }
    return c;
  }

  get(key: string): CacheSnapshot<T> {
    return this.cell(key).snapshot();
  }

  refresh(key: string): Promise<T | null> {
    return this.cell(key).refresh();
  }

  keys(): string[] {
    return [...this.cells.keys()];
  }

  /** 最差的一个分片的失败次数 —— 用来决定整体要不要标降级。 */
  worstFailures(): number {
    let worst = 0;
    for (const c of this.cells.values()) worst = Math.max(worst, c.snapshot().consecutive_failures);
    return worst;
  }

  /**
   * 把所有分片汇总成一行健康度,给 `/api/health` 用。
   *
   * 一律取**最差**的那一片:失败次数取最大、年龄取最旧、错误取失败次数最多那片的原文。
   * 取平均或取最好的都会把故障藏起来 —— 13 个人里挂了 1 个,平均值看着还挺健康,
   * 而界面那边黄条已经挂上了。自检接口和黄条必须说同一件事。
   *
   * 只有元数据,没有 value —— 和 CacheCell.health() 同一条规矩(docs/security.md 规则 D3)。
   */
  worstHealth(): CacheHealth {
    let worst: CacheHealth | null = null;
    for (const c of this.cells.values()) {
      const h = c.health();
      if (worst == null) { worst = h; continue; }
      worst = {
        // 年龄:null(从没拉到)最差,其次是数值最大的
        fetched_at: h.age_ms == null ? h.fetched_at : (worst.age_ms == null ? worst.fetched_at : (h.age_ms > worst.age_ms ? h.fetched_at : worst.fetched_at)),
        age_ms: h.age_ms == null || worst.age_ms == null ? null : Math.max(h.age_ms, worst.age_ms),
        stale: h.stale || worst.stale,
        consecutive_failures: Math.max(h.consecutive_failures, worst.consecutive_failures),
        last_error: h.consecutive_failures > worst.consecutive_failures ? h.last_error : (worst.last_error ?? h.last_error),
      };
    }
    // 一片都没有 = 从没拉过。报「不知道」,不报健康。
    return worst ?? { fetched_at: null, age_ms: null, stale: true, consecutive_failures: 0, last_error: null };
  }
}

/**
 * 轮巡游标:每次取 n 个 key,循环覆盖全体。
 * 冷档用它把 13 个 agent 的历史数据慢慢刷一遍,而不是每轮全拉。
 */
export class RoundRobin {
  private index = 0;
  next(keys: readonly string[], n: number): string[] {
    if (keys.length === 0) return [];
    const out: string[] = [];
    for (let i = 0; i < Math.min(n, keys.length); i += 1) {
      out.push(keys[this.index % keys.length] as string);
      this.index += 1;
    }
    return out;
  }
}
