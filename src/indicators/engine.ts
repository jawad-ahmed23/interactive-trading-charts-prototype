import type { Bar } from '../feed/types';
import type { IndicatorDefinition, IndicatorRuntime, InputValues } from './types';

/**
 * One indicator instance's computation (indicator-engine-spec §3).
 *
 * `full()` and `update()` share one code path: the runtime's `step`.
 * - `committed` = state after every CLOSED bar (all but the last).
 * - The live (last) bar is evaluated on a clone of `committed` (rollback model),
 *   so a tick never leaks into history and closed bars never change.
 * Because the same `step` runs on the same final bars in the same order,
 * incremental results are identical to a full recompute.
 */
export class IndicatorComputation<S = unknown> {
  private readonly rt: IndicatorRuntime<S>;
  private committed: S;
  private hasLiveBar = false;

  constructor(readonly def: IndicatorDefinition<S>, readonly inputs: InputValues) {
    this.rt = def.create(inputs);
    this.committed = this.rt.initial();
  }

  get plotCount(): number {
    return this.def.plots.length;
  }

  /** Recompute over all bars. Returns one Float64Array per plot (NaN = none). */
  full(bars: readonly Bar[]): Float64Array[] {
    const cols = this.def.plots.map(() => new Float64Array(bars.length));
    this.committed = this.rt.initial();
    this.hasLiveBar = false;
    const n = bars.length;
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      const state = last ? this.rt.clone(this.committed) : this.committed;
      const values = this.rt.step(state, bars[i]!);
      for (let p = 0; p < cols.length; p++) cols[p]![i] = values[p] ?? Number.NaN;
      if (last) this.hasLiveBar = true;
    }
    return cols;
  }

  /**
   * Incremental update for the last bar.
   * @param bar the current (forming) bar
   * @param isNewBar true when `bar` opened a new period
   * @param previousFinal the final version of the previous bar (required when isNewBar)
   */
  update(bar: Bar, isNewBar: boolean, previousFinal?: Bar): number[] {
    if (isNewBar && this.hasLiveBar) {
      if (!previousFinal) throw new Error('previousFinal is required when a new bar opens');
      this.rt.step(this.committed, previousFinal); // commit the now-closed bar
    }
    this.hasLiveBar = true;
    const scratch = this.rt.clone(this.committed);
    return this.rt.step(scratch, bar).map((v) => v ?? Number.NaN);
  }
}
