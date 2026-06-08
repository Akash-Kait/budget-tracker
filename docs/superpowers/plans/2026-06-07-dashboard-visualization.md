# Dashboard Visualization Implementation Plan (Iteration 4)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Add a zero-dependency visual layer to the home dashboard (6 visualizations + 4 KPI cards) with an interactive Quick What-If simulator that recomputes all metrics/charts client-side.

**Architecture:** `/` becomes a server component that loads profile + items and renders a client `<Dashboard>` holding what-if state. All chart math is pure functions in `lib/finance.ts`. Charts are Tailwind + inline SVG/CSS — no chart library.

**Tech Stack:** Next.js (App Router), TypeScript, Tailwind, Prisma/SQLite. No new dependencies.

---

## Task 1: monthsToFullyFund + projectMonthlyAllocation (TDD)

**Files:** Modify `lib/finance.ts`; append `lib/__tests__/finance.test.ts`

- [ ] **Step 1: Failing tests** (append):
```typescript
import { monthsToFullyFund, projectMonthlyAllocation } from '@/lib/finance';

describe('monthsToFullyFund', () => {
  it('is total remaining over surplus', () => {
    const items = [
      item({ title: 'A', type: 'COMMITMENT', amount: 100000, fundedAmount: 0, priority: 5, dueDate: '2026-07-01T00:00:00.000Z' }),
    ];
    // liability 100000 / surplus 50000 = 2
    expect(monthsToFullyFund(profile, items)).toBeCloseTo(2, 5);
  });
  it('is null when surplus <= 0', () => {
    expect(monthsToFullyFund({ ...profile, monthlyIncome: 100000, monthlyExpenses: 100000, monthlyInvestments: 0 }, [])).toBeNull();
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
    // deficit 80k, surplus 50k: m1 all 50k to reserve; m2 30k reserve + 20k item.
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
```
- [ ] **Step 2:** `npm test -- finance` → FAIL.
- [ ] **Step 3: Implement** (append to `lib/finance.ts`). Note `formatMonth` import is already not present; compute label inline:
```typescript
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

export function projectMonthlyAllocation(
  p: Profile,
  items: Item[],
  opts: AllocationOpts,
): MonthlyAllocation[] {
  const months = opts.months ?? 12;
  const surplus = Math.max(0, monthlySurplus(p));
  let reserve = opts.startReserve ?? p.reserveCurrent;

  const fundable = sortQueue(items).filter((i) => i.status !== 'COMPLETED' && !i.purchased);
  const funded: Record<string, number> = {};
  fundable.forEach((i) => (funded[i.id] = i.fundedAmount));

  const out: MonthlyAllocation[] = [];
  const from = new Date(opts.fromIso);
  for (let m = 0; m < months; m++) {
    const label = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + m, 1)).toLocaleDateString(
      'en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' },
    );
    const entry: MonthlyAllocation = { month: label, reserve: 0, items: [] };
    let pool = surplus;

    if (pool > 0 && reserve < p.reserveTarget) {
      const add = Math.min(p.reserveTarget - reserve, pool);
      reserve += add;
      pool -= add;
      entry.reserve = add;
    }
    for (const it of fundable) {
      if (pool <= 0) break;
      const need = it.amount - funded[it.id];
      if (need <= 0) continue;
      const add = Math.min(need, pool);
      funded[it.id] += add;
      pool -= add;
      entry.items.push({ id: it.id, title: it.title, amount: add });
    }
    out.push(entry);
  }
  return out;
}
```
- [ ] **Step 4:** `npm test` → all pass.
- [ ] **Step 5:** Commit.

---

## Task 2: Reusable color palette helper

**Files:** Create `lib/colors.ts`

- [ ] **Step 1:** A small deterministic palette so the projection legend and bars share colors:
```typescript
const PALETTE = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#6366f1', '#84cc16', '#f97316'];

export function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

export const RESERVE_COLOR = '#94a3b8';
```
- [ ] **Step 2:** Commit.

---

## Task 3: ReserveGauge

**Files:** Create `components/dashboard/ReserveGauge.tsx`

- [ ] **Step 1:** SVG radial gauge:
```tsx
import { Money } from '@/components/Money';

function color(pct: number): string {
  if (pct >= 90) return '#10b981';
  if (pct >= 70) return '#f59e0b';
  return '#ef4444';
}

export function ReserveGauge({
  current, target, recoveryMonths,
}: { current: number; target: number; recoveryMonths: number | null }) {
  const pct = target > 0 ? Math.round((current / target) * 100) : 0;
  const clamped = Math.max(0, Math.min(100, pct));
  const r = 70;
  const circ = 2 * Math.PI * r;
  const dash = (clamped / 100) * circ;
  return (
    <div className="flex flex-col items-center">
      <svg width="180" height="180" viewBox="0 0 180 180">
        <circle cx="90" cy="90" r={r} fill="none" stroke="#e5e7eb" strokeWidth="14" />
        <circle
          cx="90" cy="90" r={r} fill="none" stroke={color(pct)} strokeWidth="14"
          strokeLinecap="round" strokeDasharray={`${dash} ${circ}`} transform="rotate(-90 90 90)"
        />
        <text x="90" y="84" textAnchor="middle" className="fill-gray-900" fontSize="28" fontWeight="700">{pct}%</text>
        <text x="90" y="106" textAnchor="middle" className="fill-gray-500" fontSize="11">healthy ≥ 90%</text>
      </svg>
      <p className="mt-2 text-sm text-gray-600"><Money amount={current} /> / <Money amount={target} /></p>
      <p className="text-xs text-gray-500">Recovery: {recoveryMonths === null ? '—' : `${recoveryMonths.toFixed(1)} months`}</p>
    </div>
  );
}
```
- [ ] **Step 2:** Commit.

---

## Task 4: FundingBars

**Files:** Create `components/dashboard/FundingBars.tsx`

- [ ] **Step 1:**
```tsx
import { Money } from '@/components/Money';
import type { Item } from '@/lib/types';

export function FundingBars({ items }: { items: Item[] }) {
  if (items.length === 0) return <p className="text-sm text-gray-500">No active items.</p>;
  return (
    <div className="space-y-3">
      {items.map((i) => {
        const pct = i.amount > 0 ? Math.round((i.fundedAmount / i.amount) * 100) : 0;
        const remaining = Math.max(0, i.amount - i.fundedAmount);
        return (
          <div key={i.id}>
            <div className="mb-1 flex justify-between text-xs">
              <span className="font-medium text-gray-700">{i.title}</span>
              <span className="text-gray-500">{pct}% · <Money amount={remaining} /> left</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
```
- [ ] **Step 2:** Commit.

---

## Task 5: LiabilityTreemap

**Files:** Create `components/dashboard/LiabilityTreemap.tsx`

- [ ] **Step 1:** Proportional tiles via flex-grow (area ∝ remaining):
```tsx
import { formatINR } from '@/lib/format';
import { colorFor } from '@/lib/colors';

export function LiabilityTreemap({ data }: { data: { title: string; remaining: number }[] }) {
  if (data.length === 0) return <p className="text-sm text-gray-500">No outstanding obligations.</p>;
  const total = data.reduce((s, d) => s + d.remaining, 0);
  return (
    <div className="flex h-56 w-full flex-wrap gap-1">
      {data.map((d, idx) => {
        const share = total > 0 ? d.remaining / total : 0;
        return (
          <div
            key={d.title}
            className="flex min-w-[90px] flex-col justify-between rounded-lg p-3 text-white"
            style={{ flexGrow: Math.max(1, Math.round(share * 100)), flexBasis: `${Math.max(15, share * 100)}%`, backgroundColor: colorFor(idx) }}
          >
            <span className="text-sm font-semibold">{d.title}</span>
            <span className="text-xs opacity-90">{formatINR(d.remaining)} · {Math.round(share * 100)}%</span>
          </div>
        );
      })}
    </div>
  );
}
```
- [ ] **Step 2:** Commit.

---

## Task 6: GoalTimeline

**Files:** Create `components/dashboard/GoalTimeline.tsx`

- [ ] **Step 1:** Horizontal axis positioned by dueDate:
```tsx
import { formatMonth } from '@/lib/format';
import type { Item } from '@/lib/types';

export function GoalTimeline({ items }: { items: Item[] }) {
  const dated = items.filter((i) => i.dueDate).sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());
  if (dated.length === 0) return <p className="text-sm text-gray-500">Nothing scheduled.</p>;
  const times = dated.map((i) => new Date(i.dueDate!).getTime());
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = max - min || 1;
  return (
    <div className="relative mt-6 pb-10">
      <div className="absolute left-0 right-0 top-3 h-0.5 bg-gray-200" />
      <div className="relative flex justify-between">
        {dated.map((i) => {
          const pos = ((new Date(i.dueDate!).getTime() - min) / span) * 100;
          return (
            <div key={i.id} className="absolute -translate-x-1/2" style={{ left: `${pos}%` }}>
              <div className="mx-auto h-3 w-3 rounded-full bg-blue-500" />
              <div className="mt-1 whitespace-nowrap text-center text-[10px] text-gray-600">
                <div className="font-medium">{i.title}</div>
                <div className="text-gray-400">{formatMonth(i.dueDate!)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```
(Note: absolute positioning can overlap when dates cluster; acceptable for MVP, desktop-first.)
- [ ] **Step 2:** Commit.

---

## Task 7: SurplusProjection

**Files:** Create `components/dashboard/SurplusProjection.tsx`

- [ ] **Step 1:** 12 stacked bars + legend:
```tsx
import { formatINR } from '@/lib/format';
import { colorFor, RESERVE_COLOR } from '@/lib/colors';
import type { MonthlyAllocation } from '@/lib/finance';

export function SurplusProjection({ data, surplus }: { data: MonthlyAllocation[]; surplus: number }) {
  if (surplus <= 0) return <p className="text-sm text-gray-500">No surplus to allocate.</p>;
  // stable color index per item title across months
  const titles = Array.from(new Set(data.flatMap((m) => m.items.map((i) => i.title))));
  const colorOf = (title: string) => colorFor(titles.indexOf(title));
  const max = Math.max(surplus, ...data.map((m) => m.reserve + m.items.reduce((s, i) => s + i.amount, 0)));

  return (
    <div>
      <div className="flex h-48 items-end gap-1">
        {data.map((m) => {
          const segs = [{ key: 'Reserve', amount: m.reserve, color: RESERVE_COLOR }, ...m.items.map((i) => ({ key: i.title, amount: i.amount, color: colorOf(i.title) }))];
          return (
            <div key={m.month} className="flex flex-1 flex-col items-center">
              <div className="flex w-full flex-col-reverse" style={{ height: '100%' }}>
                {segs.map((s) => (
                  <div key={s.key} title={`${m.month} · ${s.key}: ${formatINR(s.amount)}`} style={{ height: `${(s.amount / max) * 100}%`, backgroundColor: s.color }} />
                ))}
              </div>
              <span className="mt-1 rotate-45 text-[9px] text-gray-400">{m.month.split(' ')[0]}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: RESERVE_COLOR }} />Reserve refill</span>
        {titles.map((t) => (
          <span key={t} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: colorOf(t) }} />{t}</span>
        ))}
      </div>
    </div>
  );
}
```
- [ ] **Step 2:** Commit.

---

## Task 8: KpiCards + WhatIfBar

**Files:** Create `components/dashboard/KpiCards.tsx`, `components/dashboard/WhatIfBar.tsx`

- [ ] **Step 1:** KpiCards:
```tsx
import { Card } from '@/components/Card';
import { Money } from '@/components/Money';

export function KpiCards({
  reservePct, futureFunding, topUnfunded, monthsToFund, surplus,
}: {
  reservePct: number; futureFunding: number; topUnfunded: string | null;
  monthsToFund: number | null; surplus: number;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <Card title="Reserve Health"><p className="text-2xl font-bold">{reservePct}%</p></Card>
      <Card title="Future Funding Needed"><p className="text-2xl font-bold"><Money amount={futureFunding} /></p></Card>
      <Card title="Top Unfunded"><p className="truncate text-2xl font-bold">{topUnfunded ?? '—'}</p></Card>
      <Card title="Months to Fully Fund"><p className="text-2xl font-bold">{monthsToFund === null ? '—' : `${monthsToFund.toFixed(1)}`}</p></Card>
      <Card title="Monthly Surplus"><p className={`text-2xl font-bold ${surplus < 0 ? 'text-red-600' : ''}`}><Money amount={surplus} /></p></Card>
    </div>
  );
}
```
- [ ] **Step 2:** WhatIfBar:
```tsx
'use client';
import { Card } from '@/components/Card';
import { RecommendationBanner } from '@/components/RecommendationBanner';
import type { SimulationResult } from '@/lib/finance';

export function WhatIfBar({
  name, cost, onName, onCost, onClear, sim,
}: {
  name: string; cost: string;
  onName: (v: string) => void; onCost: (v: string) => void; onClear: () => void;
  sim: SimulationResult | null;
}) {
  const input = 'rounded-md border border-gray-300 px-3 py-2 text-sm';
  return (
    <Card title="Quick What-If">
      <div className="flex flex-wrap items-center gap-2">
        <input className={input} placeholder="Item name" value={name} onChange={(e) => onName(e.target.value)} />
        <input className={input} type="number" placeholder="Cost (₹)" value={cost} onChange={(e) => onCost(e.target.value)} />
        {sim && <button onClick={onClear} className="rounded-md bg-gray-200 px-3 py-2 text-sm font-medium hover:bg-gray-300">Clear Simulation</button>}
        {sim && <span className="text-xs text-gray-500">Simulating — dashboard reflects this purchase (not saved).</span>}
      </div>
      {sim && <div className="mt-3"><RecommendationBanner rec={sim.recommendation} message={sim.message} /></div>}
    </Card>
  );
}
```
- [ ] **Step 3:** Commit.

---

## Task 9: Dashboard client component

**Files:** Create `components/dashboard/Dashboard.tsx`

- [ ] **Step 1:**
```tsx
'use client';
import { useState, useMemo } from 'react';
import { Card } from '@/components/Card';
import { KpiCards } from '@/components/dashboard/KpiCards';
import { WhatIfBar } from '@/components/dashboard/WhatIfBar';
import { ReserveGauge } from '@/components/dashboard/ReserveGauge';
import { FundingBars } from '@/components/dashboard/FundingBars';
import { LiabilityTreemap } from '@/components/dashboard/LiabilityTreemap';
import { GoalTimeline } from '@/components/dashboard/GoalTimeline';
import { SurplusProjection } from '@/components/dashboard/SurplusProjection';
import {
  monthlySurplus, reserveRecoveryMonths, totalFutureLiability, monthsToFullyFund,
  sortQueue, isActive, fundingProgress, projectMonthlyAllocation, simulatePurchase,
} from '@/lib/finance';
import type { Item, Profile } from '@/lib/types';

export function Dashboard({ profile, items }: { profile: Profile; items: Item[] }) {
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const costNum = Number(cost) || 0;
  const active = useMemo(() => sortQueue(items.filter(isActive)), [items]);

  const sim = costNum > 0 ? simulatePurchase(profile, items, costNum) : null;
  const effProfile: Profile = sim ? { ...profile, reserveCurrent: profile.reserveCurrent - costNum } : profile;

  const surplus = monthlySurplus(profile);
  const reservePct = profile.reserveTarget > 0 ? Math.round((effProfile.reserveCurrent / profile.reserveTarget) * 100) : 0;
  const liability = totalFutureLiability(items);
  const topUnfunded = active.find((i) => fundingProgress(i).pct < 100)?.title ?? null;
  const m2f = monthsToFullyFund(profile, items);
  const recovery = reserveRecoveryMonths(effProfile);
  const projection = useMemo(
    () => projectMonthlyAllocation(profile, items, { months: 12, fromIso: new Date().toISOString(), startReserve: effProfile.reserveCurrent }),
    [profile, items, effProfile.reserveCurrent],
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <KpiCards reservePct={reservePct} futureFunding={liability.total} topUnfunded={topUnfunded} monthsToFund={m2f} surplus={surplus} />
      <WhatIfBar name={name} cost={cost} onName={setName} onCost={setCost} onClear={() => { setName(''); setCost(''); }} sim={sim} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Reserve Health"><ReserveGauge current={effProfile.reserveCurrent} target={profile.reserveTarget} recoveryMonths={recovery} /></Card>
        <Card title="Funding Progress"><FundingBars items={active} /></Card>
      </div>
      <Card title="Future Liability Breakdown"><LiabilityTreemap data={liability.breakdown} /></Card>
      <Card title="Goal Timeline"><GoalTimeline items={active} /></Card>
      <Card title="Monthly Surplus Projection (12 mo)"><SurplusProjection data={projection} surplus={surplus} /></Card>
    </div>
  );
}
```
- [ ] **Step 2:** Commit.

---

## Task 10: Wire home page

**Files:** Modify `app/page.tsx`

- [ ] **Step 1:** Replace the page body with a server fetch that renders the client Dashboard:
```tsx
import { Dashboard } from '@/components/dashboard/Dashboard';
import { getProfile, getItems } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [profile, items] = await Promise.all([getProfile(), getItems()]);
  return <Dashboard profile={profile} items={items} />;
}
```
(Removes the old inline cards/liability markup — those metrics now live in `KpiCards` + visuals.)
- [ ] **Step 2:** `npm run build` → clean. Commit.

---

## Task 11: Verify

- [ ] **Step 1:** `npm test` → all pass (old + new).
- [ ] **Step 2:** `npm run build` → no type errors; `/` present.
- [ ] **Step 3:** Smoke (dev server): `/` shows 4 KPI cards + surplus, gauge (84% amber/green), funding bars, treemap (Car dominates), timeline, 12-month stacked projection. Enter a What-If cost (e.g. 200000) → gauge %, recovery, projection shift, banner shows WAIT + goal delays; Clear restores. Resize to confirm responsiveness.
- [ ] **Step 4:** Update README (Dashboard section: visuals + Quick What-If; link iteration-4 docs). Commit.

---

## Self-review notes

- **Spec coverage:** Viz1 → Task 3; Viz2 → 4; Viz3 → 5; Viz4 → 6; Viz5 → 1,7; Viz6 cards → 1,8. What-If → 1,8,9. Dedupe/placement → 9,10. Tests → 1.
- **Type consistency:** `MonthlyAllocation`/`AllocationOpts`, `monthsToFullyFund`, `SimulationResult` defined in finance (1) and consumed by Dashboard/SurplusProjection (7,9). `colorFor`/`RESERVE_COLOR` (2) used in 5,7. All chart props match Dashboard's passed values.
- **No placeholders:** every component step has complete code.
- **No new dependencies.**
