import { z } from 'zod';

// Normalized eCAS FOLIO-section MF holding (page-9 "MUTUAL FUND UNITS HELD AS ON"). Produced by the
// parser; consumed by the pure MF reconcile. (DigiLocker structured pull, later, produces the same.)
export const mfHoldingSchema = z.object({
  isin: z.string().min(1), // INF*
  name: z.string(),
  // 'folio' = page-9 MF folio section (carries cost basis, keyed folio|ISIN);
  // 'demat' = MF units held in demat (holding statement, NO cost basis, keyed boId|ISIN).
  section: z.enum(['folio', 'demat']).default('folio'),
  folio: z.string().default(''),
  boId: z.string().default(''), // demat account id (demat-held MFs)
  units: z.number().nullable().optional(),
  nav: z.number().nullable().optional(),
  amountInvested: z.number().nullable().optional(), // eCAS "Cumulative Amount Invested" → costBasis (null for demat)
  valuation: z.number().nullable().optional(), // eCAS "Valuation" → stored value
});

export const mfParsedSchema = z.object({
  statementDate: z.string().nullable().optional(), // ISO (anchored to the folio "AS ON" date)
  grandTotalInvested: z.number().nullable().optional(), // folio Grand Total invested — coverage anchor
  grandTotalValuation: z.number().nullable().optional(), // folio Grand Total valuation — coverage anchor
  dematStatedTotal: z.number().nullable().optional(), // discrete "MF Held in Demat Form" total — coverage anchor
  holdings: z.array(mfHoldingSchema),
});

export type MfHolding = z.infer<typeof mfHoldingSchema>;
export type MfParsed = z.infer<typeof mfParsedSchema>;

// Minimal view of an existing row the reconcile needs (DB-agnostic / testable).
export interface ExistingMfAsset {
  id: string;
  type: string; // MUTUAL_FUND | STOCK | OTHER
  name: string;
  ticker: string | null; // CAS rows: AMFI code; eCAS rows: ISIN
  source: string | null; // CAS | ECAS | MANUAL | null
  importKey: string | null; // CAS: folio|amfi ; eCAS: folio|ISIN
  casStatus: string | null;
  costBasis: number | null;
}

export interface MfCreate {
  type: 'MUTUAL_FUND';
  name: string;
  ticker: string; // ISIN (refresh resolves ISIN→code from the feed)
  quantity: number | null;
  pricePerUnit: number | null;
  value: number | null; // the eCAS Valuation (statement snapshot / Grand-Total anchor)
  priceUpdatedAt: string | null;
  priceSource: 'ECAS';
  tickerName: string;
  costBasis: number | null; // eCAS amount invested (null for demat-held)
  source: 'ECAS';
  importKey: string; // folio|ISIN (folio) or boId|ISIN (demat)
  casStatus: 'CURRENT';
  statementDate: string | null; // eCAS "as of" — refresh-safe older-statement anchor
}

export interface MfMatched {
  id: string;
  data: Record<string, unknown>;
  isMigration: boolean; // converting an existing CAS (or manual) row → ECAS
  costBasisDiscrepancy: { stored: number; statement: number } | null; // preserved basis ≠ eCAS invested
}

// Three independent reconciliations — each MF sub-class against its OWN stated bucket, PLUS the stored
// total against the overlap-adjusted anchor. No sub-class (folio or demat) can vanish, and an overlap
// can't silently shrink the stored total, without a `false` here. All on STATEMENT valuations only.
export interface MfCoverage {
  folioParsed: number; // Σ folio valuations (pre-dedup)
  folioStated: number | null; // folio Grand Total
  folioMatches: boolean | null;
  dematParsed: number; // Σ demat valuations (pre-dedup)
  dematStated: number | null; // discrete "MF Held in Demat Form" total
  dematMatches: boolean | null;
  investedParsed: number; // Σ folio amounts invested
  investedStated: number | null; // folio Grand Total invested
  investedMatches: boolean | null;
  overlapDropped: number; // Σ demat valuations dropped because the ISIN is also in folio (folio wins)
  storedTotal: number; // what will actually be stored = folioParsed + (dematParsed − overlapDropped)
  expectedTotal: number | null; // folioStated + dematStated − overlapDropped
  totalMatches: boolean | null; // storedTotal ties to expectedTotal (closes the overlap hole)
}

export interface MfPlan {
  matched: MfMatched[];
  creates: MfCreate[]; // FIRST-import only (never in a migration context)
  unmatchedBlocking: { isin: string; name: string; folio: string; reason: string }[];
  flaggedAbsent: { id: string; name: string }[];
  valueErrors: { isin: string; name: string; unitsTimesNav: number; valuation: number }[];
  // An ISIN present in BOTH sections — same fund held two ways. Stored ONCE (folio wins, keeps basis);
  // the demat copy is dropped and surfaced here, never silently merged.
  overlaps: { isin: string; name: string; folioValue: number | null; dematValueDropped: number | null }[];
  migrationContext: boolean; // any existing non-ECAS MUTUAL_FUND row present (CAS or manual)
  coverage: MfCoverage;
  coverageBlocking: boolean; // any of the three coverage reconciliations failed
  blocked: boolean; // unmatchedBlocking | valueErrors | coverageBlocking → apply must NOT proceed
}
