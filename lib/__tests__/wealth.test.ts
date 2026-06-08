import { describe, it, expect } from 'vitest';
import { assetValue, totalWealth, groupByType, allocationByType, largestHolding } from '@/lib/wealth';
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

describe('allocationByType', () => {
  it('computes value and percentage per type in fixed order, omitting empty', () => {
    const a = allocationByType([
      asset({ type: 'STOCK', value: 250 }),
      asset({ type: 'MUTUAL_FUND', value: 750 }),
    ]);
    expect(a.map((x) => x.type)).toEqual(['MUTUAL_FUND', 'STOCK']);
    expect(a[0]).toMatchObject({ value: 750, pct: 75 });
    expect(a[1]).toMatchObject({ value: 250, pct: 25 });
  });
  it('is empty for no assets', () => {
    expect(allocationByType([])).toEqual([]);
  });
});

describe('largestHolding', () => {
  it('returns the highest-value asset', () => {
    const big = asset({ name: 'Big', value: 9000 });
    expect(largestHolding([asset({ value: 100 }), big, asset({ value: 500 })])).toBe(big);
  });
  it('is null when empty', () => {
    expect(largestHolding([])).toBeNull();
  });
});
