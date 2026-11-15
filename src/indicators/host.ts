import type { FromWorker, IndicatorHost, ToWorker } from './protocol';

/** Runs indicator calculations in a dedicated Web Worker so the UI never blocks. */
export class WorkerIndicatorHost implements IndicatorHost {
  private readonly worker: Worker;
  private listener: ((msg: FromWorker) => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL('./indicators.worker.ts', import.meta.url), { type: 'module', name: 'indicators' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.listener?.(e.data);
    this.worker.onerror = (e) => console.error('[indicators worker]', e.message);
  }

  post(msg: ToWorker): void {
    this.worker.postMessage(msg);
  }

  onMessage(listener: (msg: FromWorker) => void): void {
    this.listener = listener;
  }

  dispose(): void {
    this.listener = null;
    this.worker.terminate();
  }
}
