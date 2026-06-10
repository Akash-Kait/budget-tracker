import { z } from 'zod';

// The normalized seam (spec Q1): BOTH the pdfplumber sidecar (Phase 1) and the DigiLocker
// structured pull (Phase 2) produce `EcasParsed`; reconcile + route consume only this. One
// reconcile path — the input source is interchangeable behind this shape.
export const ecasHoldingSchema = z.object({
  isin: z.string().min(1),
  name: z.string(),
  units: z.number().nullable().optional(),
  price: z.number().nullable().optional(),
  value: z.number().nullable().optional(),
});

export const ecasAccountSchema = z.object({
  boId: z.string(), // demat account id ("" when the statement has a single unlabelled account)
  holdings: z.array(ecasHoldingSchema),
});

export const ecasParsedSchema = z.object({
  statementDate: z.string().nullable().optional(),
  // The statement's stated Equity asset-class total (₹), for a completeness check against the sum of
  // imported equity rows — so a silently-dropped holding surfaces as a visible shortfall.
  equityStatedTotal: z.number().nullable().optional(),
  accounts: z.array(ecasAccountSchema),
  // ISINs that matched the row locator but are neither equity nor MF (or aren't a plausible ISIN):
  // surfaced, never silently dropped (spec Q7).
  unrecognized: z.array(z.object({ isin: z.string(), name: z.string() })).default([]),
});

export type EcasHolding = z.infer<typeof ecasHoldingSchema>;
export type EcasAccount = z.infer<typeof ecasAccountSchema>;
export type EcasParsed = z.infer<typeof ecasParsedSchema>;

// Minimal view of an existing row reconcile needs (keeps the pure fn DB-agnostic/testable).
export interface ExistingStockAsset {
  id: string;
  type: string; // MUTUAL_FUND | STOCK | OTHER
  name: string;
  ticker: string | null;
  source: string | null; // MANUAL | CAS | ECAS | null
  importKey: string | null; // for ECAS stocks: `${boId}|${isin}`
  casStatus: string | null; // reused as the absent flag (CURRENT | ABSENT)
  costBasis: number | null;
}

export interface EcasCreate {
  type: 'STOCK';
  name: string;
  ticker: string; // the bare ISIN (live-provider lookup key, Phase 2)
  quantity: number | null;
  pricePerUnit: number | null;
  value: null;
  priceUpdatedAt: string | null; // statement date — "as of <date>", never a live quote (spec Q6)
  priceSource: 'ECAS';
  tickerName: string;
  costBasis: null; // eCAS has no cost column — stocks carry NO basis (decision #4)
  source: 'ECAS';
  importKey: string; // `${boId}|${isin}`
  casStatus: 'CURRENT';
}

export interface EcasUpdate {
  id: string;
  data: Record<string, unknown>;
}

export interface EcasReconcileResult {
  creates: EcasCreate[];
  updates: EcasUpdate[];
  flaggedAbsent: { id: string; name: string }[];
  // Holdings present in the statement but unreadable (no units, or no price/value to value them) —
  // surfaced visibly, NOT silently skipped or left as a stale value (deep-review GAP).
  incomplete: { isin: string; name: string }[];
}
