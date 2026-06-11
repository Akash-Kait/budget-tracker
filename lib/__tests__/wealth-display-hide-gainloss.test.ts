import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetCostBasis, assetGainLoss } from '@/lib/wealth';
import type { WealthAsset } from '@/lib/types';

// The wealth UI is value-framed: NO gain/loss shown anywhere. No RTL/jsdom in this project (vitest is
// node-env), so the "no row renders gain/loss" guard is a source-level check — it asserts the rendered
// components carry no gain/loss display tokens (a regression tripwire against re-introduction). The
// data/math half is a real unit assertion that cost basis + the gain/loss functions are kept, dormant.
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('wealth UI hides gain/loss (display-only)', () => {
  it('the holding row renders value but NO gain/loss figure and NO "— not set"', () => {
    const src = read('components/wealth/WealthAssetRow.tsx');
    expect(src).not.toMatch(/GainLossText/); // the gain/loss display component is not used
    expect(src).not.toMatch(/assetGainLoss/); // no per-row gain/loss computed for display
    expect(src).not.toMatch(/not set/); // the "— not set" label is gone
    expect(src).toMatch(/assetValue\(asset\)/); // the row still shows the holding's value
  });

  it('the hero and KPI cards render no gain/loss display', () => {
    for (const f of ['components/wealth/HeroWealth.tsx', 'components/wealth/WealthKpiCards.tsx']) {
      const src = read(f);
      expect(src).not.toMatch(/GainLossText|assetGainLoss|totalGainLoss/);
    }
  });
});

describe('cost-basis data + gain/loss math are KEPT (hide, not delete — reversible)', () => {
  const asset = (over: Partial<WealthAsset>): WealthAsset => ({
    id: 'x', name: 'n', type: 'MUTUAL_FUND', ticker: null, quantity: null, pricePerUnit: null,
    value: null, lastPrice: null, priceUpdatedAt: null, priceSource: null, priceStatus: null,
    tickerName: null, source: null, importKey: null, casStatus: null, costBasis: null,
    displayName: 'n', purchaseDate: null, ...over,
  });

  it('cost basis is preserved through the model and the gain/loss math still computes (dormant)', () => {
    const a = asset({ costBasis: 1000, quantity: 10, pricePerUnit: 150 });
    expect(assetCostBasis(a)).toBe(1000); // data intact
    expect(assetGainLoss(a)).toEqual({ absolute: 500, pct: 50 }); // math intact, just not displayed
  });

  it('the costBasis + purchaseDate columns are NOT dropped from the schema', () => {
    const schema = read('prisma/schema.prisma');
    expect(schema).toMatch(/costBasis\s+Float\?/);
    expect(schema).toMatch(/purchaseDate\s+DateTime\?/);
  });
});
