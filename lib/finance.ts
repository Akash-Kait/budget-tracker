import type { Item, Profile, Recommendation } from '@/lib/types';

export function monthlySurplus(p: Profile): number {
  return p.monthlyIncome - p.monthlyExpenses - p.monthlyInvestments;
}

export function reserveDeficit(p: Profile): number {
  return Math.max(0, p.reserveTarget - p.reserveCurrent);
}

export function fundingProgress(item: Item): { funded: number; target: number; pct: number } {
  const pct = item.amount > 0 ? Math.round((item.fundedAmount / item.amount) * 100) : 0;
  return { funded: item.fundedAmount, target: item.amount, pct };
}

/** Queue: non-wishlist items, priority desc, then dueDate asc (nulls last), then title. */
export function sortQueue(items: Item[]): Item[] {
  return items
    .filter((i) => i.type !== 'WISHLIST')
    .slice()
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
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
 * Month-by-month allocation of monthly surplus.
 * Each month: add surplus to pool, refill Opportunity Reserve to target first,
 * then fund queue items (priority desc, due asc), skipping wishlist/completed/purchased.
 */
export function projectFunding(p: Profile, items: Item[], opts: ProjectOpts): ProjectionResult {
  const surplus = Math.max(0, monthlySurplus(p));
  const horizon = opts.horizon ?? 120;
  let reserve = opts.startReserve ?? p.reserveCurrent;

  const fundable = sortQueue(items).filter(
    (i) => i.status !== 'COMPLETED' && !i.purchased,
  );
  const funded: Record<string, number> = {};
  fundable.forEach((i) => (funded[i.id] = i.fundedAmount));

  const completionMonth: Record<string, number> = {};
  // already-complete items complete at month 0
  fundable.forEach((i) => {
    if (funded[i.id] >= i.amount && i.amount > 0) completionMonth[i.id] = 0;
  });

  for (let month = 1; month <= horizon; month++) {
    let pool = surplus;
    if (pool <= 0) break;

    // 1. refill reserve to target
    if (reserve < p.reserveTarget) {
      const need = p.reserveTarget - reserve;
      const add = Math.min(need, pool);
      reserve += add;
      pool -= add;
    }

    // 2. fund items in priority order
    for (const it of fundable) {
      if (pool <= 0) break;
      if (completionMonth[it.id] !== undefined) continue;
      const need = it.amount - funded[it.id];
      if (need <= 0) {
        completionMonth[it.id] = month;
        continue;
      }
      const add = Math.min(need, pool);
      funded[it.id] += add;
      pool -= add;
      if (funded[it.id] >= it.amount) completionMonth[it.id] = month;
    }

    if (fundable.every((i) => completionMonth[i.id] !== undefined)) break;
  }

  return { completionMonth };
}

export interface GoalImpact {
  title: string;
  baselineMonth: number | null;
  newMonth: number | null;
  delayMonths: number;
}

export interface SimulationResult {
  cost: number;
  reserveBefore: number;
  reserveAfter: number;
  reductionPct: number;
  monthsToRestore: number | null;
  goalImpacts: GoalImpact[];
  underfunded: string[];
  recommendation: Recommendation;
  message: string;
}

export function simulatePurchase(p: Profile, items: Item[], cost: number): SimulationResult {
  const surplus = monthlySurplus(p);
  const reserveBefore = p.reserveCurrent;
  const reserveAfter = reserveBefore - cost;
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
    .filter((i) => i.type === 'GOAL')
    .map((g) => {
      const b = baseline.completionMonth[g.id] ?? null;
      const n = after.completionMonth[g.id] ?? null;
      const delay =
        b !== null && n !== null
          ? Math.max(0, n - b)
          : b === null && n === null
            ? 0
            : 999;
      return { title: g.title, baselineMonth: b, newMonth: n, delayMonths: delay };
    });

  // commitments/experiences with due dates that the projection can't fund within the horizon
  const underfunded: string[] = [];
  for (const it of items) {
    if (it.type === 'WISHLIST' || !it.dueDate) continue;
    const completeMonth = after.completionMonth[it.id];
    if (completeMonth === undefined) underfunded.push(it.title);
  }

  let recommendation: Recommendation = 'SAFE';
  if (reserveAfter < 0 || goalImpacts.some((g) => g.delayMonths > 0)) {
    recommendation = 'WAIT';
  } else if (reductionPct > 10) {
    recommendation = 'CAUTION';
  }

  const message = buildMessage(reductionPct, goalImpacts, recommendation, reserveAfter);
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

function buildMessage(
  reductionPct: number,
  goalImpacts: GoalImpact[],
  rec: Recommendation,
  reserveAfter: number,
): string {
  if (reserveAfter < 0) {
    return `This purchase exceeds your Opportunity Reserve. Recommendation: Wait.`;
  }
  const delayed = goalImpacts.filter((g) => g.delayMonths > 0);
  if (delayed.length > 0) {
    const parts = delayed.map(
      (g) => `${g.title} by ${g.delayMonths} month${g.delayMonths > 1 ? 's' : ''}`,
    );
    return `This delays ${parts.join(', ')}. Recommendation: Wait.`;
  }
  if (rec === 'CAUTION') {
    return `This reduces your reserve by ${reductionPct.toFixed(1)}%. No goal impact, but it's a sizable draw. Recommendation: Proceed with caution.`;
  }
  return `This reduces your reserve by ${reductionPct.toFixed(1)}%. No impact on funded commitments. Recommendation: Safe to buy.`;
}
