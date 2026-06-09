import { describe, it, expect } from 'vitest';
import { reconcile, schemeKey } from '@/lib/cas/reconcile';
import { casParsedSchema, type ExistingAsset } from '@/lib/cas/types';
import sample from '@/lib/__tests__/fixtures/cas-sample.json';

const parsed = casParsedSchema.parse(sample);

// Minimal existing-asset factory.
function asset(p: Partial<ExistingAsset>): ExistingAsset {
  return {
    id: Math.random().toString(36).slice(2),
    type: 'MUTUAL_FUND',
    name: 'x',
    ticker: null,
    source: null,
    importKey: null,
    casStatus: null,
    costBasis: null,
    ...p,
  };
}

describe('schemeKey (folio-qualified so two folios of one fund stay distinct)', () => {
  it('is folio + AMFI code when present', () => {
    expect(schemeKey({ amfi: '120503', isin: 'INF1', folio: 'F1', name: 'X' })).toBe('F1|120503');
  });
  it('uses ISIN before name when no AMFI code (names drift between statements)', () => {
    expect(schemeKey({ amfi: null, isin: 'INF9', folio: 'F1', name: 'Old Scheme' })).toBe('F1|INF9');
  });
  it('falls back to name only when neither AMFI nor ISIN is present', () => {
    expect(schemeKey({ amfi: null, isin: null, folio: 'F1', name: 'Old Scheme' })).toBe('F1|Old Scheme');
  });
});

describe('reconcile', () => {
  it('creates new MF rows for unmatched schemes (source CAS, ticker = AMFI code)', () => {
    const r = reconcile([], parsed);
    expect(r.creates).toHaveLength(3);
    expect(r.updates).toHaveLength(0);
    const flexi = r.creates.find((c) => c.importKey === 'REDACTED-1|120503')!;
    expect(flexi).toMatchObject({
      type: 'MUTUAL_FUND',
      ticker: '120503', // bare AMFI code for revaluation; importKey is folio-qualified
      quantity: 1234.567,
      pricePerUnit: 89.1234,
      priceSource: 'CAS',
      source: 'CAS',
      casStatus: 'CURRENT',
      costBasis: 90000,
    });
    expect(flexi.priceUpdatedAt).toBe('2025-05-30T00:00:00.000Z');
  });

  it('cost basis is null when the CAS omits it, set when present', () => {
    const r = reconcile([], parsed);
    expect(r.creates.find((c) => c.importKey === 'REDACTED-2|118989')!.costBasis).toBeNull();
    expect(r.creates.find((c) => c.importKey === 'REDACTED-1|120503')!.costBasis).toBe(90000);
  });

  it('updates an existing CAS row by importKey — no duplicate created', () => {
    const existing = [asset({ id: 'a', source: 'CAS', importKey: 'REDACTED-1|120503', ticker: '120503' })];
    const r = reconcile(existing, parsed);
    expect(r.creates.find((c) => c.importKey === 'REDACTED-1|120503')).toBeUndefined();
    const upd = r.updates.find((u) => u.id === 'a')!;
    expect(upd.data).toMatchObject({ quantity: 1234.567, pricePerUnit: 89.1234, casStatus: 'CURRENT' });
  });

  it('matches a scheme without an AMFI code by folio|ISIN', () => {
    const existing = [asset({ id: 'old', source: 'CAS', importKey: 'REDACTED-3|INF000XX0003' })];
    const r = reconcile(existing, parsed);
    expect(r.updates.some((u) => u.id === 'old')).toBe(true);
    expect(r.creates.some((c) => c.importKey.startsWith('REDACTED-3|'))).toBe(false);
  });

  it('flags a CAS-sourced holding absent from this statement — never deletes it', () => {
    const existing = [asset({ id: 'gone', source: 'CAS', importKey: '999999', name: 'Sold Fund' })];
    const r = reconcile(existing, parsed);
    expect(r.flaggedAbsent).toEqual([{ id: 'gone', name: 'Sold Fund' }]);
    // nothing in creates/updates removes it
    expect(r.creates.some((c) => c.importKey === '999999')).toBe(false);
  });

  it('does not re-flag an already-ABSENT row (avoids redundant writes)', () => {
    const existing = [asset({ id: 'gone', source: 'CAS', importKey: '999999', casStatus: 'ABSENT' })];
    expect(reconcile(existing, parsed).flaggedAbsent).toHaveLength(0);
  });

  it('never touches STOCK / OTHER rows', () => {
    const existing = [
      asset({ id: 's', type: 'STOCK', ticker: '120503', source: 'CAS', importKey: '120503' }),
      asset({ id: 'o', type: 'OTHER', source: 'CAS', importKey: '999999' }),
    ];
    const r = reconcile(existing, parsed);
    expect(r.updates.some((u) => u.id === 's')).toBe(false); // STOCK with same code untouched
    expect(r.flaggedAbsent.some((f) => f.id === 'o')).toBe(false); // OTHER not flagged
    expect(r.creates).toHaveLength(3); // all three schemes created fresh
  });

  it('adopts a manual MF matched by ticker as a MERGE — preserves user costBasis & name', () => {
    const existing = [
      asset({ id: 'm', source: null, ticker: '120503', name: 'My Custom Name', costBasis: 75000 }),
    ];
    const r = reconcile(existing, parsed);
    const upd = r.updates.find((u) => u.id === 'm')!;
    expect(upd).toBeTruthy();
    // units/source/key updated… (importKey becomes the folio-qualified key)
    expect(upd.data).toMatchObject({ quantity: 1234.567, source: 'CAS', importKey: 'REDACTED-1|120503', casStatus: 'CURRENT' });
    // …but user-entered fields are NOT overwritten (merge, not wipe-and-replace)
    expect(upd.data).not.toHaveProperty('costBasis');
    expect(upd.data).not.toHaveProperty('name');
    expect(r.creates.some((c) => c.importKey === 'REDACTED-1|120503')).toBe(false); // adopted, not duplicated
  });

  it('an existing CAS row update never nulls a cost basis the CAS omits', () => {
    const existing = [asset({ id: 'b', source: 'CAS', importKey: 'REDACTED-2|118989', ticker: '118989', costBasis: 60000 })];
    const upd = reconcile(existing, parsed).updates.find((u) => u.id === 'b')!;
    expect(upd.data.costBasis).toBe(60000); // 118989 has cost:null in the fixture → preserved
  });

  it('keeps the same AMFI code in two folios as DISTINCT holdings (P0-2)', () => {
    const twoFolios = casParsedSchema.parse({
      statementDate: '2025-05-31',
      schemes: [
        { amfi: '120503', isin: 'INF1', folio: 'F1', name: 'Flexi', units: 100, nav: 50, navDate: '2025-05-30' },
        { amfi: '120503', isin: 'INF1', folio: 'F2', name: 'Flexi', units: 200, nav: 50, navDate: '2025-05-30' },
      ],
    });
    const r = reconcile([], twoFolios);
    expect(r.creates).toHaveLength(2);
    expect(new Set(r.creates.map((c) => c.importKey))).toEqual(new Set(['F1|120503', 'F2|120503']));
    expect(r.creates.every((c) => c.ticker === '120503')).toBe(true); // both revalue via the bare code
    // re-import the same two folios → both match by importKey, no dupes, none flagged
    const existing = r.creates.map((c, i) =>
      asset({ id: `r${i}`, source: 'CAS', importKey: c.importKey, ticker: '120503' }),
    );
    const second = reconcile(existing, twoFolios);
    expect(second.creates).toHaveLength(0);
    expect(second.flaggedAbsent).toHaveLength(0);
    expect(second.updates).toHaveLength(2);
  });

  it('never nulls an existing price/quantity when the CAS scheme lacks them (P1-2)', () => {
    const noNav = casParsedSchema.parse({
      statementDate: '2025-05-31',
      schemes: [{ amfi: '120503', isin: 'INF1', folio: 'REDACTED-1', name: 'Flexi', units: null, nav: null, navDate: null }],
    });
    const existing = [asset({ id: 'a', source: 'CAS', importKey: 'REDACTED-1|120503', ticker: '120503' })];
    const upd = reconcile(existing, noNav).updates.find((u) => u.id === 'a')!;
    expect(upd.data).not.toHaveProperty('pricePerUnit'); // would otherwise zero the holding
    expect(upd.data).not.toHaveProperty('priceUpdatedAt');
    expect(upd.data).not.toHaveProperty('quantity');
    expect(upd.data).toMatchObject({ source: 'CAS', casStatus: 'CURRENT' });
  });

  it('does not create a unit-less phantom holding (P1-2 defensive)', () => {
    const ghost = casParsedSchema.parse({
      statementDate: '2025-05-31',
      schemes: [{ amfi: '999', isin: 'INF9', folio: 'FX', name: 'Ghost', units: null, nav: null, navDate: null }],
    });
    expect(reconcile([], ghost).creates).toHaveLength(0);
  });

  it('is idempotent — applying, then reconciling again, yields no creates and no new flags', () => {
    // First import (empty app) → creates. Simulate the resulting rows, then re-import the same CAS.
    const first = reconcile([], parsed);
    const afterImport: ExistingAsset[] = first.creates.map((c, i) => ({
      id: `row${i}`,
      type: 'MUTUAL_FUND',
      name: c.name,
      ticker: c.ticker,
      source: 'CAS',
      importKey: c.importKey,
      casStatus: 'CURRENT',
      costBasis: c.costBasis,
    }));
    const second = reconcile(afterImport, parsed);
    expect(second.creates).toHaveLength(0); // no duplicates
    expect(second.flaggedAbsent).toHaveLength(0); // everything still present
    expect(second.updates).toHaveLength(3); // just refreshes the same rows
  });
});
