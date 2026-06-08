import { describe, it, expect } from 'vitest';
import { getPriceProvider, manualProvider } from '@/lib/market/provider';

describe('price provider (manual default)', () => {
  it('resolves to the manual provider', () => {
    expect(getPriceProvider().name).toBe('manual');
  });
  it('manual provider returns no quote', async () => {
    expect(await manualProvider.getQuote('INFY')).toBeNull();
  });
});
