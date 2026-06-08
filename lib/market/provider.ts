// Market-data integration boundary. Everything live-price-related lives behind this
// interface so a real provider (Alpha Vantage, Yahoo, an MF NAV API, …) can be dropped
// in later without touching the Wealth pages, the value math (lib/wealth.ts), or — by
// design — anything in Planning (lib/finance.ts must never import this).

export interface Quote {
  price: number;
  asOf: string; // ISO
}

export interface PriceProvider {
  readonly name: string;
  /** Returns a quote for a ticker, or null if unavailable / not supported. */
  getQuote(ticker: string): Promise<Quote | null>;
}

/** Default provider: no live quotes — prices are entered manually until a real provider is wired. */
export const manualProvider: PriceProvider = {
  name: 'manual',
  async getQuote() {
    return null;
  },
};

/**
 * Resolves the active price provider. Today always `manualProvider`; later switch on an
 * env flag (e.g. process.env.MARKET_DATA_PROVIDER) to return a real implementation.
 */
export function getPriceProvider(): PriceProvider {
  return manualProvider;
}
