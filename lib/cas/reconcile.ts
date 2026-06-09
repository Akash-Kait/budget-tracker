import type {
  CasParsed,
  CasScheme,
  ExistingAsset,
  CasCreate,
  ReconcileResult,
} from './types';

// Stable reconciliation key for a CAS scheme. ALWAYS folio-qualified so the SAME fund held in two
// folios (common) — or Growth/IDCW variants that share one AMFI code — stay distinct rather than
// colliding onto one row. Within a folio: AMFI code (preferred) → ISIN (stable across statements) →
// scheme name (last resort; names drift between statements). This is the idempotency backbone.
export function schemeKey(s: CasScheme): string {
  const folio = (s.folio ?? '').trim();
  const discriminator = s.amfi?.trim() || s.isin?.trim() || s.name.trim();
  return `${folio}|${discriminator}`;
}

// casparser dates are ISO `YYYY-MM-DD` — the one format `new Date(string)` parses reliably (unlike
// the AMFI DD-Mon-YYYY feed, which is parsed explicitly). Null-safe.
function toIso(navDate: string | null | undefined): string | null {
  if (!navDate) return null;
  const d = new Date(navDate);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Fields a CAS scheme always carries into a row (units/price/identity) — shared by create & update.
function casFields(s: CasScheme) {
  return {
    ticker: s.amfi?.trim() || null,
    quantity: s.units ?? null,
    pricePerUnit: s.nav ?? null,
    priceUpdatedAt: toIso(s.navDate),
    priceSource: 'CAS' as const,
    tickerName: s.name.trim(),
  };
}

/**
 * Reconcile a parsed CAS against existing assets. PURE — no DB, no provider, no I/O.
 *
 * Rules (approved spec):
 *  - Considers ONLY existing MUTUAL_FUND rows. STOCK/OTHER are never read or touched.
 *  - Match each CAS scheme by `importKey` (== schemeKey); also match an existing row whose `ticker`
 *    equals the AMFI code (catches a hand-entered manual fund) — that row is ADOPTED.
 *  - Found + already CAS-sourced  -> full update (CAS owns the row; cost basis preserved if CAS omits it).
 *  - Found + manual (adopt, MERGE) -> update units/price/source/key ONLY; PRESERVE user-entered
 *    name, costBasis, purchaseDate, value. Adoption is a merge, never a wipe-and-replace.
 *  - Not found -> create a new MUTUAL_FUND row (source CAS).
 *  - A CAS-sourced row absent from THIS statement -> flagged ABSENT (never deleted).
 */
export function reconcile(existing: ExistingAsset[], parsed: CasParsed): ReconcileResult {
  const mf = existing.filter((a) => a.type === 'MUTUAL_FUND');
  const byImportKey = new Map<string, ExistingAsset>();
  const byTicker = new Map<string, ExistingAsset>();
  for (const a of mf) {
    if (a.importKey) byImportKey.set(a.importKey, a);
    if (a.ticker) byTicker.set(a.ticker, a);
  }

  const creates: CasCreate[] = [];
  const updates: ReconcileResult['updates'] = [];
  const matchedIds = new Set<string>();

  for (const s of parsed.schemes) {
    const key = schemeKey(s);
    const f = casFields(s);
    const match =
      byImportKey.get(key) ?? (s.amfi?.trim() ? byTicker.get(s.amfi.trim()) : undefined);

    if (!match) {
      // Don't materialize a unit-less phantom holding (the parser already drops close<=0, but guard
      // here too so a null slipping through Zod never becomes a ₹0 row).
      if (f.quantity == null) continue;
      creates.push({
        type: 'MUTUAL_FUND',
        name: s.name.trim(),
        ticker: f.ticker,
        quantity: f.quantity,
        pricePerUnit: f.pricePerUnit,
        value: null,
        priceUpdatedAt: f.priceUpdatedAt,
        priceSource: 'CAS',
        tickerName: f.tickerName,
        costBasis: s.cost ?? null,
        source: 'CAS',
        importKey: key,
        casStatus: 'CURRENT',
      });
      continue;
    }

    matchedIds.add(match.id);
    const adopt = match.source !== 'CAS';
    // Common to both branches; a null quantity/price is OMITTED so it never nulls a good value.
    const data: Record<string, unknown> = {
      tickerName: f.tickerName,
      ticker: f.ticker ?? match.ticker,
      priceSource: 'CAS',
      source: 'CAS',
      importKey: key,
      casStatus: 'CURRENT',
    };
    if (f.quantity != null) data.quantity = f.quantity;
    if (f.pricePerUnit != null) {
      data.pricePerUnit = f.pricePerUnit;
      data.priceUpdatedAt = f.priceUpdatedAt;
    }
    if (!adopt) {
      // Already CAS-managed: CAS owns the row's name; still never nulls an existing cost basis.
      data.name = s.name.trim();
      data.costBasis = s.cost ?? match.costBasis;
    }
    // adopt (MERGE): user-entered name/costBasis/purchaseDate/value are intentionally NOT set.
    updates.push({ id: match.id, data });
  }

  // CAS-sourced rows not seen in this statement → flag (not already flagged → avoids redundant writes).
  const flaggedAbsent = mf
    .filter((a) => a.source === 'CAS' && !matchedIds.has(a.id) && a.casStatus !== 'ABSENT')
    .map((a) => ({ id: a.id, name: a.name }));

  return { creates, updates, flaggedAbsent };
}
