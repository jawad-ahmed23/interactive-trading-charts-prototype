import { BUILTINS } from './builtins';
import { CUSTOM_INDICATORS } from './custom';
import type { IndicatorDefinition } from './types';

/**
 * Indicator registry. Built-ins register here exactly like a compiled Quill
 * script will: there is no other path, and the chart layer never branches on ids.
 */
const registry = new Map<string, IndicatorDefinition>();

export function registerIndicator(def: IndicatorDefinition): void {
  if (registry.has(def.id)) throw new Error(`Indicator "${def.id}" is already registered`);
  if (def.plots.length === 0) throw new Error(`Indicator "${def.id}" has no plots`);
  registry.set(def.id, def);
}

export function getDefinition(id: string): IndicatorDefinition | undefined {
  return registry.get(id);
}

export function listDefinitions(): IndicatorDefinition[] {
  return [...registry.values()];
}

for (const def of [...BUILTINS, ...CUSTOM_INDICATORS]) registerIndicator(def);
