import { rmaInit, smootherStep, type SmootherState } from '../ops';
import type { IndicatorDefinition } from '../types';
import { THEME } from '../../ui/theme';

/**
 * Example custom indicator: Average True Range (Wilder).
 * True range = max(H−L, |H−prevC|, |L−prevC|); bar 0 uses H−L (script-language-design §8.1).
 * ATR = Wilder smoothing (RMA) of the true range; first value at index length−1.
 *
 * To write your own: copy this file, change the id/inputs/plots and the `step`
 * function, then add it to the list in ./index.ts.
 */
interface AtrState {
  prevClose: number;
  rma: SmootherState;
}

export const ATR: IndicatorDefinition<AtrState> = {
  id: 'atr',
  name: 'Average True Range',
  shortName: 'ATR',
  placement: 'pane',
  inputs: [{ id: 'length', title: 'Length', type: 'int', default: 14, min: 1, max: 500 }],
  plots: [{ id: 'atr', title: 'ATR', kind: 'line', color: THEME.accent5 }],
  warmup: (i) => Math.max(1, Math.round(Number(i.length))) - 1,
  create(inputs) {
    const n = Math.max(1, Math.round(Number(inputs.length)));
    return {
      initial: () => ({ prevClose: Number.NaN, rma: rmaInit(n) }),
      step(state, bar) {
        const tr = Number.isNaN(state.prevClose)
          ? bar.high - bar.low
          : Math.max(bar.high - bar.low, Math.abs(bar.high - state.prevClose), Math.abs(bar.low - state.prevClose));
        state.prevClose = bar.close;
        return [smootherStep(state.rma, tr)];
      },
      clone: (s) => structuredClone(s),
    };
  },
};
