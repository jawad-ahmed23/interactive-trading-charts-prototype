import type { Bar } from '../feed/types';
import type { IndicatorInstance } from './types';

/**
 * Main thread ↔ indicator worker messages.
 * `version` identifies the bar dataset (bumped on every reset or prepend), so
 * results computed for an older dataset can be dropped by the receiver.
 */
export type ToWorker =
  | { type: 'bars'; version: number; bars: Bar[] }
  | { type: 'live'; version: number; bar: Bar; kind: 'replace' | 'append' }
  | { type: 'instances'; version: number; instances: IndicatorInstance[] };

export type FromWorker =
  | { type: 'full'; version: number; instanceId: string; times: Float64Array; columns: Float64Array[] }
  | { type: 'tick'; version: number; instanceId: string; index: number; time: number; values: number[] }
  | { type: 'error'; version: number; instanceId: string; message: string };

export interface IndicatorHost {
  post(msg: ToWorker): void;
  onMessage(listener: (msg: FromWorker) => void): void;
  dispose(): void;
}
