import type { ExistingMfAsset, MfParsed, MfPlan, MfCreate, MfCoverage } from './mf-types';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Per-key. Folio rows key on `folio|ISIN`; demat-held rows key on `boId|ISIN`; existing CAS rows key on
// `folio|amfi` — the migration bridge resolves a folio row's ISIN→AMFI (via the feed) to match the CAS key.
export function mfKey(scope: string, id: string): string {
  return `${(scope ?? '').trim()}|${id.trim().toUpperCase()}`;
}

// Re-clean an ISIN (defense in depth): a surviving soft hyphen / zero-width space would fail the INF
// check and silently DROP a healthy fund (mis-flagged absent on migration). The parser repairs this.
function cleanIsin(s: string): string {
  return s.replace(/[\s\u00ad\u200b]/g, '').toUpperCase();
}

interface Norm {
  isin: string;
  name: string;
  section: 'folio' | 'demat';
  scope: string; // folio number (folio) or boId (demat)
  units: number | null;
  nav: number | null;
  invested: number | null; // null for demat (no cost basis in the holding statement)
  valuation: number | null;
}

/**
 * Plan an eCAS MF import covering BOTH sub-classes the statement carries. PURE — no DB, no I/O.
 * `resolveAmfi(isin)` is injected (built from the AMFI feed by the route) so this stays testable.
 *
 * Sections:
 *  - FOLIO (page 9): carries cost basis (Cumulative Invested); keyed `folio|ISIN`; may MIGRATE an
 *    existing CAS row (`folio|amfi`, via feed-resolved ISIN→amfi). Shows gain/loss.
 *  - DEMAT-held (holding statement): value-only, NO cost basis; keyed `boId|ISIN`; no gain/loss.
 *
 * Invariants (approved spec, Rounds 1+2):
 *  - Cost basis: a stored non-null basis is PRESERVED (never overwritten — treated as user-owned); the
 *    discrepancy vs the eCAS amount invested is surfaced. A null basis takes the eCAS amount (folio) or
 *    stays null (demat).
 *  - Value check: `units×NAV` must reconcile to the stated Valuation within ₹1, else a parse error
 *    (surfaced, blocks) — never absorbed.
 *  - Unmatched in MIGRATION context (any pre-existing non-ECAS MF row) → NEVER auto-created (would
 *    double-count); BLOCKING. In a clean FIRST import → a legitimate create.
 *  - NO-OVERLAP: an ISIN in BOTH sections is the same fund held two ways → store ONCE (folio wins, it
 *    has basis); the demat copy is dropped and SURFACED, never silently merged.
 *  - COVERAGE (statement valuations only): three reconciliations must all tie (±₹1) — folio vs folio
 *    Grand Total, demat vs the discrete demat-MF total, and the stored total vs folio+demat−overlap.
 *    Any miss blocks → a whole sub-class can't vanish, and an overlap can't silently shrink the total.
 *  - A fund absent from this statement → flagged ABSENT (never deleted).
 */
export function planMfImport(
  existing: ExistingMfAsset[],
  parsed: MfParsed,
  resolveAmfi: (isin: string) => string | null,
): MfPlan {
  const mf = existing.filter((a) => a.type === 'MUTUAL_FUND');
  // Migration context = ANY pre-existing non-ECAS MF row (CAS, manual, or legacy null-source). If the
  // user already holds MF rows by any means, an unmatched row must NOT be auto-created (double-count).
  const migrationContext = mf.some((a) => a.source !== 'ECAS');
  const byImportKey = new Map<string, ExistingMfAsset>();
  for (const a of mf) if (a.importKey) byImportKey.set(a.importKey, a);

  const matched: MfPlan['matched'] = [];
  const creates: MfCreate[] = [];
  const unmatchedBlocking: MfPlan['unmatchedBlocking'] = [];
  const valueErrors: MfPlan['valueErrors'] = [];
  const overlaps: MfPlan['overlaps'] = [];
  const seen = new Set<string>();
  const asOf = parsed.statementDate ?? null;

  // Valuations of rows we will ACTUALLY store (creates + matched) — used to validate the stored total
  // against the overlap-adjusted anchor. Measured from emitted output (NOT recomputed from parsed
  // sums) so it catches a storage drift: dropping the wrong overlap side, storing both, or dropping a
  // matched row. Also guards output-key uniqueness (a duplicate importKey would 500 at apply).
  const storedVals: number[] = [];
  const emittedKeys = new Set<string>();
  // Claim an importKey for a stored row; on a duplicate, surface+block instead of emitting a second
  // row with the same (source, importKey) (which would violate @@unique mid-transaction). Returns the
  // valuation to record, or null if the row was blocked as a duplicate.
  const claimStored = (rec: Norm, key: string): boolean => {
    if (emittedKeys.has(key)) {
      unmatchedBlocking.push({
        isin: rec.isin,
        name: rec.name,
        folio: rec.scope,
        reason: 'duplicate import key — two holdings resolve to the same row; resolve before importing',
      });
      return false;
    }
    emittedKeys.add(key);
    storedVals.push(rec.valuation ?? 0);
    return true;
  };

  // --- normalise + value-check + split by section -------------------------------------------------
  const folioH: Norm[] = [];
  const dematH: Norm[] = [];
  for (const h of parsed.holdings) {
    const isin = cleanIsin(h.isin);
    if (!/^INF[A-Z0-9]{9}$/.test(isin)) continue; // MF only; guard against stray rows
    const section = h.section === 'demat' ? 'demat' : 'folio';
    const units = h.units ?? null;
    const nav = h.nav ?? null;
    const valuation = h.valuation ?? null;
    // Value check applies to both sections (demat value = units × market price too).
    if (units != null && nav != null && valuation != null && Math.abs(round2(units * nav) - valuation) > 1) {
      valueErrors.push({ isin, name: h.name.trim(), unitsTimesNav: round2(units * nav), valuation });
      continue;
    }
    const rec: Norm = {
      isin,
      name: h.name.trim(),
      section,
      scope: (section === 'folio' ? h.folio : h.boId)?.trim() ?? '',
      units,
      nav,
      invested: section === 'folio' ? (h.amountInvested ?? null) : null, // demat carries no basis
      valuation,
    };
    (section === 'folio' ? folioH : dematH).push(rec);
  }

  const folioIsins = new Set(folioH.map((r) => r.isin));
  const folioValByIsin = new Map<string, number | null>();
  for (const r of folioH) if (!folioValByIsin.has(r.isin)) folioValByIsin.set(r.isin, r.valuation);

  // Coverage sums use ALL value-valid parsed rows per section (PRE-dedup) — they measure parse
  // completeness against the stated buckets, independent of the storage-time overlap dedup.
  const sum = (xs: number[]) => round2(xs.reduce((s, n) => s + n, 0));
  const folioParsed = sum(folioH.map((r) => r.valuation ?? 0));
  const dematParsed = sum(dematH.map((r) => r.valuation ?? 0));
  const investedParsed = sum(folioH.map((r) => r.invested ?? 0));
  const overlapDropped = sum(dematH.filter((r) => folioIsins.has(r.isin)).map((r) => r.valuation ?? 0));

  const buildData = (rec: Norm, key: string): Record<string, unknown> => ({
    name: rec.name,
    ticker: rec.isin, // CAS rows flip amfi→ISIN; refresh resolves ISIN→code
    quantity: rec.units,
    pricePerUnit: rec.nav,
    value: rec.valuation,
    priceUpdatedAt: asOf,
    priceSource: 'ECAS',
    tickerName: rec.name,
    source: 'ECAS',
    importKey: key,
    casStatus: 'CURRENT',
    statementDate: asOf, // refresh-safe older-statement anchor (priceUpdatedAt moves on refresh)
  });
  const buildCreate = (rec: Norm, key: string): MfCreate => ({
    type: 'MUTUAL_FUND',
    name: rec.name,
    ticker: rec.isin,
    quantity: rec.units,
    pricePerUnit: rec.nav,
    value: rec.valuation,
    priceUpdatedAt: asOf,
    priceSource: 'ECAS',
    tickerName: rec.name,
    costBasis: rec.invested, // folio: amount invested; demat: null
    source: 'ECAS',
    importKey: key,
    casStatus: 'CURRENT',
    statementDate: asOf,
  });

  // Apply a matched-row update with the cost-basis preserve rule (shared by both sections). Guards
  // output-key uniqueness; returns false (and surfaces a duplicate-key block) if the key is reused.
  const pushMatched = (rec: Norm, match: ExistingMfAsset, key: string): boolean => {
    if (!claimStored(rec, key)) return false;
    const isMigration = match.source !== 'ECAS';
    const data = buildData(rec, key);
    let costBasisDiscrepancy: MfPlan['matched'][number]['costBasisDiscrepancy'] = null;
    if (match.costBasis == null) {
      data.costBasis = rec.invested; // null for demat → stays null
    } else if (rec.invested != null && Math.abs(match.costBasis - rec.invested) > 1) {
      costBasisDiscrepancy = { stored: match.costBasis, statement: rec.invested }; // surfaced, NOT written
    }
    matched.push({ id: match.id, data, isMigration, costBasisDiscrepancy });
    return true;
  };

  // --- FOLIO section (with CAS→eCAS bridge) -------------------------------------------------------
  for (const rec of folioH) {
    const nativeKey = mfKey(rec.scope, rec.isin); // folio|ISIN
    const amfi = resolveAmfi(rec.isin);
    const bridgeKey = amfi ? mfKey(rec.scope, amfi) : null; // folio|amfi (existing CAS)
    seen.add(nativeKey);
    if (bridgeKey) seen.add(bridgeKey);

    const nativeRow = byImportKey.get(nativeKey);
    const bridgeRow = bridgeKey ? byImportKey.get(bridgeKey) : undefined;
    // Half-migrated conflict: CAS row AND eCAS row both exist for this fund → converting one orphans
    // the other (a silent double-count). Block.
    if (nativeRow && bridgeRow && nativeRow.id !== bridgeRow.id) {
      unmatchedBlocking.push({
        isin: rec.isin,
        name: rec.name,
        folio: rec.scope,
        reason: 'two existing rows for this fund (CAS + eCAS) — remove one and re-import',
      });
      continue;
    }
    const match = nativeRow ?? bridgeRow;
    if (!match) {
      if (migrationContext) {
        unmatchedBlocking.push({
          isin: rec.isin,
          name: rec.name,
          folio: rec.scope,
          reason: amfi
            ? 'no matching existing fund (folio/AMFI)'
            : 'ISIN not in the AMFI feed — a new fund, or the feed is temporarily incomplete (retry shortly)',
        });
      } else if (claimStored(rec, nativeKey)) {
        creates.push(buildCreate(rec, nativeKey));
      }
      continue;
    }
    pushMatched(rec, match, nativeKey);
  }

  // --- DEMAT-held section (value-only; folio-wins overlap dedup) -----------------------------------
  for (const rec of dematH) {
    if (folioIsins.has(rec.isin)) {
      // Same fund held two ways → store ONCE (folio kept). Drop the demat copy; surface, never merge.
      overlaps.push({
        isin: rec.isin,
        name: rec.name,
        folioValue: folioValByIsin.get(rec.isin) ?? null,
        dematValueDropped: rec.valuation,
      });
      continue;
    }
    const key = mfKey(rec.scope, rec.isin); // boId|ISIN
    seen.add(key);
    const match = byImportKey.get(key);
    if (!match) {
      if (migrationContext) {
        unmatchedBlocking.push({
          isin: rec.isin,
          name: rec.name,
          folio: rec.scope, // boId here
          reason: 'demat-held MF not matched to an existing holding — resolve before importing',
        });
      } else if (claimStored(rec, key)) {
        creates.push(buildCreate(rec, key)); // costBasis null (value-only)
      }
      continue;
    }
    pushMatched(rec, match, key);
  }

  const flaggedAbsent = mf
    .filter(
      (a) =>
        (a.source === 'ECAS' || a.source === 'CAS') &&
        a.importKey != null &&
        !seen.has(a.importKey) &&
        a.casStatus !== 'ABSENT',
    )
    .map((a) => ({ id: a.id, name: a.name }));

  // --- coverage: three reconciliations, all on STATEMENT valuations -------------------------------
  const folioStated = parsed.grandTotalValuation ?? null;
  const dematStated = parsed.dematStatedTotal ?? null;
  const investedStated = parsed.grandTotalInvested ?? null;
  const ties = (a: number, b: number) => Math.abs(a - b) <= 1;
  // storedTotal = Σ valuations of rows we will actually WRITE (creates + matched), measured from the
  // emitted plan — so a storage drift (dropped wrong side, stored both, dropped a row) shows up here
  // even though it cancels in the per-section residuals.
  const storedTotal = round2(storedVals.reduce((s, n) => s + n, 0));
  const expectedTotal =
    folioStated != null && dematStated != null ? round2(folioStated + dematStated - overlapDropped) : null;
  const coverage: MfCoverage = {
    folioParsed,
    folioStated,
    folioMatches: folioStated == null ? null : ties(folioParsed, folioStated),
    dematParsed,
    dematStated,
    dematMatches: dematStated == null ? null : ties(dematParsed, dematStated),
    investedParsed,
    investedStated,
    investedMatches: investedStated == null ? null : ties(investedParsed, investedStated),
    overlapDropped,
    storedTotal,
    expectedTotal,
    totalMatches: expectedTotal == null ? null : ties(storedTotal, expectedTotal),
  };
  const coverageBlocking =
    coverage.folioMatches === false ||
    coverage.dematMatches === false ||
    coverage.investedMatches === false ||
    coverage.totalMatches === false;

  const blocked = unmatchedBlocking.length > 0 || valueErrors.length > 0 || coverageBlocking;
  return {
    matched,
    creates,
    unmatchedBlocking,
    flaggedAbsent,
    valueErrors,
    overlaps,
    migrationContext,
    coverage,
    coverageBlocking,
    blocked,
  };
}
