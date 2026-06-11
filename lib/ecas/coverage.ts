import type { EcasReconcileResult } from './types';

export interface EquityCoverage {
  statedEquityTotal: number | null;
  importedEquityValue: number;
  // null = no stated total to verify against; true/false = within tolerance of it.
  complete: boolean | null;
}

/**
 * PURE equity completeness check (shared by the stock route + the unified orchestrator): the value
 * actually imported (qty×price across every equity create + update this run) vs the statement's stated
 * Equity total. A shortfall means a holding silently didn't parse → surfaces visibly (and, in the
 * unified flow, BLOCKS the confirm).
 *
 * Tolerance is per-HOLDING, not a % of the total: ~₹1 per imported holding (min ₹1). We compute
 * imported value as qty×price while the statement rounds each holding's value, so the legitimate drift
 * is ≤ ~₹0.5 × holdings — a per-holding band absorbs that. A flat 0.5%-of-total band (the old value)
 * was far too wide (₹632 on a ₹1.26L book) and would let a genuinely-dropped small holding slip
 * through; this catches any real dropped holding (worth ₹100s) while tolerating rounding.
 */
export function equityCoverage(plan: EcasReconcileResult, statedEquityTotal: number | null): EquityCoverage {
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  const imported =
    plan.creates.reduce((s, c) => s + num(c.quantity) * num(c.pricePerUnit), 0) +
    plan.updates.reduce((s, u) => s + num(u.data.quantity) * num(u.data.pricePerUnit), 0);
  const importedEquityValue = Math.round(imported * 100) / 100;
  const tolerance = Math.max(1, plan.creates.length + plan.updates.length);
  return {
    statedEquityTotal,
    importedEquityValue,
    complete: statedEquityTotal == null ? null : Math.abs(importedEquityValue - statedEquityTotal) <= tolerance,
  };
}
