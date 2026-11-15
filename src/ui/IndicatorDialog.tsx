import { useEffect, useState } from 'react';
import { listDefinitions, getDefinition } from '../indicators/registry';
import { PRICE_SOURCES, defaultInputs, instanceLabel, sanitizeInputs, type IndicatorInstance, type InputDef } from '../indicators/types';
import { newInstanceId } from '../state/settings';
import { ACCENTS } from './theme';

interface Props {
  indicators: IndicatorInstance[];
  focusId: string | null;
  /** Functional update, so several quick edits never overwrite each other. */
  onChange(update: (prev: IndicatorInstance[]) => IndicatorInstance[]): void;
  onClose(): void;
}

export function IndicatorDialog({ indicators, focusId, onChange, onClose }: Props) {
  const [selected, setSelected] = useState<string | null>(focusId ?? indicators[0]?.instanceId ?? null);
  const defs = listDefinitions();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const add = (defId: string) => {
    const def = getDefinition(defId);
    if (!def) return;
    const instanceId = newInstanceId();
    onChange((prev) => {
      const sameKind = prev.filter((i) => i.defId === defId).length;
      const inst: IndicatorInstance = { instanceId, defId, inputs: defaultInputs(def) };
      // A second EMA/SMA gets its own colour so instances are distinguishable.
      if (sameKind > 0) {
        inst.plotColors = Object.fromEntries(
          def.plots.filter((pl) => pl.kind === 'line').map((pl, k) => [pl.id, ACCENTS[(sameKind * 2 + k) % ACCENTS.length]!]),
        );
      }
      return [...prev, inst];
    });
    setSelected(instanceId);
  };

  const remove = (id: string) => {
    onChange((prev) => prev.filter((i) => i.instanceId !== id));
    if (selected === id) setSelected(null);
  };

  const updateInput = (id: string, key: string, value: number | string) => {
    onChange((prev) =>
      prev.map((i) => {
        if (i.instanceId !== id) return i;
        const def = getDefinition(i.defId);
        return def ? { ...i, inputs: sanitizeInputs(def, { ...i.inputs, [key]: value }) } : i;
      }),
    );
  };

  const current = indicators.find((i) => i.instanceId === selected);
  const currentDef = current ? getDefinition(current.defId) : undefined;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="Indicators" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Indicators</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <section>
            <h3>Available</h3>
            <ul className="list">
              {defs.map((d) => (
                <li key={d.id}>
                  <span>
                    <strong>{d.shortName}</strong> <span className="dim">{d.name}</span>
                  </span>
                  <button onClick={() => add(d.id)}>Add</button>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3>On chart</h3>
            <ul className="list">
              {indicators.length === 0 && <li className="dim">None</li>}
              {indicators.map((i) => {
                const def = getDefinition(i.defId);
                return (
                  <li key={i.instanceId} className={i.instanceId === selected ? 'active' : ''} onClick={() => setSelected(i.instanceId)}>
                    <span>{def ? instanceLabel(def, i.inputs) : i.defId}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(i.instanceId);
                      }}
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
            {current && currentDef && (
              <div className="inputs">
                <h3>{currentDef.name}</h3>
                {currentDef.inputs.map((inp) => (
                  <InputField key={inp.id} def={inp} value={current.inputs[inp.id]} onChange={(v) => updateInput(current.instanceId, inp.id, v)} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function InputField({ def, value, onChange }: { def: InputDef; value: number | string | undefined; onChange(v: number | string): void }) {
  const [draft, setDraft] = useState(String(value ?? def.default));
  useEffect(() => setDraft(String(value ?? def.default)), [value, def.default]);
  if (def.type === 'source') {
    return (
      <label className="field">
        <span>{def.title}</span>
        <select value={String(value ?? def.default)} onChange={(e) => onChange(e.target.value)}>
          {PRICE_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(n)) onChange(n);
    else setDraft(String(value ?? def.default));
  };
  return (
    <label className="field">
      <span>{def.title}</span>
      <input
        type="number"
        value={draft}
        min={def.min}
        max={def.max}
        step={def.type === 'int' ? 1 : def.step ?? 0.1}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </label>
  );
}
