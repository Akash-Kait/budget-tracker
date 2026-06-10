import type {
  EcasParsed,
  ExistingStockAsset,
  EcasCreate,
  EcasReconcileResult,
} from './types';

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// Per-account reconciliation key (spec Q3). A holding is per-demat-account, so the SAME ISIN held
// in two BO IDs stays two distinct rows — aggregating would erase which account holds what and
// break flag-absent when one account drops a holding another still holds. Mirrors the CAS folio key.
export function stockKey(boId: string, isin: string): string {
  return `${(boId ?? '').trim()}|${isin.trim().toUpperCase()}`;
}

// Defense-in-depth INE-only guard (spec decision #2). Equity ISINs are `INE…`; INF/unrecognized
// never reach a create/update even if a future producer leaks one.
function isEquity(isin: string): boolean {
  return /^INE[A-Z0-9]{9}$/.test(isin.trim().toUpperCase());
}

const norm = (s: string) => s.trim().toUpperCase();

/**
 * Reconcile a parsed eCAS against existing assets. PURE — no DB, no provider, no I/O.
 *
 * Rules (approved spec + two rounds of deep-review fixes):
 *  - STOCK rows only; never touches MUTUAL_FUND/OTHER. `INE…` equities only.
 *  - Match an existing ECAS row by exact `importKey = boId|isin`. Adoption of a hand-entered
 *    MANUAL/legacy row matches by NORMALIZED bare ISIN (trim+uppercase, so a lowercase/whitespace
 *    hand-typed ticker still adopts), per-account-safe (existing ECAS rows are never matched by bare
 *    ISIN), and claimed at most once per run; multiple manual rows for one ISIN are bucketed so each
 *    can be claimed by a distinct account.
 *  - Adoption MERGES (units/price/source/key only; user name/costBasis/value/purchaseDate kept) and
 *    flips `source` to 'ECAS' so the row is flag-absent-eligible thereafter.
 *  - Within ONE statement a `boId|isin` is handled exactly once (first occurrence wins) — a duplicate
 *    line (page-wrap / re-print / split sub-line) can never create two rows for one holding.
 *  - A present-but-unreadable holding (non-finite/missing units, or no positive price and no positive
 *    value to derive one) → surfaced in `incomplete`, NOT created/updated, but still counted present
 *    (in `seenKeys`) so it isn't wrongly flag-absented.
 *  - Per-account flag-absent: an ECAS stock absent from THIS statement → casStatus ABSENT (never
 *    deleted). A reappearing ABSENT row flips back to CURRENT. costBasis is NEVER written for stocks.
 */
export function reconcile(existing: ExistingStockAsset[], parsed: EcasParsed): EcasReconcileResult {
  const stocks = existing.filter((a) => a.type === 'STOCK');
  // ECAS rows match by exact boId|isin only. Manual/legacy rows are the only adoption candidates,
  // bucketed by NORMALIZED bare ISIN — and existing ECAS rows are excluded so a bare-ISIN fallback
  // can never cross accounts.
  const byImportKey = new Map<string, ExistingStockAsset>();
  const byTicker = new Map<string, ExistingStockAsset[]>();
  for (const a of stocks) {
    if (a.importKey) byImportKey.set(a.importKey, a);
    if (a.ticker && a.source !== 'ECAS') {
      const t = norm(a.ticker);
      const bucket = byTicker.get(t);
      if (bucket) bucket.push(a);
      else byTicker.set(t, [a]);
    }
  }

  const creates: EcasCreate[] = [];
  const updates: EcasReconcileResult['updates'] = [];
  const incomplete: { isin: string; name: string }[] = [];
  const seenKeys = new Set<string>(); // every boId|isin present in THIS statement (for flag-absent)
  const handledKeys = new Set<string>(); // boId|isin already acted on this run (first occurrence wins)
  const claimedIds = new Set<string>(); // existing rows already matched this run (per-account adoption)
  const asOf = parsed.statementDate ?? null;

  for (const account of parsed.accounts) {
    for (const h of account.holdings) {
      const isin = norm(h.isin);
      if (!isEquity(isin)) continue; // INE-only guard — INF/unrecognized never imported here
      const key = stockKey(account.boId, isin);
      seenKeys.add(key); // present in this statement, even if duplicate/unreadable

      if (handledKeys.has(key)) continue; // duplicate line for one holding — first occurrence wins
      handledKeys.add(key);

      const name = h.name.trim();
      let units = h.units ?? null;
      if (units == null || !Number.isFinite(units)) {
        incomplete.push({ isin, name }); // missing/NaN/Infinity units — can't value → surface
        continue;
      }
      if (units <= 0) continue; // genuine zero/negative balance — not a held position
      let price = h.price ?? null;
      // Derive market price from market value only when value is a finite positive number, so neither
      // a null/0/NaN/Infinity value can ever yield a 0/NaN/Infinity price.
      if ((price == null || !Number.isFinite(price) || price <= 0) && h.value != null && Number.isFinite(h.value) && h.value > 0) {
        price = round4(h.value / units);
      }
      if (price == null || !Number.isFinite(price) || price <= 0) {
        incomplete.push({ isin, name }); // no usable, finite, positive price → surface, never ₹0 it
        continue;
      }

      let match = byImportKey.get(key);
      if (!match) {
        const bucket = byTicker.get(isin);
        match = bucket?.find((c) => !claimedIds.has(c.id));
      }

      if (!match) {
        creates.push({
          type: 'STOCK',
          name,
          ticker: isin,
          quantity: units,
          pricePerUnit: price,
          value: null,
          priceUpdatedAt: asOf,
          priceSource: 'ECAS',
          tickerName: name,
          costBasis: null,
          source: 'ECAS',
          importKey: key,
          casStatus: 'CURRENT',
        });
        continue;
      }

      claimedIds.add(match.id);
      const data: Record<string, unknown> = {
        quantity: units,
        pricePerUnit: price,
        priceUpdatedAt: asOf,
        tickerName: name,
        ticker: isin,
        priceSource: 'ECAS',
        source: 'ECAS', // flips an adopted manual row to ECAS → flag-absent-eligible thereafter
        importKey: key,
        casStatus: 'CURRENT', // resurrects a previously-ABSENT row that reappears
      };
      if (match.source === 'ECAS') data.name = name; // adopted manual rows: name/costBasis kept (MERGE)
      updates.push({ id: match.id, data });
    }
  }

  const flaggedAbsent = stocks
    .filter((a) => a.source === 'ECAS' && a.importKey != null && !seenKeys.has(a.importKey) && a.casStatus !== 'ABSENT')
    .map((a) => ({ id: a.id, name: a.name }));

  return { creates, updates, flaggedAbsent, incomplete };
}
