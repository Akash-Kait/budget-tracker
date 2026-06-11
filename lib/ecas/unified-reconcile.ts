import { reconcile } from './reconcile';
import { planMfImport } from './mf-reconcile';
import { equityCoverage, type EquityCoverage } from './coverage';
import type { EcasReconcileResult, ExistingStockAsset } from './types';
import type { MfPlan, ExistingMfAsset } from './mf-types';
import type { UnifiedParsed } from './unified-types';

// One existing-row view that satisfies BOTH engines (their Existing* shapes are identical) plus the
// date fields the older-statement guards read.
export type UnifiedExisting = ExistingStockAsset &
  ExistingMfAsset & { priceUpdatedAt: Date | string | null; statementDate: Date | string | null };

export interface UnifiedBalance {
  parsedRows: number; // denominator: holding rows the parser saw
  accountedRows: number; // equity + folioMf + dematMf + unrecognized + skipped
  ok: boolean;
}

export interface UnifiedPlan {
  stock: EcasReconcileResult;
  mf: MfPlan;
  equityCoverage: EquityCoverage;
  balance: UnifiedBalance;
  olderStatement: { blocked: boolean; reason: string | null };
  blocked: boolean; // ANY guard failed → confirm refused, ZERO writes attempted (no txn opened)
}

const toMs = (d: Date | string | null): number => (d ? new Date(d).getTime() : 0);

/**
 * Plan a unified eCAS import. PURE — no DB, no I/O. Fans the single parse out to the two UNCHANGED
 * engines (reconcile + planMfImport) and runs EVERY guard against the resulting plans:
 *   - row-accounting balance (no parsed holding row silently unaccounted),
 *   - equity coverage + MF coverage (folio + demat, overlap-consistent — inside mf.blocked),
 *   - older-statement guard across BOTH domains.
 * `blocked` is the AND-gate: the route opens its single $transaction ONLY when `blocked` is false, so
 * "we decided not to import" (guard failure, zero writes) is cleanly separate from "a write failed".
 */
export function planUnifiedImport(
  existing: UnifiedExisting[],
  parsed: UnifiedParsed,
  resolveAmfi: (isin: string) => string | null,
): UnifiedPlan {
  const stock = reconcile(existing, parsed.equity);
  const mf = planMfImport(existing, parsed.mf, resolveAmfi);
  const cov = equityCoverage(stock, parsed.equity.equityStatedTotal ?? null);

  // Balance is a PARSE→CLASS partition integrity check (every parsed holding row assigned to exactly
  // one class) — NOT an end-to-end no-row-dropped guarantee. An engine collapsing/dropping a counted
  // row (dedup, value-error, null) is caught downstream by the value-based COVERAGE guards below, which
  // are the load-bearing net; don't weaken those assuming the balance covers it.
  const ra = parsed.rowAccounting;
  const accountedRows = ra.equity + ra.folioMf + ra.dematMf + ra.unrecognized + ra.skipped;
  const balance: UnifiedBalance = {
    parsedRows: ra.parsedRows,
    accountedRows,
    ok: ra.parsedRows === accountedRows,
  };

  // Older-statement guard, PER DOMAIN with each class's OWN date (they're equal on a consolidated
  // eCAS, but compared separately so a divergence can't mis-fire). Stocks don't refresh (priceUpdatedAt
  // = statement date); MFs do, so they carry the refresh-safe `statementDate`.
  const eqMs = parsed.equity.statementDate ? Date.parse(parsed.equity.statementDate) : NaN;
  const mfMs = parsed.mf.statementDate ? Date.parse(parsed.mf.statementDate) : NaN;
  const stockNewest = Math.max(
    0,
    ...existing.filter((a) => a.type === 'STOCK' && a.source === 'ECAS' && a.priceUpdatedAt).map((a) => toMs(a.priceUpdatedAt)),
  );
  const mfNewest = Math.max(
    0,
    ...existing.filter((a) => a.type === 'MUTUAL_FUND' && a.source === 'ECAS' && a.statementDate).map((a) => toMs(a.statementDate)),
  );
  let olderBlocked = false;
  let reason: string | null = null;
  if (Number.isFinite(eqMs) && stockNewest > 0 && eqMs < stockNewest) {
    olderBlocked = true;
    reason = 'This statement is older than your most recent imported eCAS (stocks). Import the newer one.';
  } else if (Number.isFinite(mfMs) && mfNewest > 0 && mfMs < mfNewest) {
    olderBlocked = true;
    reason = 'This statement is older than your most recent imported eCAS (mutual funds). Import the newer one.';
  }

  const blocked = !balance.ok || cov.complete === false || mf.blocked || olderBlocked;
  return { stock, mf, equityCoverage: cov, balance, olderStatement: { blocked: olderBlocked, reason }, blocked };
}
