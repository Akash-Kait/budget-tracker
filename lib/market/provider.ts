// Market-data integration boundary. Everything live-price-related lives behind this
// interface so a real provider (Alpha Vantage, Yahoo, an MF NAV API, …) can be dropped
// in later without touching the Wealth pages, the value math (lib/wealth.ts), or — by
// design — anything in Planning (lib/finance.ts must never import this).

import { amfiProvider } from './amfi';

export interface Quote {
  price: number;
  asOf: string; // ISO
  name?: string; // provider's name for the resolved instrument — lets callers confirm the right one
}

export interface PriceProvider {
  readonly name: string;
  /** Returns a quote for a ticker, or null if unavailable / not supported. */
  getQuote(ticker: string): Promise<Quote | null>;
  /**
   * Optional batch: resolve many tickers in one shot (fetch the feed once, parse, then map).
   * Providers without it fall back to per-ticker getQuote. Throws on a feed/network/parse failure
   * so the caller can fail safe (change nothing); a per-ticker miss is a `null` entry, not a throw.
   */
  getQuotes?(tickers: string[]): Promise<Map<string, Quote | null>>;
}

/** Default provider: no live quotes — prices are entered manually until a real provider is wired. */
export const manualProvider: PriceProvider = {
  name: 'manual',
  async getQuote() {
    return null;
  },
};

/**
 * Resolves the active price provider from `MARKET_DATA_PROVIDER`:
 *   - `amfi`            → live mutual-fund NAVs from AMFI's end-of-day feed
 *   - absent / anything → `manualProvider` (the default; no behavior change for existing installs)
 */
export function getPriceProvider(): PriceProvider {
  if (process.env.MARKET_DATA_PROVIDER === 'amfi') return amfiProvider;
  return manualProvider;
}
