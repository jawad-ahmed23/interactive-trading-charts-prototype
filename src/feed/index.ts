import { BINANCE_SYMBOLS, BinanceFeed } from './binance';
import { MOCK_SYMBOLS, MockFeed } from './mock';
import type { Bar, DataFeed, HistoryRequest, HistoryResult, StreamStatus, SymbolInfo, Timeframe, Unsubscribe } from './types';

export * from './types';

export interface SymbolEntry {
  symbol: string;
  description: string;
  source: 'Binance' | 'Mock';
}

export const SYMBOLS: SymbolEntry[] = [
  { symbol: 'BTCUSDT', description: 'Bitcoin / Tether', source: 'Binance' },
  { symbol: 'ETHUSDT', description: 'Ethereum / Tether', source: 'Binance' },
  { symbol: 'SOLUSDT', description: 'Solana / Tether', source: 'Binance' },
  { symbol: 'XAUUSD', description: 'Gold spot / USD (mock data)', source: 'Mock' },
  { symbol: 'AAPL', description: 'Apple Inc. (mock data)', source: 'Mock' },
];

/** Routes each symbol to the adapter that serves it. */
export class CompositeFeed implements DataFeed {
  constructor(
    private readonly binance: DataFeed = new BinanceFeed(),
    private readonly mock: DataFeed = new MockFeed(),
  ) {}

  private pick(symbol: string): DataFeed {
    if (BINANCE_SYMBOLS.includes(symbol)) return this.binance;
    if (MOCK_SYMBOLS.includes(symbol)) return this.mock;
    throw new Error(`No data source for ${symbol}`);
  }

  resolveSymbol(symbol: string): Promise<SymbolInfo> {
    return this.pick(symbol).resolveSymbol(symbol);
  }

  getBars(info: SymbolInfo, tf: Timeframe, req: HistoryRequest): Promise<HistoryResult> {
    return this.pick(info.symbol).getBars(info, tf, req);
  }

  subscribeBars(info: SymbolInfo, tf: Timeframe, onBar: (b: Bar) => void, onStatus?: (s: StreamStatus) => void): Unsubscribe {
    return this.pick(info.symbol).subscribeBars(info, tf, onBar, onStatus);
  }
}
