import type { IndicatorDefinition } from '../types';
import { ATR } from './atr';

/**
 * Custom indicators. Everything listed here is registered in both the UI and
 * the calculation worker, exactly like the built-ins.
 */
export const CUSTOM_INDICATORS: IndicatorDefinition[] = [ATR] as IndicatorDefinition[];
