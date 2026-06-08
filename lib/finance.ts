import type { Item, Profile, Recommendation } from '@/lib/types';

export function monthlySurplus(p: Profile): number {
  return p.monthlyIncome - p.monthlyExpenses - p.monthlyInvestments;
}

export function reserveDeficit(p: Profile): number {
  return Math.max(0, p.reserveTarget - p.reserveCurrent);
}

export function fundingProgress(item: Item): {
  funded: number;
  target: number;
  pct: number; // clamped to 0–100 for display
  overFundedBy: number; // amount funded beyond the target (0 when not over-funded)
} {
  const raw = item.amount > 0 ? Math.round((item.fundedAmount / item.amount) * 100) : 0;
  return {
    funded: item.fundedAmount,
    target: item.amount,
    pct: Math.min(100, raw),
    overFundedBy: Math.max(0, roundMoney(item.fundedAmount - item.amount)),
  };
}

/** Queue: non-wishlist items, priority desc, then dueDate asc (nulls last), then title. */
export function sortQueue(items: Item[]): Item[] {
  return items
    .filter((i) => i.type !== 'WISHLIST')
    .slice()
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.rank !== b.rank) return a.rank - b.rank;
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      return a.title.localeCompare(b.title);
    });
}

export interface ProjectionResult {
  /** item id -> month index (1-based) at which it reaches its amount */
  completionMonth: Record<string, number>;
}

export interface ProjectOpts {
  startReserve?: number;
  horizon?: number; // default 120
}

/**
 * Round a money amount to whole paise. Money is stored as Float, and the projection
 * accumulates `+=` over up to 120 iterations, so without rounding a value can land at
 * e.g. 99999.99999997 and fail a `funded >= amount` check by an epsilon — pushing an
 * item's completion month out by one and flipping "on track" ↔ "behind".
 */
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

interface AllocationStep {
  reserveAdded: number;
  items: { id: string; title: string; amount: number }[];
}

interface AllocationRun {
  /** one entry per simulated month; index 0 = the first surplus month (= projectFunding month 1) */
  steps: AllocationStep[];
  /** item id -> 1-based month index it reaches its amount (0 if already fully funded) */
  completionMonth: Record<string, number>;
}

/**
 * THE planning allocation rule, single source of truth. Each month: add monthly surplus,
 * refill the Opportunity Reserve to target first, then fund active queue items in
 * priority/rank order (skipping wishlist/completed/purchased). `projectFunding` and
 * `projectMonthlyAllocation` are thin wrappers so the queue's projected dates and the
 * dashboard's allocation chart can never drift apart.
 */
function runAllocation(
  p: Profile,
  items: Item[],
  opts: { months: number; startReserve?: number },
): AllocationRun {
  const surplus = Math.max(0, monthlySurplus(p));
  let reserve = opts.startReserve ?? p.reserveCurrent;

  const fundable = sortQueue(items).filter((i) => i.status !== 'COMPLETED' && !i.purchased);
  const funded: Record<string, number> = {};
  fundable.forEach((i) => (funded[i.id] = i.fundedAmount));

  const completionMonth: Record<string, number> = {};
  // already-complete items complete at month 0
  fundable.forEach((i) => {
    if (funded[i.id] >= i.amount && i.amount > 0) completionMonth[i.id] = 0;
  });

  const steps: AllocationStep[] = [];
  for (let month = 1; month <= opts.months; month++) {
    const step: AllocationStep = { reserveAdded: 0, items: [] };
    let pool = surplus;

    // 1. refill reserve to target
    if (pool > 0 && reserve < p.reserveTarget) {
      const add = Math.min(p.reserveTarget - reserve, pool);
      reserve = roundMoney(reserve + add);
      pool = roundMoney(pool - add);
      step.reserveAdded = add;
    }

    // 2. fund items in priority order
    for (const it of fundable) {
      if (pool <= 0) break;
      if (completionMonth[it.id] !== undefined && funded[it.id] >= it.amount) continue;
      const need = it.amount - funded[it.id];
      if (need <= 0) {
        if (completionMonth[it.id] === undefined) completionMonth[it.id] = month;
        continue;
      }
      const add = Math.min(need, pool);
      funded[it.id] = roundMoney(funded[it.id] + add);
      pool = roundMoney(pool - add);
      step.items.push({ id: it.id, title: it.title, amount: add });
      if (funded[it.id] >= it.amount && completionMonth[it.id] === undefined) {
        completionMonth[it.id] = month;
      }
    }
    steps.push(step);
  }

  return { steps, completionMonth };
}

export function projectFunding(p: Profile, items: Item[], opts: ProjectOpts): ProjectionResult {
  const horizon = opts.horizon ?? 120;
  const { completionMonth } = runAllocation(p, items, {
    months: horizon,
    startReserve: opts.startReserve,
  });
  return { completionMonth };
}

export interface GoalImpact {
  title: string;
  baselineMonth: number | null;
  newMonth: number | null;
  delayMonths: number;
  /** True when the goal was fundable within the horizon before the purchase but not after. */
  nowUnfundable: boolean;
}

export interface SimulationResult {
  cost: number;
  reserveBefore: number;
  reserveAfter: number;
  reductionPct: number;
  monthsToRestore: number | null;
  goalImpacts: GoalImpact[];
  /** Titles of dated commitments/goals/experiences the purchase newly pushes past their due date. */
  underfunded: string[];
  recommendation: Recommendation;
  message: string;
}

/** Returns the set of dated, active, non-wishlist item ids whose projected completion misses their due date. */
function dueDateBreaches(
  items: Item[],
  proj: ProjectionResult,
  nowIso: string,
): Set<string> {
  const breaches = new Set<string>();
  for (const it of items) {
    if (it.type === 'WISHLIST' || !it.dueDate || !isActive(it)) continue;
    const idx = proj.completionMonth[it.id];
    if (idx === undefined) {
      breaches.add(it.id); // unfundable within the horizon
      continue;
    }
    const due = new Date(it.dueDate);
    const dueMonth = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), 1));
    if (monthsBetween(dueMonth, addMonths(nowIso, idx)) > 0) breaches.add(it.id);
  }
  return breaches;
}

export function simulatePurchase(
  p: Profile,
  items: Item[],
  cost: number,
  nowIso: string = new Date().toISOString(),
): SimulationResult {
  const surplus = monthlySurplus(p);
  const reserveBefore = p.reserveCurrent;
  const reserveAfter = roundMoney(reserveBefore - cost);
  const reductionPct = reserveBefore > 0 ? (cost / reserveBefore) * 100 : 100;

  // months to restore reserve to target from the post-purchase level
  let monthsToRestore: number | null = null;
  if (surplus > 0) {
    const deficitAfter = Math.max(0, p.reserveTarget - reserveAfter);
    monthsToRestore = deficitAfter === 0 ? 0 : Math.ceil(deficitAfter / surplus);
  }

  // baseline vs post-purchase projection
  const baseline = projectFunding(p, items, {});
  const after = projectFunding(p, items, { startReserve: reserveAfter });

  const goalImpacts: GoalImpact[] = items
    .filter((i) => i.type === 'GOAL' && isActive(i))
    .map((g) => {
      const b = baseline.completionMonth[g.id] ?? null;
      const n = after.completionMonth[g.id] ?? null;
      const nowUnfundable = b !== null && n === null;
      const delayMonths = b !== null && n !== null ? Math.max(0, n - b) : 0;
      return { title: g.title, baselineMonth: b, newMonth: n, delayMonths, nowUnfundable };
    });

  // Dated commitments/goals/experiences the purchase NEWLY pushes past their due date
  // (breached after the purchase but not before — so we attribute the breach to the purchase).
  const baselineBreaches = dueDateBreaches(items, baseline, nowIso);
  const afterBreaches = dueDateBreaches(items, after, nowIso);
  const underfunded = items
    .filter((i) => afterBreaches.has(i.id) && !baselineBreaches.has(i.id))
    .map((i) => i.title);

  let recommendation: Recommendation = 'SAFE';
  if (
    reserveAfter < 0 ||
    goalImpacts.some((g) => g.delayMonths > 0 || g.nowUnfundable) ||
    underfunded.length > 0
  ) {
    recommendation = 'WAIT';
  } else if (reductionPct > 10) {
    recommendation = 'CAUTION';
  }

  const message = buildMessage(reductionPct, goalImpacts, underfunded, recommendation, reserveAfter);
  return {
    cost,
    reserveBefore,
    reserveAfter,
    reductionPct,
    monthsToRestore,
    goalImpacts,
    underfunded,
    recommendation,
    message,
  };
}

export function remaining(item: Item): number {
  return Math.max(0, item.amount - item.fundedAmount);
}

export function monthsToFullyFund(p: Profile, items: Item[]): number | null {
  const surplus = monthlySurplus(p);
  if (surplus <= 0) return null;
  return totalFutureLiability(items).total / surplus;
}

export interface MonthlyAllocation {
  month: string; // 'Mon YYYY'
  reserve: number;
  items: { id: string; title: string; amount: number }[];
}

export interface AllocationOpts {
  months?: number;
  fromIso: string;
  startReserve?: number;
}

/**
 * Per-month allocation of monthly surplus over a horizon, labeling each month and
 * recording how much went to reserve refill and to each fundable item. Thin wrapper
 * over `runAllocation` (the shared rule), so it can't drift from `projectFunding`. Pure.
 */
export function projectMonthlyAllocation(
  p: Profile,
  items: Item[],
  opts: AllocationOpts,
): MonthlyAllocation[] {
  const months = opts.months ?? 12;
  const { steps } = runAllocation(p, items, { months, startReserve: opts.startReserve });
  const from = new Date(opts.fromIso);
  return steps.map((step, i) => ({
    month: new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1),
    ).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
    reserve: step.reserveAdded,
    items: step.items,
  }));
}

export function isDone(item: Item): boolean {
  return item.status === 'COMPLETED' || (item.type === 'WISHLIST' && item.purchased);
}

export function isActive(item: Item): boolean {
  return !isDone(item);
}

export function totalFutureLiability(items: Item[]): {
  total: number;
  breakdown: { title: string; remaining: number }[];
} {
  const active = sortQueue(items).filter((i) => isActive(i) && remaining(i) > 0);
  const breakdown = active.map((i) => ({ title: i.title, remaining: remaining(i) }));
  const total = breakdown.reduce((s, b) => s + b.remaining, 0);
  return { total, breakdown };
}

export function reserveRecoveryMonths(p: Profile): number | null {
  const surplus = monthlySurplus(p);
  if (surplus <= 0) return null;
  return reserveDeficit(p) / surplus;
}

export interface ProjectedItem {
  monthIndex: number | null;
  isoDate: string | null;
  behindMonths: number | null;
}

function addMonths(iso: string, months: number): Date {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

export function projectedCompletion(
  p: Profile,
  items: Item[],
  fromIso: string,
): Record<string, ProjectedItem> {
  const active = items.filter(isActive);
  const proj = projectFunding(p, active, {});
  const out: Record<string, ProjectedItem> = {};
  for (const it of active) {
    const monthIndex = proj.completionMonth[it.id] ?? null;
    if (monthIndex === null) {
      out[it.id] = { monthIndex: null, isoDate: null, behindMonths: null };
      continue;
    }
    const date = addMonths(fromIso, monthIndex);
    let behindMonths: number | null = null;
    if (it.dueDate) {
      const due = new Date(it.dueDate);
      const dueMonth = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), 1));
      behindMonths = Math.max(0, monthsBetween(dueMonth, date));
    }
    out[it.id] = { monthIndex, isoDate: date.toISOString(), behindMonths };
  }
  return out;
}

function buildMessage(
  reductionPct: number,
  goalImpacts: GoalImpact[],
  underfunded: string[],
  rec: Recommendation,
  reserveAfter: number,
): string {
  if (reserveAfter < 0) {
    return `This purchase exceeds your Opportunity Reserve. Recommendation: Wait.`;
  }
  const clauses: string[] = [];
  if (underfunded.length > 0) {
    clauses.push(`pushes ${underfunded.join(', ')} past ${underfunded.length > 1 ? 'their' : 'its'} due date`);
  }
  const unfundable = goalImpacts.filter((g) => g.nowUnfundable).map((g) => g.title);
  if (unfundable.length > 0) {
    clauses.push(`leaves ${unfundable.join(', ')} unfundable within the 10-year horizon`);
  }
  const delayed = goalImpacts.filter((g) => g.delayMonths > 0);
  if (delayed.length > 0) {
    clauses.push(
      `delays ${delayed.map((g) => `${g.title} by ${g.delayMonths} month${g.delayMonths > 1 ? 's' : ''}`).join(', ')}`,
    );
  }
  if (clauses.length > 0) {
    return `This ${clauses.join('; ')}. Recommendation: Wait.`;
  }
  if (rec === 'CAUTION') {
    return `This reduces your reserve by ${reductionPct.toFixed(1)}%. No goal impact, but it's a sizable draw. Recommendation: Proceed with caution.`;
  }
  return `This reduces your reserve by ${reductionPct.toFixed(1)}%. No impact on funded commitments. Recommendation: Safe to buy.`;
}
