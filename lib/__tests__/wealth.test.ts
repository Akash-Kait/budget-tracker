import { describe, it, expect } from 'vitest';
import {
  assetValue,
  totalWealth,
  groupByType,
  allocationByType,
  largestHolding,
  assetCostBasis,
  assetGainLoss,
  totalCostBasis,
  totalGainLoss,
  gainLossStatus,
  shortHoldingName,
  cleanMfName,
} from '@/lib/wealth';
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
    lastPrice: null,
    priceUpdatedAt: null,
    priceSource: null,
    priceStatus: null,
    tickerName: null,
    source: null,
    importKey: null,
    casStatus: null,
    costBasis: null,
    displayName: 'a',
    purchaseDate: null,
    ...p,
  };
}

describe('shortHoldingName (clean display name for charts)', () => {
  it('truncates real eCAS stock names at "#" or the separator dash', () => {
    expect(shortHoldingName('STATE BANK OF INDIA # NEW EQUITY SHARES OF FV RE. 1/- AFTER SUBDIVISION')).toBe('STATE BANK OF INDIA');
    expect(shortHoldingName('ADANI POWER LIMITED#NEW EQUITY SHARES WITH FACE VALUE RS.2/- AFTER SUB-DIVISION')).toBe('ADANI POWER LIMITED');
    expect(shortHoldingName('BAJAJ AUTO LIMITED - EQUITY SHARES')).toBe('BAJAJ AUTO LIMITED');
    expect(shortHoldingName('BHARTI AIRTEL LIMITED - EQUITY SHARES OF RE 5/- AFTER SUB-DIVISION')).toBe('BHARTI AIRTEL LIMITED');
    expect(shortHoldingName('ADANI PORTS AND SPECIAL ECONOMIC ZONE LIMITED- NEW EQUITY SHARES OF RS. 2/- AFTER SUB-DIVISION')).toBe('ADANI PORTS AND SPECIAL ECONOMIC ZONE LIMITED');
  });
  it('applies the same rule to MF (demat) names → the AMC name', () => {
    expect(shortHoldingName('SBI FUNDS MANAGEMENT LIMITED#SBI MF-SBI GOLD FUND DIRECT PL GROWTH')).toBe('SBI FUNDS MANAGEMENT LIMITED');
  });
  it('falls back to the FULL name when there is no delimiter', () => {
    expect(shortHoldingName('INFOSYS LIMITED EQUITY')).toBe('INFOSYS LIMITED EQUITY');
  });
  it('is the rule used for stocks (not MFs — those have their own rule)', () => {
    expect(shortHoldingName('INFOSYS LIMITED EQUITY')).toBe('INFOSYS LIMITED EQUITY');
  });
});

describe('cleanMfName (clean MF display name — code prefix + plan suffix stripped)', () => {
  it('folio MF names → the scheme name (leading code + trailing plan dropped, case preserved)', () => {
    expect(cleanMfName('TPDG - quant ELSS Tax Saver Fund - Direct Plan - Growth')).toBe('quant ELSS Tax Saver Fund');
    expect(cleanMfName('TSD1 - Mirae Asset ELSS Tax Saver Fund (formerly Mirae Asset Tax Saver Fund ) - Direct Plan')).toBe('Mirae Asset ELSS Tax Saver Fund');
    expect(cleanMfName('IBDG - quant Small Cap Fund - Direct Plan Growth')).toBe('quant Small Cap Fund');
    expect(cleanMfName('ETDG - Canara Robeco ELSS Tax Saver Fund - Direct Growth')).toBe('Canara Robeco ELSS Tax Saver Fund');
    expect(cleanMfName('8019 - ICICI Prudential Technology Fund - Direct Plan - Growth')).toBe('ICICI Prudential Technology Fund');
  });
  it('demat AMC#scheme names → the scheme after "#", "MF-" prefix + plan suffix dropped, title-cased', () => {
    expect(cleanMfName('MOTILAL OSWAL AMC LTD#MOTILAL OSWAL MF- MOTILAL OSWAL NIFTY 50 INDEX FUND-DIRECT-GROWTH')).toBe('Motilal Oswal Nifty 50 Index Fund');
    expect(cleanMfName('INVESCO AM (I) PVT LTD#INVESCO MF-INVESCO INDIA FOCUSED FUND-DIRECT-GROWTH')).toBe('Invesco India Focused Fund');
  });
  it('falls back to the full name on an odd/empty result', () => {
    expect(cleanMfName('Some Plain Fund Name')).toBe('Some Plain Fund Name');
  });
});

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

describe('assetCostBasis', () => {
  it('is null when unknown (never 0)', () => {
    expect(assetCostBasis(asset({}))).toBeNull();
  });
  it('returns the value when set, including 0', () => {
    expect(assetCostBasis(asset({ costBasis: 1000 }))).toBe(1000);
    expect(assetCostBasis(asset({ costBasis: 0 }))).toBe(0);
  });
});

describe('assetGainLoss', () => {
  it('is null when cost basis is unknown — distinct from a flat 0 result', () => {
    const r = assetGainLoss(asset({ value: 1000 }));
    expect(r).toBeNull();
  });
  it('reports a gain', () => {
    expect(assetGainLoss(asset({ value: 1200, costBasis: 1000 }))).toEqual({ absolute: 200, pct: 20 });
  });
  it('reports a loss', () => {
    expect(assetGainLoss(asset({ value: 800, costBasis: 1000 }))).toEqual({ absolute: -200, pct: -20 });
  });
  it('reports a flat position as zero (not null)', () => {
    expect(assetGainLoss(asset({ value: 1000, costBasis: 1000 }))).toEqual({ absolute: 0, pct: 0 });
  });
  it('guards zero cost basis: absolute = value, pct null', () => {
    expect(assetGainLoss(asset({ value: 500, costBasis: 0 }))).toEqual({ absolute: 500, pct: null });
  });
  it('uses qty×price for current value', () => {
    expect(assetGainLoss(asset({ quantity: 10, pricePerUnit: 150, costBasis: 1000 }))).toEqual({
      absolute: 500,
      pct: 50,
    });
  });
  it('uses manual value for current value', () => {
    expect(assetGainLoss(asset({ value: 1500, costBasis: 1000 }))).toEqual({ absolute: 500, pct: 50 });
  });
});

describe('totalCostBasis', () => {
  it('is null when no asset has a cost basis', () => {
    expect(totalCostBasis([asset({ value: 100 }), asset({ value: 200 })])).toBeNull();
  });
  it('sums known cost bases in a mixed portfolio', () => {
    expect(totalCostBasis([asset({ costBasis: 1000 }), asset({}), asset({ costBasis: 500 })])).toBe(1500);
  });
});

describe('totalGainLoss', () => {
  it('is null when no asset has a cost basis', () => {
    expect(totalGainLoss([asset({ value: 100 })])).toBeNull();
  });
  it('aggregates only the covered subset of a mixed portfolio', () => {
    // covered: value 1200 basis 1000, and value 900 basis 1000 → abs 100, basis 2000 → 5%
    // the no-basis asset (value 9999) is excluded.
    const r = totalGainLoss([
      asset({ value: 1200, costBasis: 1000 }),
      asset({ value: 9999 }),
      asset({ value: 900, costBasis: 1000 }),
    ]);
    expect(r).toEqual({ absolute: 100, pct: 5 });
  });
  it('guards zero total cost basis', () => {
    expect(totalGainLoss([asset({ value: 500, costBasis: 0 })])).toEqual({ absolute: 500, pct: null });
  });
});

describe('gainLossStatus (gain / loss / none)', () => {
  it('a no-cost-basis holding (e.g. an imported eCAS stock) is "none"', () => {
    expect(gainLossStatus(asset({ quantity: 5, pricePerUnit: 9997.75, costBasis: null }))).toBe('none');
  });
  it('holdings WITH a cost basis show gain/loss', () => {
    expect(gainLossStatus(asset({ quantity: 10, pricePerUnit: 150, costBasis: 1000 }))).toBe('gain'); // 1500 > 1000
    expect(gainLossStatus(asset({ quantity: 10, pricePerUnit: 50, costBasis: 1000 }))).toBe('loss'); // 500 < 1000
  });
});
