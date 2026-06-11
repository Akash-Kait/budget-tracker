import { describe, it, expect } from 'vitest';
import { planUnifiedImport, type UnifiedExisting } from '@/lib/ecas/unified-reconcile';
import { unifiedParsedSchema } from '@/lib/ecas/unified-types';

const STMT = '2026-05-31T00:00:00.000Z';

// A clean unified parse: 1 equity + 1 folio MF (basis) + 1 demat MF (value-only); every coverage
// anchor ties; row-accounting balanced (3 parsed = 1 equity + 1 folio + 1 demat).
const baseParsed = (over: Record<string, unknown> = {}) =>
  unifiedParsedSchema.parse({
    equity: {
      statementDate: STMT,
      equityStatedTotal: 500,
      accounts: [{ boId: 'BO1', holdings: [{ isin: 'INE001A01036', name: 'Acme Ltd # EQUITY', units: 5, price: 100, value: 500 }] }],
      unrecognized: [],
    },
    mf: {
      statementDate: STMT,
      grandTotalInvested: 22000,
      grandTotalValuation: 25050,
      dematStatedTotal: 2837,
      holdings: [
        { isin: 'INF001A01011', name: 'TPDG - quant ELSS - Direct Plan', section: 'folio', folio: 'F1', units: 100, nav: 250.5, amountInvested: 22000, valuation: 25050 },
        { isin: 'INF205KA1213', name: 'X#Y MF- Z FUND-DIRECT-GROWTH', section: 'demat', boId: 'BO1', units: 100, nav: 28.37, amountInvested: null, valuation: 2837 },
      ],
    },
    rowAccounting: { parsedRows: 3, equity: 1, folioMf: 1, dematMf: 1, unrecognized: 0, skipped: 0 },
    ...over,
  });

const noAmfi = () => null;

describe('planUnifiedImport — clean import', () => {
  it('fans out to both engines, balances, all coverage ties → not blocked', () => {
    const r = planUnifiedImport([], baseParsed(), noAmfi);
    expect(r.stock.creates).toHaveLength(1);
    expect(r.mf.creates).toHaveLength(2); // 1 folio + 1 demat
    expect(r.balance.ok).toBe(true);
    expect(r.equityCoverage.complete).toBe(true);
    expect(r.mf.coverageBlocking).toBe(false);
    expect(r.blocked).toBe(false);
  });
});

describe('planUnifiedImport — must-break 1: row-accounting balance across all 3 destinations', () => {
  it('BLOCKS when parsed rows do not equal the sum of the destination buckets (a row fell through)', () => {
    const parsed = baseParsed({ rowAccounting: { parsedRows: 4, equity: 1, folioMf: 1, dematMf: 1, unrecognized: 0, skipped: 0 } });
    const r = planUnifiedImport([], parsed, noAmfi);
    expect(r.balance.ok).toBe(false);
    expect(r.balance).toMatchObject({ parsedRows: 4, accountedRows: 3 });
    expect(r.blocked).toBe(true);
  });
});

describe('planUnifiedImport — must-break 3: every coverage check fires independently', () => {
  it('an EQUITY shortfall blocks the whole import (MF fine)', () => {
    const r = planUnifiedImport([], baseParsed({ equity: { statementDate: STMT, equityStatedTotal: 9999, accounts: [{ boId: 'BO1', holdings: [{ isin: 'INE001A01036', name: 'Acme', units: 5, price: 100, value: 500 }] }], unrecognized: [] } }), noAmfi);
    expect(r.equityCoverage.complete).toBe(false);
    expect(r.mf.coverageBlocking).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('a DEMAT-MF shortfall blocks the whole import (equity fine)', () => {
    const parsed = baseParsed();
    parsed.mf.dematStatedTotal = 5000; // 2837 parsed ≠ 5000 stated
    const r = planUnifiedImport([], parsed, noAmfi);
    expect(r.equityCoverage.complete).toBe(true);
    expect(r.mf.coverageBlocking).toBe(true);
    expect(r.blocked).toBe(true);
  });
});

describe('planUnifiedImport — single-class statements (gating holds when a class is absent)', () => {
  it('stocks-only eCAS imports cleanly (no MF holdings, no MF anchors → MF coverage non-blocking)', () => {
    const parsed = unifiedParsedSchema.parse({
      equity: { statementDate: STMT, equityStatedTotal: 500, accounts: [{ boId: 'BO1', holdings: [{ isin: 'INE001A01036', name: 'Acme', units: 5, price: 100, value: 500 }] }], unrecognized: [] },
      mf: { statementDate: STMT, holdings: [] },
      rowAccounting: { parsedRows: 1, equity: 1, folioMf: 0, dematMf: 0, unrecognized: 0, skipped: 0 },
    });
    const r = planUnifiedImport([], parsed, noAmfi);
    expect(r.stock.creates).toHaveLength(1);
    expect(r.mf.creates).toHaveLength(0);
    expect(r.mf.coverageBlocking).toBe(false);
    expect(r.blocked).toBe(false);
  });

  it('MFs-only eCAS imports cleanly (no equity holdings → equity coverage null, non-blocking)', () => {
    const parsed = unifiedParsedSchema.parse({
      equity: { statementDate: STMT, equityStatedTotal: null, accounts: [], unrecognized: [] },
      mf: {
        statementDate: STMT, grandTotalInvested: 22000, grandTotalValuation: 25050, dematStatedTotal: 2837,
        holdings: [
          { isin: 'INF001A01011', name: 'X - Direct Plan', section: 'folio', folio: 'F1', units: 100, nav: 250.5, amountInvested: 22000, valuation: 25050 },
          { isin: 'INF205KA1213', name: 'Y#Z MF- W FUND-DIRECT', section: 'demat', boId: 'BO1', units: 100, nav: 28.37, amountInvested: null, valuation: 2837 },
        ],
      },
      rowAccounting: { parsedRows: 2, equity: 0, folioMf: 1, dematMf: 1, unrecognized: 0, skipped: 0 },
    });
    const r = planUnifiedImport([], parsed, noAmfi);
    expect(r.stock.creates).toHaveLength(0);
    expect(r.equityCoverage.complete).toBeNull();
    expect(r.mf.creates).toHaveLength(2);
    expect(r.blocked).toBe(false);
  });
});

describe('planUnifiedImport — older-statement guard (both domains)', () => {
  const existing = (over: Partial<UnifiedExisting>): UnifiedExisting => ({
    id: 'e', type: 'STOCK', name: 'n', ticker: null, source: 'ECAS', importKey: 'k', casStatus: 'CURRENT',
    costBasis: null, priceUpdatedAt: null, statementDate: null, ...over,
  });
  it('blocks when this statement is older than an already-imported eCAS (stocks)', () => {
    const rows = [existing({ id: 's', type: 'STOCK', source: 'ECAS', priceUpdatedAt: '2026-06-30T00:00:00.000Z' })];
    const r = planUnifiedImport(rows, baseParsed(), noAmfi);
    expect(r.olderStatement.blocked).toBe(true);
    expect(r.blocked).toBe(true);
  });
  it('blocks when older than an already-imported eCAS (mutual funds, via statementDate)', () => {
    const rows = [existing({ id: 'm', type: 'MUTUAL_FUND', source: 'ECAS', statementDate: '2026-06-30T00:00:00.000Z' })];
    const r = planUnifiedImport(rows, baseParsed(), noAmfi);
    expect(r.olderStatement.blocked).toBe(true);
    expect(r.blocked).toBe(true);
  });
});
