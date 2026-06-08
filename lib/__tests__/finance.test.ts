import { describe, it, expect } from 'vitest';
import {
  monthlySurplus,
  reserveDeficit,
  fundingProgress,
  sortQueue,
  projectFunding,
  simulatePurchase,
  remaining,
  isDone,
  isActive,
  totalFutureLiability,
  reserveRecoveryMonths,
  projectedCompletion,
  monthsToFullyFund,
  projectMonthlyAllocation,
} from '@/lib/finance';
import type { Item, Profile } from '@/lib/types';

const profile: Profile = {
  protectedCapital: 200000,
  reserveTarget: 500000,
  reserveCurrent: 420000,
  monthlyIncome: 150000,
  monthlyExpenses: 70000,
  monthlyInvestments: 30000,
};

function item(p: Partial<Item>): Item {
  return {
    id: Math.random().toString(36).slice(2),
    type: 'GOAL',
    title: 't',
    amount: 100000,
    fundedAmount: 0,
    priority: 3,
    rank: 0,
    dueDate: null,
    status: null,
    notes: null,
    coolingPeriodDays: 30,
    dateAdded: '2026-06-07T00:00:00.000Z',
    purchased: false,
    ...p,
  };
}

describe('monthlySurplus', () => {
  it('is income - expenses - investments', () => {
    expect(monthlySurplus(profile)).toBe(50000);
  });
});

describe('reserveDeficit', () => {
  it('is positive target minus current', () => {
    expect(reserveDeficit(profile)).toBe(80000);
  });
  it('is 0 when current exceeds target', () => {
    expect(reserveDeficit({ ...profile, reserveCurrent: 600000 })).toBe(0);
  });
});

describe('fundingProgress', () => {
  it('computes percentage', () => {
    expect(fundingProgress(item({ amount: 100000, fundedAmount: 60000 }))).toEqual({
      funded: 60000,
      target: 100000,
      pct: 60,
    });
  });
  it('returns 0 pct when target is 0', () => {
    expect(fundingProgress(item({ amount: 0, fundedAmount: 0 })).pct).toBe(0);
  });
});

describe('sortQueue', () => {
  it('sorts priority desc then due date asc, excludes wishlist', () => {
    const items = [
      item({ title: 'Car', priority: 4, dueDate: '2027-01-01T00:00:00.000Z' }),
      item({ title: 'Laptop', priority: 5, dueDate: '2026-07-01T00:00:00.000Z', type: 'COMMITMENT' }),
      item({ title: 'Wedding', priority: 5, dueDate: '2026-08-01T00:00:00.000Z', type: 'COMMITMENT' }),
      item({ title: 'Crocs', priority: 5, type: 'WISHLIST' }),
    ];
    expect(sortQueue(items).map((i) => i.title)).toEqual(['Laptop', 'Wedding', 'Car']);
  });
});

describe('projectFunding', () => {
  it('refills reserve first, then funds items by priority', () => {
    const p = { ...profile };
    const items = [
      item({ id: 'a', title: 'Laptop', type: 'COMMITMENT', priority: 5, amount: 100000, fundedAmount: 0 }),
    ];
    const res = projectFunding(p, items, {});
    // surplus 50k. reserve deficit 80k => m1 refill 50k, m2 refill 30k leaving 20k for items.
    // m2 items=20k, m3 +50k=70k, m4 +50k=120k>=100k => month 4.
    expect(res.completionMonth['a']).toBe(4);
  });

  it('honors startReserve override (purchase scenario lowers reserve)', () => {
    const p = { ...profile };
    const items = [item({ id: 'a', title: 'Laptop', type: 'COMMITMENT', priority: 5, amount: 100000 })];
    const res = projectFunding(p, items, { startReserve: 300000 });
    expect(res.completionMonth['a']).toBeGreaterThan(4);
  });

  it('never funds wishlist items', () => {
    const items = [item({ id: 'w', type: 'WISHLIST', amount: 5000, priority: 5 })];
    const res = projectFunding({ ...profile }, items, {});
    expect(res.completionMonth['w']).toBeUndefined();
  });

  it('caps at the horizon when surplus cannot fund an item', () => {
    const p = { ...profile, monthlyIncome: 100000, monthlyExpenses: 100000, monthlyInvestments: 0 };
    const items = [item({ id: 'a', type: 'GOAL', amount: 100000, fundedAmount: 0 })];
    const res = projectFunding(p, items, {});
    expect(res.completionMonth['a']).toBeUndefined();
  });
});

describe('simulatePurchase', () => {
  const goals: Item[] = [
    item({
      id: 'car',
      title: 'Car',
      type: 'GOAL',
      priority: 4,
      amount: 600000,
      fundedAmount: 0,
      dueDate: '2028-01-01T00:00:00.000Z',
    }),
  ];

  it('small purchase is SAFE with no goal impact', () => {
    const r = simulatePurchase({ ...profile }, goals, 5400);
    expect(r.reserveBefore).toBe(420000);
    expect(r.reserveAfter).toBe(414600);
    expect(r.recommendation).toBe('SAFE');
    expect(r.goalImpacts.every((g) => g.delayMonths === 0)).toBe(true);
  });

  it('large purchase that delays a goal recommends WAIT', () => {
    const r = simulatePurchase({ ...profile }, goals, 200000);
    expect(r.reserveAfter).toBe(220000);
    const car = r.goalImpacts.find((g) => g.title === 'Car');
    expect(car!.delayMonths).toBeGreaterThan(0);
    expect(r.recommendation).toBe('WAIT');
  });

  it('purchase larger than reserve recommends WAIT and flags negative', () => {
    const r = simulatePurchase({ ...profile }, goals, 500000);
    expect(r.reserveAfter).toBeLessThan(0);
    expect(r.recommendation).toBe('WAIT');
  });

  it('reports reductionPct', () => {
    const r = simulatePurchase({ ...profile }, goals, 42000);
    expect(Math.round(r.reductionPct * 10) / 10).toBe(10);
  });

  it('zero surplus yields null monthsToRestore', () => {
    const p = { ...profile, monthlyIncome: 100000, monthlyExpenses: 100000, monthlyInvestments: 0 };
    const r = simulatePurchase(p, goals, 50000);
    expect(r.monthsToRestore).toBeNull();
  });

  it('flags a commitment newly pushed past its due date and recommends WAIT', () => {
    const now = '2026-06-01T00:00:00.000Z';
    // Trip due in 6 months. Baseline funds it by ~month 4 (on time); a big purchase
    // drains the reserve so refill pushes funding past the due date.
    const trip = item({
      id: 'trip', title: 'Trip', type: 'COMMITMENT', priority: 5,
      amount: 100000, fundedAmount: 0, dueDate: '2026-12-01T00:00:00.000Z',
    });
    const safe = simulatePurchase({ ...profile }, [trip], 5000, now);
    expect(safe.underfunded).toEqual([]); // small purchase doesn't breach
    const wait = simulatePurchase({ ...profile }, [trip], 200000, now);
    expect(wait.underfunded).toContain('Trip');
    expect(wait.recommendation).toBe('WAIT');
  });

  it('marks a goal nowUnfundable instead of using a 999 sentinel', () => {
    const r = simulatePurchase({ ...profile }, goals, 5400);
    expect(r.goalImpacts.every((g) => g.nowUnfundable === false)).toBe(true);
    expect(r.goalImpacts.every((g) => g.delayMonths !== 999)).toBe(true);
  });
});

describe('remaining', () => {
  it('is target minus funded, floored at 0', () => {
    expect(remaining(item({ amount: 100000, fundedAmount: 60000 }))).toBe(40000);
    expect(remaining(item({ amount: 100000, fundedAmount: 120000 }))).toBe(0);
  });
});

describe('isDone / isActive', () => {
  it('completed status is done', () => {
    expect(isDone(item({ status: 'COMPLETED' }))).toBe(true);
  });
  it('purchased wishlist is done', () => {
    expect(isDone(item({ type: 'WISHLIST', purchased: true }))).toBe(true);
  });
  it('planned item is active', () => {
    expect(isActive(item({ status: 'PLANNED' }))).toBe(true);
  });
});

describe('totalFutureLiability', () => {
  it('sums remaining for active non-wishlist items', () => {
    const items = [
      item({ title: 'Laptop', type: 'COMMITMENT', amount: 100000, fundedAmount: 60000, priority: 5, dueDate: '2026-07-01T00:00:00.000Z' }),
      item({ title: 'Car', type: 'GOAL', amount: 600000, fundedAmount: 120000, priority: 4, dueDate: '2028-01-01T00:00:00.000Z' }),
      item({ title: 'Crocs', type: 'WISHLIST', amount: 5400, fundedAmount: 0 }),
      item({ title: 'Done', type: 'GOAL', amount: 1000, fundedAmount: 0, status: 'COMPLETED' }),
    ];
    const r = totalFutureLiability(items);
    expect(r.total).toBe(40000 + 480000);
    expect(r.breakdown.map((b) => b.title)).toEqual(['Laptop', 'Car']);
  });
});

describe('reserveRecoveryMonths', () => {
  it('is deficit over surplus', () => {
    expect(reserveRecoveryMonths(profile)).toBeCloseTo(1.6, 1); // 80000/50000
  });
  it('is null when surplus is zero', () => {
    expect(
      reserveRecoveryMonths({ ...profile, monthlyIncome: 100000, monthlyExpenses: 100000, monthlyInvestments: 0 }),
    ).toBeNull();
  });
});

describe('projectedCompletion', () => {
  const from = '2026-06-01T00:00:00.000Z';
  it('maps month index to a future date and flags behind target', () => {
    const items = [
      item({ id: 'car', title: 'Car', type: 'GOAL', priority: 4, amount: 600000, fundedAmount: 0, dueDate: '2026-08-01T00:00:00.000Z' }),
    ];
    const r = projectedCompletion(profile, items, from);
    expect(r['car'].monthIndex).not.toBeNull();
    expect(r['car'].isoDate).not.toBeNull();
    expect(r['car'].behindMonths).toBeGreaterThan(0);
  });
  it('returns null projection when surplus cannot fund', () => {
    const p = { ...profile, monthlyIncome: 100000, monthlyExpenses: 100000, monthlyInvestments: 0 };
    const items = [item({ id: 'g', type: 'GOAL', amount: 100000, fundedAmount: 0, dueDate: from })];
    const r = projectedCompletion(p, items, from);
    expect(r['g'].monthIndex).toBeNull();
    expect(r['g'].behindMonths).toBeNull();
  });
});

describe('sortQueue rank tiebreak', () => {
  it('orders by rank within the same priority', () => {
    const items = [
      item({ title: 'B', priority: 5, rank: 2, type: 'COMMITMENT', dueDate: '2026-07-01T00:00:00.000Z' }),
      item({ title: 'A', priority: 5, rank: 1, type: 'COMMITMENT', dueDate: '2026-09-01T00:00:00.000Z' }),
      item({ title: 'C', priority: 4, rank: 0, type: 'GOAL', dueDate: '2026-06-01T00:00:00.000Z' }),
    ];
    expect(sortQueue(items).map((i) => i.title)).toEqual(['A', 'B', 'C']);
  });
});

describe('monthsToFullyFund', () => {
  it('is total remaining over surplus', () => {
    const items = [
      item({ title: 'A', type: 'COMMITMENT', amount: 100000, fundedAmount: 0, priority: 5, dueDate: '2026-07-01T00:00:00.000Z' }),
    ];
    expect(monthsToFullyFund(profile, items)).toBeCloseTo(2, 5);
  });
  it('is null when surplus <= 0', () => {
    expect(
      monthsToFullyFund({ ...profile, monthlyIncome: 100000, monthlyExpenses: 100000, monthlyInvestments: 0 }, []),
    ).toBeNull();
  });
});

describe('projectMonthlyAllocation', () => {
  const from = '2026-06-01T00:00:00.000Z';
  it('returns one entry per month of the horizon', () => {
    const r = projectMonthlyAllocation(profile, [], { months: 12, fromIso: from });
    expect(r).toHaveLength(12);
    expect(r[0].month).toBe('Jun 2026');
  });
  it('allocates to reserve refill before items', () => {
    const items = [item({ id: 'a', title: 'Laptop', type: 'COMMITMENT', priority: 5, amount: 100000, fundedAmount: 0, dueDate: from })];
    const r = projectMonthlyAllocation(profile, items, { months: 3, fromIso: from });
    expect(r[0].reserve).toBe(50000);
    expect(r[0].items).toHaveLength(0);
    expect(r[1].reserve).toBe(30000);
    expect(r[1].items[0]).toMatchObject({ id: 'a', amount: 20000 });
  });
  it('never allocates to wishlist', () => {
    const items = [item({ id: 'w', type: 'WISHLIST', amount: 5000, priority: 5 })];
    const r = projectMonthlyAllocation(profile, items, { months: 3, fromIso: from });
    expect(r.every((m) => m.items.length === 0)).toBe(true);
  });
  it('honors startReserve (simulated lower reserve delays item funding)', () => {
    const items = [item({ id: 'a', title: 'L', type: 'COMMITMENT', priority: 5, amount: 100000, fundedAmount: 0, dueDate: from })];
    const base = projectMonthlyAllocation(profile, items, { months: 6, fromIso: from });
    const sim = projectMonthlyAllocation(profile, items, { months: 6, fromIso: from, startReserve: 200000 });
    const baseItemTotal = base.reduce((s, m) => s + (m.items[0]?.amount ?? 0), 0);
    const simItemTotal = sim.reduce((s, m) => s + (m.items[0]?.amount ?? 0), 0);
    expect(simItemTotal).toBeLessThan(baseItemTotal);
  });
});
