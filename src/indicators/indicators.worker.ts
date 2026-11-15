/// <reference lib="webworker" />
import type { ToWorker } from './protocol';
import { IndicatorWorkerCore } from './workerCore';

declare const self: DedicatedWorkerGlobalScope;

const core = new IndicatorWorkerCore((msg, transfer) => self.postMessage(msg, transfer ?? []));
self.onmessage = (e: MessageEvent<ToWorker>) => core.handle(e.data);
