import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';

type CanvasRenderingTarget2D = Parameters<IPrimitivePaneRenderer['draw']>[0];

export interface BandData {
  times: readonly number[];
  upper: readonly number[];
  lower: readonly number[];
}

/**
 * Fills the area between two plots of the same indicator (LWC has no native
 * "fill between series"). Attached to the upper series; drawn below it.
 */
export class BandFillPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private readonly view: IPrimitivePaneView;

  constructor(private readonly getData: () => BandData, private readonly color: string) {
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target) };
    this.view = { zOrder: () => 'bottom', renderer: () => renderer };
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart as IChartApi;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  refresh(): void {
    this.requestUpdate?.();
  }

  private draw(target: CanvasRenderingTarget2D): void {
    const chart = this.chart;
    const series = this.series;
    if (!chart || !series) return;
    const { times, upper, lower } = this.getData();
    const range = chart.timeScale().getVisibleLogicalRange();
    if (!range || times.length === 0) return;
    const ts = chart.timeScale();
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const runs: { x: number; yu: number; yl: number }[][] = [];
      let run: { x: number; yu: number; yl: number }[] = [];
      const from = Math.max(0, Math.floor(range.from) - 2);
      const to = Math.min(times.length - 1, Math.ceil(range.to) + 2);
      for (let i = from; i <= to; i++) {
        const u = upper[i];
        const l = lower[i];
        const x = ts.timeToCoordinate(times[i] as Time);
        const yu = u === undefined || Number.isNaN(u) ? null : series.priceToCoordinate(u);
        const yl = l === undefined || Number.isNaN(l) ? null : series.priceToCoordinate(l);
        if (x === null || yu === null || yl === null) {
          if (run.length > 1) runs.push(run);
          run = [];
          continue;
        }
        run.push({ x, yu, yl });
      }
      if (run.length > 1) runs.push(run);
      ctx.fillStyle = this.color;
      for (const r of runs) {
        ctx.beginPath();
        ctx.moveTo(r[0]!.x, r[0]!.yu);
        for (const p of r) ctx.lineTo(p.x, p.yu);
        for (let k = r.length - 1; k >= 0; k--) ctx.lineTo(r[k]!.x, r[k]!.yl);
        ctx.closePath();
        ctx.fill();
      }
    });
  }
}
