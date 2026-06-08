import { describe, it, expect } from 'vitest';
import { deriveDashboardModel } from '@/lib/dashboard';
import { simulatePurchase, projectMonthlyAllocation } from '@/lib/finance';
import type { Item, Profile } from '@/lib/types';

const profile: Profile = {
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
    dateAdded: '2026-06-08T00:00:00.000Z',
    purchased: false,
    ...p,
  };
}

const items: Item[] = [
  item({ id: 'car', title: 'Car', type: 'GOAL', priority: 4, amount: 600000, fundedAmount: 120000, dueDate: '2028-01-01T00:00:00.000Z' }),
  item({ id: 'lap', title: 'Laptop', type: 'COMMITMENT', priority: 5, amount: 100000, fundedAmount: 60000, dueDate: '2026-07-15T00:00:00.000Z' }),
];
const now = '2026-06-08T00:00:00.000Z';

describe('deriveDashboardModel (What-If recompute = same pure functions as the server)', () => {
  it('cost 0: no simulation; projection uses the full reserve', () => {
    const m = deriveDashboardModel(profile, items, 0, now);
    expect(m.sim).toBeNull();
    expect(m.effReserveCurrent).toBe(profile.reserveCurrent);
    expect(m.reservePct).toBe(84); // 420000/500000
    expect(m.projection).toEqual(
      projectMonthlyAllocation(profile, items, { months: 12, fromIso: now, startReserve: 420000 }),
    );
  });

  it('cost > 0: model.sim is byte-for-byte simulatePurchase (identical to the server)', () => {
    const cost = 200000;
    const m = deriveDashboardModel(profile, items, cost, now);
    expect(m.sim).toEqual(simulatePurchase(profile, items, cost));
  });

  it('cost > 0: projection recomputes from the reduced startReserve and differs from cost 0', () => {
    const cost = 200000;
    const m = deriveDashboardModel(profile, items, cost, now);
    const reduced = projectMonthlyAllocation(profile, items, {
      months: 12,
      fromIso: now,
      startReserve: profile.reserveCurrent - cost, // 220000
    });
    expect(m.projection).toEqual(reduced);
    expect(m.effReserveCurrent).toBe(220000);
    expect(m.reservePct).toBe(44); // 220000/500000
    const full = deriveDashboardModel(profile, items, 0, now).projection;
    expect(m.projection).not.toEqual(full); // reduced-reserve path actually exercised
  });
});
