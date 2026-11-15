import { applyLiveBar } from '../feed/bars';
import type { Bar } from '../feed/types';
import { IndicatorComputation } from './engine';
import type { FromWorker, ToWorker } from './protocol';
import { getDefinition } from './registry';
import { sanitizeInputs, type IndicatorInstance } from './types';

type Send = (msg: FromWorker, transfer?: Transferable[]) => void;

interface Entry {
  instance: IndicatorInstance;
  comp: IndicatorComputation;
}

/**
 * Message handler that runs inside the Web Worker (and directly in tests).
 * Keeps its own mirror of the bars so live updates never need a full copy.
 */
export class IndicatorWorkerCore {
  private bars: Bar[] = [];
  private version = 0;
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly send: Send) {}

  handle(msg: ToWorker): void {
    switch (msg.type) {
      case 'bars':
        this.version = msg.version;
        this.bars = msg.bars.slice();
        for (const e of this.entries.values()) this.sendFull(e);
        break;
      case 'live':
        if (msg.version !== this.version) return;
        this.onLive(msg.bar);
        break;
      case 'instances':
        this.version = msg.version;
        this.setInstances(msg.instances);
        break;
    }
  }

  private onLive(bar: Bar): void {
    const kind = applyLiveBar(this.bars, bar);
    if (kind === 'stale') return;
    const n = this.bars.length;
    const previous = kind === 'append' ? this.bars[n - 2] : undefined;
    for (const e of this.entries.values()) {
      try {
        const values = e.comp.update(bar, kind === 'append', previous);
        this.send({ type: 'tick', version: this.version, instanceId: e.instance.instanceId, index: n - 1, time: bar.time, values });
      } catch (err) {
        this.sendError(e, err);
      }
    }
  }

  private setInstances(list: IndicatorInstance[]): void {
    const wanted = new Map(list.map((i) => [i.instanceId, i]));
    for (const [id, e] of this.entries) {
      const w = wanted.get(id);
      if (!w || w.defId !== e.instance.defId || JSON.stringify(w.inputs) !== JSON.stringify(e.instance.inputs)) this.entries.delete(id);
    }
    for (const inst of list) {
      if (this.entries.has(inst.instanceId)) continue;
      const def = getDefinition(inst.defId);
      if (!def) {
        this.send({ type: 'error', version: this.version, instanceId: inst.instanceId, message: `Unknown indicator "${inst.defId}"` });
        continue;
      }
      const entry: Entry = { instance: inst, comp: new IndicatorComputation(def, sanitizeInputs(def, inst.inputs)) };
      this.entries.set(inst.instanceId, entry);
      this.sendFull(entry);
    }
  }

  private sendFull(e: Entry): void {
    try {
      const columns = e.comp.full(this.bars);
      const times = Float64Array.from(this.bars, (b) => b.time);
      this.send(
        { type: 'full', version: this.version, instanceId: e.instance.instanceId, times, columns },
        [times.buffer, ...columns.map((c) => c.buffer)],
      );
    } catch (err) {
      this.sendError(e, err);
    }
  }

  private sendError(e: Entry, err: unknown): void {
    this.send({ type: 'error', version: this.version, instanceId: e.instance.instanceId, message: err instanceof Error ? err.message : String(err) });
  }
}
