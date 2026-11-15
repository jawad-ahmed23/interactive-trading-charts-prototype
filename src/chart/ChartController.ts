import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LogicalRange,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type WhitespaceData,
} from 'lightweight-charts';
import { timeframeSeconds } from '../feed/timeframe';
import type { Bar, DataFeed, StreamStatus, SymbolInfo, Timeframe, Unsubscribe } from '../feed/types';
import type { FromWorker, IndicatorHost } from '../indicators/protocol';
import { getDefinition } from '../indicators/registry';
import { instanceLabel, type IndicatorDefinition, type IndicatorInstance } from '../indicators/types';
import { THEME } from '../ui/theme';
import { BandFillPrimitive } from './bandFill';
import { BarStore } from './barStore';
import { formatValue, formatVolume, makeTimeFormatters } from './formatters';
import { HistoryPager } from './historyPager';

export type ScaleMode = 'normal' | 'log' | 'percent';

export interface LegendValue {
  title: string;
  color: string;
  text: string;
}

export interface LegendState {
  timeText: string;
  bar: Bar | null;
  precision: number;
  changePct: number | null;
  volumeText: string;
  indicators: { instanceId: string; label: string; values: LegendValue[] }[];
}

export interface ChartStatus {
  loading: boolean;
  historyLoading: boolean;
  historyExhausted: boolean;
  message: string | null;
  stream: StreamStatus | null;
  barCount: number;
}

export interface ControllerEvents {
  onLegend(state: LegendState): void;
  onRealtimeButton(visible: boolean): void;
  onStatus(status: ChartStatus): void;
  onSymbolInfo(info: SymbolInfo): void;
}

interface RenderedIndicator {
  instance: IndicatorInstance;
  def: IndicatorDefinition;
  label: string;
  series: ISeriesApi<SeriesType>[];
  priceLines: IPriceLine[];
  bands: BandFillPrimitive[];
  /** Output aligned with `times` (its own copy, so it can never misalign with the bar store). */
  times: number[];
  columns: number[][];
}

const INITIAL_BARS = 300;
/** Memory guard: stop paging history beyond this many bars per series. */
const MAX_BARS = 50_000;

export class ChartController {
  private readonly chart: IChartApi;
  private readonly candles: ISeriesApi<'Candlestick'>;
  private readonly volume: ISeriesApi<'Histogram'>;
  private readonly store = new BarStore();
  private readonly pager: HistoryPager;
  private readonly indicators = new Map<string, RenderedIndicator>();
  private info: SymbolInfo | null = null;
  private timeframe: Timeframe = '1h';
  private generation = 0;
  private dataVersion = 0;
  private unsubscribe: Unsubscribe | null = null;
  private initialLoad: AbortController | null = null;
  private hoverTime: number | null = null;
  private realtimeButton = false;
  private status: ChartStatus = { loading: false, historyLoading: false, historyExhausted: false, message: null, stream: null, barCount: 0 };
  private disposed = false;

  constructor(
    container: HTMLElement,
    private readonly feed: DataFeed,
    private readonly host: IndicatorHost,
    private readonly events: ControllerEvents,
  ) {
    this.chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: THEME.bg },
        textColor: THEME.text,
        fontSize: 12,
        attributionLogo: true, // review decision 7 (LWC licence link requirement)
        panes: { separatorColor: THEME.border, separatorHoverColor: THEME.borderHover, enableResize: true },
      },
      grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
      crosshair: { mode: CrosshairMode.MagnetOHLC },
      rightPriceScale: { borderColor: THEME.border },
      timeScale: {
        borderColor: THEME.border,
        rightOffset: 8,
        barSpacing: 8,
        timeVisible: true,
        secondsVisible: false,
        // Review decision 1: zoom keeps the latest bar fixed; hold ⌘/Ctrl to zoom at the cursor.
        rightBarStaysOnScroll: true,
      },
      kineticScroll: { mouse: true, touch: true },
    });

    this.candles = this.chart.addSeries(
      CandlestickSeries,
      {
        upColor: THEME.up,
        downColor: THEME.down,
        borderUpColor: THEME.up,
        borderDownColor: THEME.down,
        wickUpColor: THEME.up,
        wickDownColor: THEME.down,
      },
      0,
    );
    this.volume = this.chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
      1,
    );
    this.chart.panes()[0]?.setStretchFactor(1);
    this.chart.panes()[1]?.setStretchFactor(0.22);

    this.pager = new HistoryPager((to, limit, signal) => {
      if (!this.info) return Promise.resolve({ bars: [], noMoreData: true });
      return this.feed.getBars(this.info, this.timeframe, { to, limit, signal });
    });

    this.chart.timeScale().subscribeVisibleLogicalRangeChange(this.onRange);
    this.chart.subscribeCrosshairMove(this.onCrosshair);
    this.host.onMessage(this.onWorker);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', this.onBlur);
  }

  // ---------------------------------------------------------------- data

  async setSymbol(symbol: string, timeframe: Timeframe): Promise<void> {
    const gen = ++this.generation;
    this.teardownData();
    this.timeframe = timeframe;
    this.setStatus({ loading: true, message: null, historyExhausted: false, barCount: 0 });

    let info: SymbolInfo;
    try {
      info = await this.feed.resolveSymbol(symbol);
    } catch (e) {
      if (gen === this.generation) this.setStatus({ loading: false, message: errorText(e) });
      return;
    }
    if (gen !== this.generation) return;
    this.info = info;
    this.applySymbolFormatting(info);
    this.events.onSymbolInfo(info);

    // Subscribe first so no live bar is lost while history loads; buffer until ready.
    const pending: Bar[] = [];
    let ready = false;
    this.unsubscribe = this.feed.subscribeBars(
      info,
      timeframe,
      (bar) => {
        if (gen !== this.generation) return;
        if (ready) this.onLiveBar(bar);
        else pending.push(bar);
      },
      (stream) => {
        if (gen === this.generation) this.setStatus({ stream });
      },
    );

    const ctrl = new AbortController();
    this.initialLoad = ctrl;
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const res = await this.feed.getBars(info, timeframe, { to: nowSec + timeframeSeconds(timeframe), limit: INITIAL_BARS, signal: ctrl.signal });
      if (gen !== this.generation) return;
      this.store.reset(res.bars);
      this.pager.reset(res.noMoreData);
      this.pushAllBars();
      this.chart.timeScale().scrollToRealTime();
      ready = true;
      for (const bar of pending) this.onLiveBar(bar);
      this.setStatus({ loading: false, historyExhausted: res.noMoreData, barCount: this.store.length });
      this.emitLegend();
    } catch (e) {
      if (gen === this.generation && !ctrl.signal.aborted) this.setStatus({ loading: false, message: `Could not load history: ${errorText(e)}` });
    } finally {
      if (this.initialLoad === ctrl) this.initialLoad = null;
    }
  }

  private teardownData(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.initialLoad?.abort();
    this.initialLoad = null;
    this.pager.reset();
    this.store.reset([]);
    this.dataVersion++;
    this.host.post({ type: 'bars', version: this.dataVersion, bars: [] });
    this.candles.setData([]);
    this.volume.setData([]);
    for (const r of this.indicators.values()) {
      r.times = [];
      r.columns = r.def.plots.map(() => []);
      for (const s of r.series) s.setData([]);
    }
    this.hoverTime = null;
    this.setRealtimeButton(false);
  }

  /** Full push of the bar store to LWC and the indicator worker. */
  private pushAllBars(): void {
    const bars = this.store.bars;
    this.candles.setData(bars.map(toCandle));
    this.volume.setData(bars.map(toVolume));
    this.dataVersion++;
    this.host.post({ type: 'bars', version: this.dataVersion, bars: bars.slice() });
  }

  private onLiveBar(bar: Bar): void {
    const kind = this.store.applyLive(bar);
    if (kind === 'stale') return; // LWC would throw on an older time (rendering §8)
    this.candles.update(toCandle(bar));
    this.volume.update(toVolume(bar));
    this.host.post({ type: 'live', version: this.dataVersion, bar, kind });
    if (kind === 'append') this.setStatus({ barCount: this.store.length });
    if (this.hoverTime === null) this.emitLegend();
  }

  private readonly onRange = (range: LogicalRange | null): void => {
    if (!range || this.disposed) return;
    const lastIndex = this.store.length - 1;
    this.setRealtimeButton(lastIndex > 0 && range.to < lastIndex - 1);
    if (this.pager.loading || this.pager.exhausted || !this.info) return;
    if (this.store.length >= MAX_BARS) {
      if (!this.status.message) this.setStatus({ message: `History limit reached (${MAX_BARS.toLocaleString()} bars)` });
      return;
    }
    const gen = this.generation;
    const promise = this.pager.maybeLoad({ from: range.from, to: range.to }, this.store.first?.time);
    if (this.pager.loading) this.setStatus({ historyLoading: true });
    promise
      .then((res) => {
        if (gen !== this.generation) return;
        this.setStatus({ historyLoading: false, historyExhausted: this.pager.exhausted });
        if (!res) return;
        const added = this.store.prepend(res.bars);
        if (added > 0) {
          // LWC anchors the view to the right edge (last bar + right offset), so
          // prepending keeps the visible bars in place; no manual range shift.
          this.pushAllBars();
          this.setStatus({ barCount: this.store.length });
        }
      })
      .catch((e: unknown) => {
        if (gen === this.generation) this.setStatus({ historyLoading: false, message: `History page failed: ${errorText(e)}` });
      });
  };

  // ---------------------------------------------------------------- indicators

  /** Diff the requested indicator list against what is rendered. */
  setIndicators(instances: IndicatorInstance[]): void {
    const wanted = new Map(instances.map((i) => [i.instanceId, i]));
    for (const [id, r] of this.indicators) {
      const next = wanted.get(id);
      if (!next || JSON.stringify([next.defId, next.inputs, next.plotColors]) !== JSON.stringify([r.instance.defId, r.instance.inputs, r.instance.plotColors])) {
        this.removeRendered(r);
        this.indicators.delete(id);
      }
    }
    for (const inst of instances) {
      if (this.indicators.has(inst.instanceId)) continue;
      const def = getDefinition(inst.defId);
      if (!def) continue;
      this.indicators.set(inst.instanceId, this.createRendered(inst, def));
    }
    this.host.post({ type: 'instances', version: this.dataVersion, instances });
    this.emitLegend();
  }

  private createRendered(instance: IndicatorInstance, def: IndicatorDefinition): RenderedIndicator {
    const precision = def.precision ?? this.info?.pricePrecision ?? 2;
    const rendered: RenderedIndicator = {
      instance,
      def,
      label: instanceLabel(def, instance.inputs),
      series: [],
      priceLines: [],
      bands: [],
      times: [],
      columns: def.plots.map(() => []),
    };
    let paneIndex = def.placement === 'overlay' ? 0 : this.chart.panes().length;
    const autoscale = def.fixedRange
      ? () => ({ priceRange: { minValue: def.fixedRange![0], maxValue: def.fixedRange![1] } })
      : undefined;
    const colorOf = (plotId: string, fallback: string): string => instance.plotColors?.[plotId] ?? fallback;
    for (const plot of def.plots) {
      const common = {
        priceLineVisible: false,
        lastValueVisible: plot.kind === 'line',
        priceFormat: { type: 'price' as const, precision, minMove: 1 / 10 ** precision },
        ...(autoscale ? { autoscaleInfoProvider: autoscale } : {}),
      };
      const series =
        plot.kind === 'histogram'
          ? this.chart.addSeries(HistogramSeries, { ...common, color: colorOf(plot.id, plot.color) }, paneIndex)
          : this.chart.addSeries(LineSeries, { ...common, color: colorOf(plot.id, plot.color), lineWidth: plot.lineWidth ?? 2, crosshairMarkerVisible: false }, paneIndex);
      rendered.series.push(series as ISeriesApi<SeriesType>);
      paneIndex = series.getPane().paneIndex();
    }
    if (def.placement === 'pane') {
      rendered.series[0]?.getPane().setStretchFactor(0.3);
      // Tight margins so a fixed 0–100 range is not padded to e.g. 120.
      if (def.fixedRange) rendered.series[0]?.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 } });
    }
    const first = rendered.series[0];
    for (const level of def.levels ?? []) {
      if (!first) break;
      rendered.priceLines.push(
        first.createPriceLine({ price: level.value, color: THEME.muted, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '' }),
      );
    }
    for (const band of def.bands ?? []) {
      const ui = def.plots.findIndex((p) => p.id === band.upper);
      const li = def.plots.findIndex((p) => p.id === band.lower);
      const host = rendered.series[ui];
      if (ui < 0 || li < 0 || !host) continue;
      const prim = new BandFillPrimitive(() => ({ times: rendered.times, upper: rendered.columns[ui]!, lower: rendered.columns[li]! }), band.color);
      host.attachPrimitive(prim);
      rendered.bands.push(prim);
    }
    return rendered;
  }

  private removeRendered(r: RenderedIndicator): void {
    for (const s of r.series) this.chart.removeSeries(s); // empty panes are removed by LWC
  }

  private readonly onWorker = (msg: FromWorker): void => {
    if (this.disposed || msg.version !== this.dataVersion) return;
    const r = this.indicators.get(msg.instanceId);
    if (!r) return;
    if (msg.type === 'error') {
      this.setStatus({ message: `${r.label}: ${msg.message}` });
      return;
    }
    if (msg.type === 'full') {
      r.times = Array.from(msg.times);
      r.columns = msg.columns.map((c) => Array.from(c));
      r.def.plots.forEach((plot, p) => {
        const col = r.columns[p]!;
        r.series[p]?.setData(r.times.map((t, i) => plotPoint(plot.kind, plot.color, plot.negativeColor, t, col[i]!)));
      });
    } else {
      if (msg.index === r.times.length) r.times.push(msg.time);
      else if (r.times[msg.index] !== msg.time) return; // misaligned; the next full result fixes it
      r.def.plots.forEach((plot, p) => {
        const v = msg.values[p] ?? Number.NaN;
        r.columns[p]![msg.index] = v;
        r.series[p]?.update(plotPoint(plot.kind, plot.color, plot.negativeColor, msg.time, v));
      });
    }
    for (const b of r.bands) b.refresh();
    if (this.hoverTime === null || msg.type === 'full') this.emitLegend();
  };

  // ---------------------------------------------------------------- view

  setScaleMode(mode: ScaleMode): void {
    const m = mode === 'log' ? PriceScaleMode.Logarithmic : mode === 'percent' ? PriceScaleMode.Percentage : PriceScaleMode.Normal;
    this.chart.priceScale('right', 0).applyOptions({ mode: m });
  }

  scrollToRealtime(): void {
    this.chart.timeScale().scrollToRealTime();
  }

  resetView(): void {
    this.chart.timeScale().resetTimeScale();
    this.chart.priceScale('right', 0).applyOptions({ autoScale: true });
  }

  private applySymbolFormatting(info: SymbolInfo): void {
    const f = makeTimeFormatters(info.timezone);
    this.chart.applyOptions({
      timeScale: { tickMarkFormatter: f.tickMarkFormatter, secondsVisible: false },
      localization: { timeFormatter: f.timeFormatter },
    });
    this.candles.applyOptions({ priceFormat: { type: 'price', precision: info.pricePrecision, minMove: info.tickSize } });
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Meta' || e.key === 'Control') {
      this.chart.timeScale().applyOptions({ rightBarStaysOnScroll: e.type === 'keyup' });
    }
  };

  private readonly onBlur = (): void => {
    this.chart.timeScale().applyOptions({ rightBarStaysOnScroll: true });
  };

  private setRealtimeButton(visible: boolean): void {
    if (visible === this.realtimeButton) return;
    this.realtimeButton = visible;
    this.events.onRealtimeButton(visible);
  }

  // ---------------------------------------------------------------- legend

  private readonly onCrosshair = (param: MouseEventParams<Time>): void => {
    this.hoverTime = param.time === undefined ? null : (param.time as number);
    this.emitLegend();
  };

  private emitLegend(): void {
    const info = this.info;
    const precision = info?.pricePrecision ?? 2;
    const idx = this.hoverTime === null ? this.store.length - 1 : this.store.indexOf(this.hoverTime);
    const bar = idx >= 0 ? this.store.bars[idx] ?? null : null;
    const prev = idx > 0 ? this.store.bars[idx - 1] : undefined;
    const fmt = makeTimeFormatters(info?.timezone ?? 'UTC');
    const indicators: LegendState['indicators'] = [];
    for (const r of this.indicators.values()) {
      const i = bar ? lowerBound(r.times, bar.time) : -1;
      const prec = r.def.precision ?? precision;
      indicators.push({
        instanceId: r.instance.instanceId,
        label: r.label,
        values: r.def.plots.map((plot, p) => ({
          title: plot.title,
          color: r.instance.plotColors?.[plot.id] ?? plot.color,
          text: formatValue(i >= 0 && r.times[i] === bar?.time ? r.columns[p]![i] : null, prec),
        })),
      });
    }
    this.events.onLegend({
      timeText: bar ? fmt.legendTime(bar.time) : '',
      bar,
      precision,
      changePct: bar && prev ? ((bar.close - prev.close) / prev.close) * 100 : null,
      volumeText: bar ? formatVolume(bar.volume) : '',
      indicators,
    });
  }

  private setStatus(patch: Partial<ChartStatus>): void {
    this.status = { ...this.status, ...patch };
    this.events.onStatus(this.status);
  }

  /** Debug/inspection hook used by the prototype's manual checks. */
  debugState(): { bars: number; firstTime: number | undefined; lastTime: number | undefined; range: LogicalRange | null; indicators: number } {
    return {
      bars: this.store.length,
      firstTime: this.store.first?.time,
      lastTime: this.store.last?.time,
      range: this.chart.timeScale().getVisibleLogicalRange(),
      indicators: this.indicators.size,
    };
  }

  destroy(): void {
    this.disposed = true;
    this.generation++;
    this.unsubscribe?.();
    this.initialLoad?.abort();
    this.pager.reset();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.onBlur);
    this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this.onRange);
    this.chart.unsubscribeCrosshairMove(this.onCrosshair);
    this.chart.remove();
  }
}

function toCandle(b: Bar) {
  return { time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close };
}

function toVolume(b: Bar) {
  return { time: b.time as Time, value: b.volume, color: b.close >= b.open ? THEME.upAlpha : THEME.downAlpha };
}

/** NaN ("none") is never sent to LWC: it becomes a whitespace point (rendering §8). */
function plotPoint(kind: 'line' | 'histogram', color: string, negativeColor: string | undefined, time: number, v: number) {
  if (!Number.isFinite(v)) return { time: time as Time } as WhitespaceData<Time>;
  if (kind === 'histogram') return { time: time as Time, value: v, color: v < 0 && negativeColor ? negativeColor : color };
  return { time: time as Time, value: v };
}

function lowerBound(arr: readonly number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo < arr.length ? lo : -1;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
