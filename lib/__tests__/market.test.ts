import { describe, it, expect, afterEach, vi } from 'vitest';
import { getPriceProvider, manualProvider } from '@/lib/market/provider';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('price provider selection (env-gated, manual default)', () => {
  it('resolves to the manual provider when MARKET_DATA_PROVIDER is absent', () => {
    expect(getPriceProvider().name).toBe('manual');
  });
  it('resolves to the manual provider for any other value', () => {
    vi.stubEnv('MARKET_DATA_PROVIDER', 'yahoo');
    expect(getPriceProvider().name).toBe('manual');
  });
  it('resolves to the AMFI provider when MARKET_DATA_PROVIDER=amfi', () => {
    vi.stubEnv('MARKET_DATA_PROVIDER', 'amfi');
    expect(getPriceProvider().name).toBe('amfi');
  });
  it('manual provider returns no quote', async () => {
    expect(await manualProvider.getQuote('INFY')).toBeNull();
  });
});
