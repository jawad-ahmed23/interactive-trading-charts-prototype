import type { HistoryResult } from '../feed/types';

export type PageLoader = (to: number, limit: number, signal: AbortSignal) => Promise<HistoryResult>;

export interface PagerOptions {
  /** Load when fewer than this many bars remain left of the viewport (spec: 50). */
  threshold?: number;
  /** Minimum page size (spec: max(150, 1.5 × visible)). */
  minPage?: number;
  maxPage?: number;
}

/**
 * Left-edge history paging with a single-flight guard (data-feed-spec §4.2, O12).
 * Pure logic: the caller supplies the visible logical range and the first bar time.
 */
export class HistoryPager {
  private inFlight: AbortController | null = null;
  private generation = 0;
  private done = false;
  private readonly threshold: number;
  private readonly minPage: number;
  private readonly maxPage: number;

  constructor(private readonly load: PageLoader, opts: PagerOptions = {}) {
    this.threshold = opts.threshold ?? 50;
    this.minPage = opts.minPage ?? 150;
    this.maxPage = opts.maxPage ?? 1000;
  }

  get loading(): boolean {
    return this.inFlight !== null;
  }

  get exhausted(): boolean {
    return this.done;
  }

  /** Forget everything (symbol/timeframe change). Aborts a pending request. */
  reset(exhausted = false): void {
    this.inFlight?.abort();
    this.inFlight = null;
    this.generation++;
    this.done = exhausted;
  }

  pageSize(visibleBars: number): number {
    return Math.min(this.maxPage, Math.max(this.minPage, Math.ceil(visibleBars * 1.5)));
  }

  /**
   * Call on every visible-range change. Resolves with the loaded page, or null
   * when nothing was requested (not near the edge, busy, exhausted) or the
   * result became obsolete.
   */
  async maybeLoad(range: { from: number; to: number }, firstTime: number | undefined): Promise<HistoryResult | null> {
    if (this.done || this.inFlight || firstTime === undefined || range.from >= this.threshold) return null;
    const gen = this.generation;
    const ctrl = new AbortController();
    this.inFlight = ctrl;
    try {
      const res = await this.load(firstTime, this.pageSize(range.to - range.from), ctrl.signal);
      if (gen !== this.generation) return null;
      if (res.noMoreData || res.bars.length === 0) this.done = true;
      return res;
    } catch (e) {
      if (gen !== this.generation || ctrl.signal.aborted) return null;
      throw e;
    } finally {
      if (gen === this.generation) this.inFlight = null;
    }
  }
}
