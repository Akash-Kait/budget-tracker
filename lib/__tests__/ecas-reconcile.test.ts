import { describe, it, expect } from 'vitest';
import { reconcile, stockKey } from '@/lib/ecas/reconcile';
import { ecasParsedSchema, type ExistingStockAsset, type EcasParsed } from '@/lib/ecas/types';
import sample from '@/lib/__tests__/fixtures/ecas-sample.json';

const parsed = ecasParsedSchema.parse(sample);

function stock(p: Partial<ExistingStockAsset>): ExistingStockAsset {
  return {
    id: Math.random().toString(36).slice(2),
    type: 'STOCK',
    name: 'x',
    ticker: null,
    source: null,
    importKey: null,
    casStatus: null,
    costBasis: null,
    ...p,
  };
}

describe('stockKey', () => {
  it('is folio/account-qualified (boId|isin)', () => {
    expect(stockKey('BO-A', 'INE001A01036')).toBe('BO-A|INE001A01036');
  });
});

describe('reconcile (eCAS stocks)', () => {
  it('creates STOCK rows per boId|isin; ticker=bare ISIN; NO cost basis; statement-date price', () => {
    const r = reconcile([], parsed);
    expect(r.creates).toHaveLength(3); // BO-A:2 + BO-B:1
    expect(new Set(r.creates.map((c) => c.importKey))).toEqual(
      new Set(['BO-A|INE001A01036', 'BO-A|INE002B01018', 'BO-B|INE001A01036']),
    );
    const acme = r.creates.find((c) => c.importKey === 'BO-A|INE001A01036')!;
    expect(acme).toMatchObject({
      type: 'STOCK',
      ticker: 'INE001A01036',
      quantity: 100,
      pricePerUnit: 250.5,
      priceSource: 'ECAS',
      source: 'ECAS',
      casStatus: 'CURRENT',
      costBasis: null, // eCAS has no cost column — never a basis (decision #4)
      priceUpdatedAt: '2026-05-31T00:00:00.000Z',
    });
  });

  // (a) — the double-count guard
  it('NEVER imports INF* (mutual funds) or non-INE ISINs, even if a producer leaks them', () => {
    const leaky = ecasParsedSchema.parse({
      statementDate: '2026-05-31',
      accounts: [
        {
          boId: 'BO-A',
          holdings: [
            { isin: 'INE001A01036', name: 'Equity', units: 1, price: 1, value: 1 },
            { isin: 'INF179K01608', name: 'MF leaked into accounts', units: 9, price: 9, value: 81 },
            { isin: 'IN0020230011', name: 'Govt leaked', units: 9, price: 9, value: 81 },
          ],
        },
      ],
      unrecognized: [],
    });
    const r = reconcile([], leaky);
    expect(r.creates).toHaveLength(1);
    expect(r.creates[0].ticker).toBe('INE001A01036');
    expect(r.creates.some((c) => c.ticker.startsWith('INF') || c.ticker.startsWith('IN0'))).toBe(false);
  });

  // (i) — the named must-break case: same ISIN in two BO IDs, dropped from one
  it('flags ONLY the dropped account when the same ISIN is held in two BO IDs', () => {
    const existing = [
      stock({ id: 'a', source: 'ECAS', importKey: 'BO-A|INE001A01036', ticker: 'INE001A01036', casStatus: 'CURRENT' }),
      stock({ id: 'b', source: 'ECAS', importKey: 'BO-B|INE001A01036', ticker: 'INE001A01036', casStatus: 'CURRENT' }),
    ];
    // New statement: BO-A still holds it, BO-B dropped it entirely.
    const dropped = ecasParsedSchema.parse({
      statementDate: '2026-06-30',
      accounts: [{ boId: 'BO-A', holdings: [{ isin: 'INE001A01036', name: 'Acme', units: 100, price: 260, value: 26000 }] }],
      unrecognized: [],
    });
    const r = reconcile(existing, dropped);
    expect(r.flaggedAbsent).toEqual([{ id: 'b', name: 'x' }]); // ONLY BO-B's row
    expect(r.updates.some((u) => u.id === 'a')).toBe(true); // BO-A updated, never flagged
    expect(r.flaggedAbsent.some((f) => f.id === 'a')).toBe(false);
    // and BO-B's row is flagged, NOT deleted (reconcile never deletes)
  });

  // (b) — Nil-Holding BO ID
  it('flags every stock of an emptied (Nil-Holding) demat account, never deletes', () => {
    const existing = [
      stock({ id: 'x', source: 'ECAS', importKey: 'BO-C|INE009X01010', ticker: 'INE009X01010', casStatus: 'CURRENT' }),
    ];
    const r = reconcile(existing, parsed); // statement has BO-A/BO-B only — BO-C is gone
    expect(r.flaggedAbsent).toEqual([{ id: 'x', name: 'x' }]);
  });

  it('does not re-flag an already-ABSENT stock', () => {
    const existing = [stock({ id: 'x', source: 'ECAS', importKey: 'BO-Z|INE009X01010', casStatus: 'ABSENT' })];
    expect(reconcile(existing, parsed).flaggedAbsent).toHaveLength(0);
  });

  // (c) — adoption MERGES
  it('adopts a manual stock by ISIN as a MERGE — preserves user costBasis & name', () => {
    const existing = [
      stock({ id: 'm', source: null, ticker: 'INE002B01018', name: 'My Beta', costBasis: 30000 }),
    ];
    const r = reconcile(existing, parsed);
    const upd = r.updates.find((u) => u.id === 'm')!;
    expect(upd.data).toMatchObject({ quantity: 40, source: 'ECAS', importKey: 'BO-A|INE002B01018', casStatus: 'CURRENT' });
    expect(upd.data).not.toHaveProperty('costBasis'); // user basis preserved
    expect(upd.data).not.toHaveProperty('name'); // user name preserved
    expect(r.creates.some((c) => c.importKey === 'BO-A|INE002B01018')).toBe(false); // adopted, not duped
  });

  // (d) — idempotent
  it('is idempotent — re-import yields no creates, no new flags', () => {
    const first = reconcile([], parsed);
    const afterImport: ExistingStockAsset[] = first.creates.map((c, i) => ({
      id: `r${i}`, type: 'STOCK', name: c.name, ticker: c.ticker,
      source: 'ECAS', importKey: c.importKey, casStatus: 'CURRENT', costBasis: null,
    }));
    const second = reconcile(afterImport, parsed);
    expect(second.creates).toHaveLength(0);
    expect(second.flaggedAbsent).toHaveLength(0);
    expect(second.updates).toHaveLength(3);
  });

  // deep-review BUG 1 — per-account adoption must not cross accounts via the bare-ISIN fallback
  it('adopts a manual row under ONE account; the other account creates its own row (no cross-account merge)', () => {
    const existing = [stock({ id: 'm', source: null, ticker: 'INE001A01036', name: 'My Acme', costBasis: 50000 })];
    const twoAccts = ecasParsedSchema.parse({
      statementDate: '2026-05-31',
      accounts: [
        { boId: 'BO-A', holdings: [{ isin: 'INE001A01036', name: 'Acme', units: 100, price: 250, value: 25000 }] },
        { boId: 'BO-B', holdings: [{ isin: 'INE001A01036', name: 'Acme', units: 60, price: 250, value: 15000 }] },
      ],
      unrecognized: [],
    });
    const r = reconcile(existing, twoAccts);
    // exactly ONE row adopted (the manual row), under exactly one account
    expect(r.updates).toHaveLength(1);
    expect(r.updates[0].id).toBe('m');
    const adoptedKey = r.updates[0].data.importKey;
    expect(['BO-A|INE001A01036', 'BO-B|INE001A01036']).toContain(adoptedKey);
    // the OTHER account creates its own row (no row updated under the wrong boId)
    expect(r.creates).toHaveLength(1);
    expect(r.creates[0].importKey).not.toBe(adoptedKey);
    expect(['BO-A|INE001A01036', 'BO-B|INE001A01036']).toContain(r.creates[0].importKey);
  });

  it('an existing ECAS row is never matched by bare ISIN across accounts (BO-B cannot overwrite BO-A)', () => {
    const existing = [
      stock({ id: 'a', source: 'ECAS', importKey: 'BO-A|INE001A01036', ticker: 'INE001A01036', casStatus: 'CURRENT' }),
    ];
    // statement holds the same ISIN under a DIFFERENT account only
    const onlyB = ecasParsedSchema.parse({
      statementDate: '2026-06-30',
      accounts: [{ boId: 'BO-B', holdings: [{ isin: 'INE001A01036', name: 'Acme', units: 9, price: 9, value: 81 }] }],
      unrecognized: [],
    });
    const r = reconcile(existing, onlyB);
    expect(r.updates.some((u) => u.id === 'a')).toBe(false); // BO-A row NOT touched by BO-B data
    expect(r.creates).toHaveLength(1); // BO-B creates its own
    expect(r.flaggedAbsent).toEqual([{ id: 'a', name: 'x' }]); // BO-A|X absent → flagged
  });

  // deep-review BUG 2 — an adopted manual row must be flag-absent-eligible once it's ECAS-tracked
  it('an adopted manual holding is flagged ABSENT when a later statement drops it', () => {
    // import 1: adopt the manual row → it becomes source ECAS with importKey BO-A|X
    const manual = [stock({ id: 'm', source: null, ticker: 'INE001A01036', name: 'My Acme', costBasis: 50000 })];
    const stmt1 = ecasParsedSchema.parse({
      statementDate: '2026-05-31',
      accounts: [{ boId: 'BO-A', holdings: [{ isin: 'INE001A01036', name: 'Acme', units: 100, price: 250, value: 25000 }] }],
      unrecognized: [],
    });
    const r1 = reconcile(manual, stmt1);
    const adopt = r1.updates.find((u) => u.id === 'm')!;
    expect(adopt.data.source).toBe('ECAS'); // source flips → persisted by the route

    // simulate the persisted row, then import 2 drops the holding entirely
    const afterAdopt = [
      stock({ id: 'm', source: adopt.data.source as string, importKey: adopt.data.importKey as string, ticker: 'INE001A01036', name: 'My Acme', costBasis: 50000, casStatus: 'CURRENT' }),
    ];
    const stmt2 = ecasParsedSchema.parse({ statementDate: '2026-06-30', accounts: [], unrecognized: [] });
    expect(reconcile(afterAdopt, stmt2).flaggedAbsent).toEqual([{ id: 'm', name: 'My Acme' }]);
  });

  // deep-review GAP — a matched holding with null units surfaces visibly, never a silent stale-keep
  it('a matched holding parsed with null units is surfaced as incomplete, not silently kept', () => {
    const noUnits = ecasParsedSchema.parse({
      statementDate: '2026-05-31',
      accounts: [{ boId: 'BO-A', holdings: [{ isin: 'INE001A01036', name: 'Acme', units: null, price: 250, value: null }] }],
      unrecognized: [],
    });
    const existing = [stock({ id: 'a', source: 'ECAS', importKey: 'BO-A|INE001A01036', ticker: 'INE001A01036', casStatus: 'CURRENT' })];
    const r = reconcile(existing, noUnits);
    expect(r.incomplete).toEqual([{ isin: 'INE001A01036', name: 'Acme' }]);
    expect(r.updates.some((u) => u.id === 'a')).toBe(false); // not updated with stale/partial data
    expect(r.flaggedAbsent.some((f) => f.id === 'a')).toBe(false); // present (unreadable) → NOT flagged absent
  });

  it('derives price from market value when the price column is missing', () => {
    const noPrice = ecasParsedSchema.parse({
      statementDate: '2026-05-31',
      accounts: [{ boId: 'BO-A', holdings: [{ isin: 'INE001A01036', name: 'Acme', units: 100, price: null, value: 25050 }] }],
      unrecognized: [],
    });
    expect(reconcile([], noPrice).creates[0].pricePerUnit).toBe(250.5); // 25050 / 100
  });

  // deep-review probe 1 — three accounts, same adopted ISIN: exactly ONE adopts, the other TWO create
  it('with the same ISIN in THREE accounts, one manual row adopts once and the other two create', () => {
    const existing = [stock({ id: 'm', source: null, ticker: 'INE001A01036', name: 'My Acme', costBasis: 1 })];
    const three = ecasParsedSchema.parse({
      statementDate: '2026-05-31',
      accounts: ['BO-A', 'BO-B', 'BO-C'].map((boId) => ({
        boId,
        holdings: [{ isin: 'INE001A01036', name: 'Acme', units: 10, price: 250, value: 2500 }],
      })),
      unrecognized: [],
    });
    const r = reconcile(existing, three);
    expect(r.updates).toHaveLength(1); // exactly one adopt
    expect(r.creates).toHaveLength(2); // the other two accounts each create (no silent failure)
    const keys = [r.updates[0].data.importKey, ...r.creates.map((c) => c.importKey)];
    expect(new Set(keys)).toEqual(new Set(['BO-A|INE001A01036', 'BO-B|INE001A01036', 'BO-C|INE001A01036']));
  });

  // deep-review probe 2 — incomplete is "present" (not flag-absent) but NOT a successful import
  it('a NEW incomplete holding is surfaced, not created, and not counted as imported', () => {
    const r = reconcile(
      [],
      ecasParsedSchema.parse({
        statementDate: '2026-05-31',
        accounts: [{ boId: 'BO-A', holdings: [{ isin: 'INE001A01036', name: 'Acme', units: null, price: 250, value: null }] }],
        unrecognized: [],
      }),
    );
    expect(r.incomplete).toEqual([{ isin: 'INE001A01036', name: 'Acme' }]);
    expect(r.creates).toHaveLength(0); // present-for-flag-absent ≠ imported; never counted as created
    expect(r.updates).toHaveLength(0);
  });

  // deep-review probe 3 — derive must NEVER yield a price when value is null or 0 (no 0/NaN)
  it('a holding with no price and null/zero value is incomplete — never a ₹0/NaN price', () => {
    for (const value of [null, 0]) {
      const r = reconcile(
        [],
        ecasParsedSchema.parse({
          statementDate: '2026-05-31',
          accounts: [{ boId: 'BO-A', holdings: [{ isin: 'INE001A01036', name: 'Acme', units: 100, price: null, value }] }],
          unrecognized: [],
        }),
      );
      expect(r.creates).toHaveLength(0);
      expect(r.incomplete).toEqual([{ isin: 'INE001A01036', name: 'Acme' }]);
    }
  });

  // deep-review round 2, P0 — a duplicate boId|isin within ONE statement must not double-create
  it('dedupes a duplicate boId|isin within one statement (first occurrence wins, never two rows)', () => {
    const dup = ecasParsedSchema.parse({
      statementDate: '2026-05-31',
      accounts: [{ boId: 'BO-A', holdings: [
        { isin: 'INE001A01036', name: 'Acme', units: 100, price: 250, value: 25000 },
        { isin: 'INE001A01036', name: 'Acme (reprint)', units: 40, price: 250, value: 10000 },
      ]}],
      unrecognized: [],
    });
    const r = reconcile([], dup);
    expect(r.creates).toHaveLength(1);
    expect(r.creates[0].quantity).toBe(100); // first line wins
    // against an existing ECAS row: at most one update, never update+create for the same key
    const existing = [stock({ id: 'a', source: 'ECAS', importKey: 'BO-A|INE001A01036', ticker: 'INE001A01036', casStatus: 'CURRENT' })];
    const r2 = reconcile(existing, dup);
    expect(r2.creates).toHaveLength(0);
    expect(r2.updates.filter((u) => u.id === 'a')).toHaveLength(1);
  });

  // deep-review round 2, P1 — adoption must match a manual ticker that differs only in case/whitespace
  it('adopts a manual row whose ticker differs from the statement ISIN only in case/whitespace', () => {
    const existing = [stock({ id: 'm', source: null, ticker: ' ine001a01036 ', name: 'My Acme', costBasis: 5000 })];
    const r = reconcile(existing, ecasParsedSchema.parse({
      statementDate: '2026-05-31',
      accounts: [{ boId: 'BO-A', holdings: [{ isin: 'INE001A01036', name: 'Acme', units: 100, price: 250, value: 25000 }] }],
      unrecognized: [],
    }));
    expect(r.updates.map((u) => u.id)).toEqual(['m']); // adopted (costBasis preserved), not duplicated
    expect(r.creates).toHaveLength(0);
  });

  // deep-review round 2, P1 — two manual rows of one ISIN: each adoptable by a distinct account, none orphaned
  it('with two manual rows of the same ISIN held in two accounts, both adopt (no orphan, no phantom create)', () => {
    const existing = [
      stock({ id: 'm1', source: null, ticker: 'INE001A01036', name: 'lot 1', costBasis: 5000 }),
      stock({ id: 'm2', source: null, ticker: 'INE001A01036', name: 'lot 2', costBasis: 7000 }),
    ];
    const two = ecasParsedSchema.parse({
      statementDate: '2026-05-31',
      accounts: [
        { boId: 'BO-A', holdings: [{ isin: 'INE001A01036', name: 'Acme', units: 100, price: 250, value: 25000 }] },
        { boId: 'BO-B', holdings: [{ isin: 'INE001A01036', name: 'Acme', units: 60, price: 250, value: 15000 }] },
      ],
      unrecognized: [],
    });
    const r = reconcile(existing, two);
    expect(new Set(r.updates.map((u) => u.id))).toEqual(new Set(['m1', 'm2'])); // both adopted
    expect(r.creates).toHaveLength(0); // neither orphaned into a phantom create
  });

  // deep-review round 2, P3 — defense-in-depth: a producer that BYPASSES Zod (Zod rejects non-finite,
  // so we construct EcasParsed directly) must still never get a NaN/Infinity into a created row.
  it('surfaces NaN/Infinity units or price as incomplete — never a non-finite stored value', () => {
    for (const [units, price, value] of [[NaN, 250, 25000], [Infinity, null, 25000], [100, Infinity, null], [100, NaN, null]] as const) {
      const parsed = {
        statementDate: '2026-05-31',
        accounts: [{ boId: 'BO-A', holdings: [{ isin: 'INE001A01036', name: 'Acme', units, price, value }] }],
        unrecognized: [],
      } as unknown as EcasParsed;
      const r = reconcile([], parsed);
      expect(r.creates).toHaveLength(0); // nothing finite to create
      expect(r.incomplete).toEqual([{ isin: 'INE001A01036', name: 'Acme' }]);
    }
  });

  it('resurrects a previously-ABSENT row that reappears (casStatus → CURRENT)', () => {
    const existing = [
      stock({ id: 'a', source: 'ECAS', importKey: 'BO-A|INE001A01036', ticker: 'INE001A01036', casStatus: 'ABSENT' }),
    ];
    const back = ecasParsedSchema.parse({
      statementDate: '2026-06-30',
      accounts: [{ boId: 'BO-A', holdings: [{ isin: 'INE001A01036', name: 'Acme', units: 100, price: 250, value: 25000 }] }],
      unrecognized: [],
    });
    const upd = reconcile(existing, back).updates.find((u) => u.id === 'a')!;
    expect(upd.data.casStatus).toBe('CURRENT');
  });

  // never touches non-stock rows
  it('never touches MUTUAL_FUND / OTHER rows', () => {
    const existing = [
      stock({ id: 'mf', type: 'MUTUAL_FUND', source: 'CAS', importKey: 'F|120503', ticker: '120503' }),
      stock({ id: 'ot', type: 'OTHER', source: null }),
    ];
    const r = reconcile(existing, parsed);
    expect(r.updates.some((u) => u.id === 'mf' || u.id === 'ot')).toBe(false);
    expect(r.flaggedAbsent.some((f) => f.id === 'mf' || f.id === 'ot')).toBe(false);
  });
});
