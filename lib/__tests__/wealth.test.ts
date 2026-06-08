import { describe, it, expect } from 'vitest';
import { assetValue, totalWealth, groupByType } from '@/lib/wealth';
import type { WealthAsset } from '@/lib/types';

function asset(p: Partial<WealthAsset>): WealthAsset {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'a',
    type: 'STOCK',
    ticker: null,
    quantity: null,
    pricePerUnit: null,
    value: null,
    ...p,
  };
}

describe('assetValue', () => {
  it('is quantity * price when both present', () => {
    expect(assetValue(asset({ quantity: 10, pricePerUnit: 150.5 }))).toBe(1505);
  });
  it('falls back to manual value', () => {
    expect(assetValue(asset({ value: 5000 }))).toBe(5000);
  });
  it('prefers units*price over manual value', () => {
    expect(assetValue(asset({ quantity: 2, pricePerUnit: 100, value: 999 }))).toBe(200);
  });
  it('is 0 when nothing is set', () => {
    expect(assetValue(asset({}))).toBe(0);
  });
});

describe('totalWealth', () => {
  it('sums asset values', () => {
    expect(totalWealth([asset({ value: 1000 }), asset({ quantity: 5, pricePerUnit: 200 })])).toBe(2000);
  });
  it('is 0 for empty', () => {
    expect(totalWealth([])).toBe(0);
  });
});

describe('groupByType', () => {
  it('groups in fixed order, omits empty, subtotals', () => {
    const g = groupByType([
      asset({ type: 'STOCK', value: 100 }),
      asset({ type: 'MUTUAL_FUND', value: 300 }),
      asset({ type: 'STOCK', value: 50 }),
    ]);
    expect(g.map((x) => x.type)).toEqual(['MUTUAL_FUND', 'STOCK']);
    expect(g[0].subtotal).toBe(300);
    expect(g[1].subtotal).toBe(150);
  });
});
