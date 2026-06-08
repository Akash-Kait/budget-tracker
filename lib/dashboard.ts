import {
  monthlySurplus,
  reserveRecoveryMonths,
  totalFutureLiability,
  monthsToFullyFund,
  sortQueue,
  isActive,
  fundingProgress,
  projectMonthlyAllocation,
  simulatePurchase,
} from '@/lib/finance';
import type { SimulationResult, MonthlyAllocation } from '@/lib/finance';
import type { Item, Profile } from '@/lib/types';

export interface DashboardModel {
  active: Item[];
  surplus: number;
  reservePct: number;
  effReserveCurrent: number;
  recovery: number | null;
  liability: ReturnType<typeof totalFutureLiability>;
  topUnfunded: string | null;
  monthsToFund: number | null;
  sim: SimulationResult | null;
  projection: MonthlyAllocation[];
}

/**
 * The Planning dashboard's derived model — extracted verbatim from the Dashboard component so it is
 * pure and testable. When `costNum > 0` it applies the Quick What-If: the reserve is reduced by the
 * cost and the projection is recomputed from that reduced `startReserve`, using the SAME pure finance
 * functions the server's /api/simulate uses. Planning-only imports (firewall: no wealth/market).
 */
export function deriveDashboardModel(
  profile: Profile,
  items: Item[],
  costNum: number,
  nowIso: string,
): DashboardModel {
  const active = sortQueue(items.filter(isActive));
  const sim = costNum > 0 ? simulatePurchase(profile, items, costNum) : null;
  const effReserveCurrent = sim ? profile.reserveCurrent - costNum : profile.reserveCurrent;

  const surplus = monthlySurplus(profile);
  const reservePct =
    profile.reserveTarget > 0 ? Math.round((effReserveCurrent / profile.reserveTarget) * 100) : 0;
  const liability = totalFutureLiability(items);
  const topUnfunded = active.find((i) => fundingProgress(i).pct < 100)?.title ?? null;
  const monthsToFund = monthsToFullyFund(profile, items);
  const recovery = reserveRecoveryMonths({ ...profile, reserveCurrent: effReserveCurrent });
  const projection = projectMonthlyAllocation(profile, items, {
    months: 12,
    fromIso: nowIso,
    startReserve: effReserveCurrent,
  });

  return {
    active,
    surplus,
    reservePct,
    effReserveCurrent,
    recovery,
    liability,
    topUnfunded,
    monthsToFund,
    sim,
    projection,
  };
}
