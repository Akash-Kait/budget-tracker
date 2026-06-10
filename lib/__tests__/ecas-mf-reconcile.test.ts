import { describe, it, expect } from 'vitest';
import { planMfImport, mfKey } from '@/lib/ecas/mf-reconcile';
import { mfParsedSchema, type ExistingMfAsset } from '@/lib/ecas/mf-types';

const ISIN = 'INF001A01011';
const AMFI = '120503';
// resolver: the feed maps our test ISIN → AMFI code; everything else unresolved (null).
const resolve = (isin: string) => (isin === ISIN ? AMFI : null);

function mf(p: Partial<ExistingMfAsset>): ExistingMfAsset {
  return {
    id: Math.random().toString(36).slice(2),
    type: 'MUTUAL_FUND',
    name: 'Fund',
    ticker: null,
    source: null,
    importKey: null,
    casStatus: null,
    costBasis: null,
    ...p,
  };
}
const parse = (holdings: object[], statementDate = '2026-04-30T00:00:00.000Z') =>
  mfParsedSchema.parse({ statementDate, holdings });
const holding = (over: object = {}) => ({
  isin: ISIN, name: 'Canara Robeco', folio: 'F1', units: 100, nav: 250.5, amountInvested: 22000, valuation: 25050, ...over,
});

describe('mfKey', () => {
  it('is folio-qualified, uppercased', () => {
    expect(mfKey('F1', 'inf001a01011')).toBe('F1|INF001A01011');
  });
});

describe('planMfImport — migration (existing CAS MF rows)', () => {
  it('bridges folio|amfi → folio|ISIN and CONVERTS in place (no duplicate)', () => {
    const existing = [mf({ id: 'c', source: 'CAS', importKey: 'F1|120503', ticker: '120503', costBasis: 21000 })];
    const r = planMfImport(existing, parse([holding()]), resolve);
    expect(r.creates).toHaveLength(0); // converted, never duplicated
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].id).toBe('c');
    expect(r.matched[0].isMigration).toBe(true);
    expect(r.matched[0].data).toMatchObject({ source: 'ECAS', importKey: 'F1|INF001A01011', ticker: ISIN, quantity: 100, value: 25050 });
    expect(r.blocked).toBe(false);
  });

  it('PRESERVES a stored cost basis and surfaces the discrepancy (never clobbers)', () => {
    const existing = [mf({ id: 'c', source: 'CAS', importKey: 'F1|120503', ticker: '120503', costBasis: 21000 })];
    const r = planMfImport(existing, parse([holding({ amountInvested: 22000 })]), resolve);
    expect(r.matched[0].data).not.toHaveProperty('costBasis'); // preserved, not overwritten
    expect(r.matched[0].costBasisDiscrepancy).toEqual({ stored: 21000, statement: 22000 });
  });

  it('fills cost basis from the eCAS amount invested when the stored basis is null', () => {
    const existing = [mf({ id: 'c', source: 'CAS', importKey: 'F1|120503', ticker: '120503', costBasis: null })];
    const r = planMfImport(existing, parse([holding({ amountInvested: 22000 })]), resolve);
    expect(r.matched[0].data.costBasis).toBe(22000);
    expect(r.matched[0].costBasisDiscrepancy).toBeNull();
  });

  // Half-migrated double-row conflict (deep-review P0): a CAS row AND an eCAS row already exist for
  // the SAME fund → converting one would orphan the other → silent double-count. Must block.
  it('BLOCKS when a folio holding maps to two different existing rows (CAS + eCAS for one fund)', () => {
    const existing = [
      mf({ id: 'cas', source: 'CAS', importKey: 'F1|120503', ticker: '120503', costBasis: 22000 }),
      mf({ id: 'ecas', source: 'ECAS', importKey: 'F1|INF001A01011', ticker: ISIN, costBasis: 22000 }),
    ];
    const r = planMfImport(existing, parse([holding()]), resolve);
    expect(r.matched).toHaveLength(0); // neither silently updated
    expect(r.creates).toHaveLength(0);
    expect(r.unmatchedBlocking[0]).toMatchObject({ isin: ISIN, folio: 'F1' });
    expect(r.flaggedAbsent).toHaveLength(0); // the orphan is NOT flagged absent (it's a conflict)
    expect(r.blocked).toBe(true);
  });

  // A manually-entered MF (no CAS) still triggers migration semantics — an unmatched folio fund must
  // NOT be auto-created (it could double-count the manual holding). migrationContext = any non-ECAS row.
  it('treats a pre-existing MANUAL MF row as a migration context (unmatched folio funds block, not create)', () => {
    const existing = [mf({ id: 'man', source: 'MANUAL', importKey: null, ticker: null, costBasis: 5000 })];
    const r = planMfImport(existing, parse([holding({ isin: 'INF777Z01099', name: 'New', folio: 'FX' })]), () => null);
    expect(r.migrationContext).toBe(true);
    expect(r.creates).toHaveLength(0);
    expect(r.unmatchedBlocking).toHaveLength(1);
    expect(r.blocked).toBe(true);
  });

  // THE named partial-match must-break
  it('a partial match (one ISIN not in the feed) BLOCKS apply and does NOT create the unmatched fund', () => {
    const existing = [
      mf({ id: 'c1', source: 'CAS', importKey: 'F1|120503', ticker: '120503', costBasis: 21000 }),
      mf({ id: 'c2', source: 'CAS', importKey: 'F2|999999', ticker: '999999', costBasis: 30000 }),
    ];
    const parsed = parse([
      holding(), // INF001A01011 → resolves → matches c1
      holding({ isin: 'INF777Z01099', name: 'Unresolvable Fund', folio: 'F2', units: 50, nav: 600, amountInvested: 28000, valuation: 30000 }), // not in feed
    ]);
    const r = planMfImport(existing, parsed, resolve);
    expect(r.matched.map((m) => m.id)).toEqual(['c1']); // only the resolved one matched
    expect(r.creates).toHaveLength(0); // the unmatched fund is NOT created — would double-count c2
    expect(r.unmatchedBlocking).toHaveLength(1);
    expect(r.unmatchedBlocking[0]).toMatchObject({ isin: 'INF777Z01099', folio: 'F2' });
    expect(r.blocked).toBe(true); // apply must be refused
  });
});

describe('planMfImport — first import (no prior CAS MF rows)', () => {
  it('CREATES an unmatched fund (the create path works when it should)', () => {
    const r = planMfImport([], parse([holding({ isin: 'INF777Z01099', name: 'New Fund' })]), () => null);
    expect(r.migrationContext).toBe(false);
    expect(r.creates).toHaveLength(1);
    expect(r.creates[0]).toMatchObject({ type: 'MUTUAL_FUND', ticker: 'INF777Z01099', source: 'ECAS', costBasis: 22000, value: 25050 });
    expect(r.blocked).toBe(false);
  });
});

describe('planMfImport — value check, idempotency, flag-absent', () => {
  it('flags a units×NAV vs Valuation mismatch (> ₹1) as a parse error and blocks apply', () => {
    const r = planMfImport([], parse([holding({ units: 100, nav: 250.5, valuation: 30000 })]), () => null);
    expect(r.valueErrors).toHaveLength(1); // 25050 ≠ 30000
    expect(r.creates).toHaveLength(0);
    expect(r.blocked).toBe(true);
  });

  // Coverage (deep-review P0): the sum of parsed valuations must tie to the statement Grand Total.
  it('BLOCKS when the parsed valuations do not tie to the Grand Total (a folio row silently dropped)', () => {
    const parsed = mfParsedSchema.parse({
      statementDate: '2026-04-30T00:00:00.000Z',
      grandTotalValuation: 50100, // statement says two funds…
      grandTotalInvested: 44000,
      holdings: [{ isin: ISIN, name: 'Canara', folio: 'F1', units: 100, nav: 250.5, amountInvested: 22000, valuation: 25050 }], // …but only one parsed
    });
    const r = planMfImport([], parsed, () => null);
    expect(r.coverage.folioMatches).toBe(false);
    expect(r.coverageBlocking).toBe(true);
    expect(r.blocked).toBe(true);
  });

  it('does NOT block on coverage when the parsed sum ties to the Grand Total (within ₹1)', () => {
    const parsed = mfParsedSchema.parse({
      statementDate: '2026-04-30T00:00:00.000Z',
      grandTotalValuation: 25050,
      grandTotalInvested: 22000,
      holdings: [{ isin: ISIN, name: 'Canara', folio: 'F1', units: 100, nav: 250.5, amountInvested: 22000, valuation: 25050 }],
    });
    const r = planMfImport([], parsed, () => null);
    expect(r.coverage.folioMatches).toBe(true);
    expect(r.coverageBlocking).toBe(false);
    expect(r.blocked).toBe(false);
  });

  it('does not apply a coverage check when no stated total is present (matches = null)', () => {
    const r = planMfImport([], parse([holding()]), () => null);
    expect(r.coverage.folioMatches).toBeNull();
    expect(r.coverageBlocking).toBe(false);
  });

  it('is idempotent once migrated (matches by folio|ISIN, no new create)', () => {
    const existing = [mf({ id: 'e', source: 'ECAS', importKey: 'F1|INF001A01011', ticker: ISIN, costBasis: 22000 })];
    const r = planMfImport(existing, parse([holding()]), resolve);
    expect(r.creates).toHaveLength(0);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].isMigration).toBe(false);
  });

  it('flags a fund absent from the statement (never deletes)', () => {
    const existing = [mf({ id: 'gone', source: 'ECAS', importKey: 'F9|INF999A01010', ticker: 'INF999A01010', casStatus: 'CURRENT' })];
    const r = planMfImport(existing, parse([holding()]), resolve);
    expect(r.flaggedAbsent).toEqual([{ id: 'gone', name: 'Fund' }]);
  });

  it('never imports a non-INF ISIN through the MF path', () => {
    const r = planMfImport([], parse([holding({ isin: 'INE001A01036' })]), () => null);
    expect(r.creates).toHaveLength(0);
    expect(r.matched).toHaveLength(0);
  });

  // Soft-hyphen must-break (defense in depth): a dirty ISIN reaching the reconcile must be re-cleaned,
  // resolve via the feed, and match — NOT fail the INF check and get silently flagged absent.
  it('re-cleans a soft-hyphen/zero-width-wrapped ISIN so a healthy fund resolves and matches', () => {
    const existing = [mf({ id: 'c', source: 'CAS', importKey: 'F1|120503', ticker: '120503', costBasis: 22000 })];
    const r = planMfImport(existing, parse([holding({ isin: 'INF001A01\u00ad\u200b011' })]), resolve);
    expect(r.matched.map((m) => m.id)).toEqual(['c']); // cleaned → resolved → migrated
    expect(r.matched[0].data).toMatchObject({ ticker: ISIN, importKey: 'F1|INF001A01011' });
    expect(r.unmatchedBlocking).toHaveLength(0); // NOT a false partial-match block
    expect(r.flaggedAbsent).toHaveLength(0); // NOT silently flagged absent
    expect(r.blocked).toBe(false);
  });
});

// Round 2 — own ALL mutual funds (folio + demat-held), with the overlap + total-coverage must-breaks.
describe('planMfImport — two sections (folio + demat-held)', () => {
  const DEMAT_ISIN = 'INF205KA1213';
  const demat = (over: object = {}) => ({
    isin: DEMAT_ISIN, name: 'INVESCO Focused', section: 'demat', boId: 'BO1',
    units: 100, nav: 28.37, amountInvested: null, valuation: 2837, ...over,
  });
  const parseMulti = (holdings: object[], extra: object = {}) =>
    mfParsedSchema.parse({ statementDate: '2026-04-30T00:00:00.000Z', holdings, ...extra });

  it('ingests a demat-held MF as value-only (no cost basis), keyed boId|ISIN', () => {
    const r = planMfImport([], parseMulti([demat()], { dematStatedTotal: 2837 }), () => null);
    expect(r.creates).toHaveLength(1);
    expect(r.creates[0]).toMatchObject({
      type: 'MUTUAL_FUND', ticker: DEMAT_ISIN, source: 'ECAS', costBasis: null, importKey: 'BO1|INF205KA1213',
      statementDate: '2026-04-30T00:00:00.000Z', // refresh-safe older-statement anchor is set
    });
    expect(r.coverage.dematMatches).toBe(true);
    expect(r.blocked).toBe(false);
  });

  // Output-key-uniqueness guard: two holdings resolving to the SAME importKey (e.g. unknown boId →
  // both `|ISIN`) must be stored ONCE and surfaced/blocked — never two creates that 500 at apply.
  it('BLOCKS when two holdings resolve to the same import key (no duplicate create)', () => {
    const dup = { isin: DEMAT_ISIN, name: 'X', section: 'demat', boId: '', units: 100, nav: 1, amountInvested: null, valuation: 100 };
    const r = planMfImport([], parseMulti([{ ...dup }, { ...dup }], { dematStatedTotal: 200 }), () => null);
    expect(r.creates).toHaveLength(1); // only one row claims the key
    expect(r.unmatchedBlocking.some((u) => u.reason.includes('duplicate import key'))).toBe(true);
    expect(r.blocked).toBe(true);
  });

  // storedTotal is measured from the EMITTED plan, so a (hypothetical) double-store would break the
  // total check even though the per-section residuals cancel. Here the clean case ties exactly.
  it('storedTotal reflects what is actually stored and ties to the overlap-adjusted anchor', () => {
    const parsed = parseMulti(
      [holding(), demat()],
      { grandTotalValuation: 25050, grandTotalInvested: 22000, dematStatedTotal: 2837 },
    );
    const r = planMfImport([], parsed, () => null);
    expect(r.coverage.storedTotal).toBe(27887); // 25050 (folio create) + 2837 (demat create)
    expect(r.coverage.expectedTotal).toBe(27887);
    expect(r.coverage.totalMatches).toBe(true);
  });

  it('imports folio + demat together; total ties to folio+demat (no overlap)', () => {
    const parsed = parseMulti(
      [holding(), demat()], // folio Canara 25050 (basis) + demat INVESCO 2837 (value-only)
      { grandTotalValuation: 25050, grandTotalInvested: 22000, dematStatedTotal: 2837 },
    );
    const r = planMfImport([], parsed, () => null);
    expect(r.creates).toHaveLength(2);
    expect(r.overlaps).toHaveLength(0);
    expect(r.coverage.folioMatches).toBe(true);
    expect(r.coverage.dematMatches).toBe(true);
    expect(r.coverage.storedTotal).toBe(27887);
    expect(r.coverage.totalMatches).toBe(true);
    expect(r.blocked).toBe(false);
  });

  it('blocks when the demat sub-class does not tie to its discrete stated total', () => {
    const r = planMfImport([], parseMulti([demat()], { dematStatedTotal: 5000 }), () => null);
    expect(r.coverage.dematMatches).toBe(false); // 2837 ≠ 5000 → a demat holding silently dropped
    expect(r.coverageBlocking).toBe(true);
    expect(r.blocked).toBe(true);
  });

  // THE overlap-coverage-consistency must-break: an ISIN in BOTH sections is stored ONCE (folio wins),
  // surfaced, and the stored total ties to folio+demat−overlap — NOT double-counted, NOT silently shrunk.
  it('stores an in-both fund once (folio), surfaces the overlap, and ties stored total to folio+demat−overlap', () => {
    const parsed = parseMulti(
      [
        holding(), // folio Canara INF001A01011, valuation 25050, basis 22000
        { isin: ISIN, name: 'Canara (demat)', section: 'demat', boId: 'BO1', units: 100, nav: 250.5, amountInvested: null, valuation: 25050 },
      ],
      { grandTotalValuation: 25050, grandTotalInvested: 22000, dematStatedTotal: 25050 },
    );
    const r = planMfImport([], parsed, () => null);
    expect(r.creates).toHaveLength(1); // folio only — demat copy dropped
    expect(r.creates[0]).toMatchObject({ importKey: 'F1|INF001A01011', costBasis: 22000 });
    expect(r.overlaps).toHaveLength(1);
    expect(r.overlaps[0]).toMatchObject({ isin: ISIN, folioValue: 25050, dematValueDropped: 25050 });
    expect(r.coverage.overlapDropped).toBe(25050);
    expect(r.coverage.folioMatches).toBe(true); // folio parsed 25050 vs stated 25050
    expect(r.coverage.dematMatches).toBe(true); // demat parsed 25050 vs stated 25050 (pre-dedup)
    expect(r.coverage.storedTotal).toBe(25050); // 25050 + (25050 − 25050 dropped)
    expect(r.coverage.expectedTotal).toBe(25050); // 25050 + 25050 − 25050
    expect(r.coverage.totalMatches).toBe(true);
    expect(r.blocked).toBe(false);
  });
});
