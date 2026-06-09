import { z } from 'zod';

// Trimmed shape emitted by scripts/cas_parse.py (NOT casparser's raw dict). Validated at the
// sidecar boundary so the route + reconcile never see unvalidated subprocess output.
export const casSchemeSchema = z.object({
  amfi: z.string().nullable().optional(),
  isin: z.string().nullable().optional(),
  rta: z.string().nullable().optional(),
  folio: z.string().nullable().optional(),
  name: z.string().min(1),
  units: z.number().nullable().optional(),
  nav: z.number().nullable().optional(),
  navDate: z.string().nullable().optional(),
  value: z.number().nullable().optional(),
  cost: z.number().nullable().optional(),
});

export const casParsedSchema = z.object({
  statementDate: z.string().nullable().optional(),
  schemes: z.array(casSchemeSchema),
});

export type CasScheme = z.infer<typeof casSchemeSchema>;
export type CasParsed = z.infer<typeof casParsedSchema>;

// Minimal view of an existing row that reconcile needs (keeps the pure fn DB-agnostic/testable).
export interface ExistingAsset {
  id: string;
  type: string; // MUTUAL_FUND | STOCK | OTHER
  name: string;
  ticker: string | null;
  source: string | null; // CAS | MANUAL | null(legacy=manual)
  importKey: string | null;
  casStatus: string | null; // CURRENT | ABSENT | null
  costBasis: number | null;
}

// Plain create/update payloads — usable directly as Prisma data (DateTime accepts ISO strings).
export interface CasCreate {
  type: 'MUTUAL_FUND';
  name: string;
  ticker: string | null;
  quantity: number | null;
  pricePerUnit: number | null;
  value: null;
  priceUpdatedAt: string | null;
  priceSource: 'CAS';
  tickerName: string | null;
  costBasis: number | null;
  source: 'CAS';
  importKey: string;
  casStatus: 'CURRENT';
}

export interface CasUpdate {
  id: string;
  data: Record<string, unknown>;
}

export interface ReconcileResult {
  creates: CasCreate[];
  updates: CasUpdate[];
  flaggedAbsent: { id: string; name: string }[];
}
