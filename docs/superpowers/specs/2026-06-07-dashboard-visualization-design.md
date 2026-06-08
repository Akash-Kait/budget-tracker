# Dashboard Visualization Enhancement — Design Spec (Iteration 4)

**Date:** 2026-06-07
**Status:** Approved for implementation (decisions confirmed by author)
**Builds on:** iterations 1–3.

## 1. Goal

Add a visual layer to the home dashboard so a user can answer, without reading tables:
biggest goal, what's unfunded, reserve health, approaching obligations, how monthly surplus
is consumed, and whether a small purchase matters. **Not** an expense tracker — no spending
pie charts, category breakdowns, net-worth trends, or budgeting reports.

## 2. Locked decisions

| Topic | Decision |
|-------|----------|
| **Charts** | Zero new dependencies. All visuals built with Tailwind + small inline SVG/CSS components. No Recharts. |
| **Interactivity** | A **Quick What-If** control (item name + cost) lives on the dashboard. When active, every metric/chart recomputes from a *simulated* `reserveCurrent = reserveCurrent − cost` (nothing persists). A banner summarizes reserve impact, recovery time, and projected goal delays. A **Clear Simulation** button restores actual data. |
| **Placement** | Enhance the existing `/` page. It becomes a server component that loads profile + items and renders a **client** `<Dashboard>` holding what-if state. The four KPI cards are consolidated into one row, replacing today's overlapping cards. Detailed list/table views remain on their own pages. |
| **Compute** | All chart/metric math comes from pure functions in `lib/finance.ts` (importable client-side). Two new pure functions are added; the rest reuse existing ones. |

## 3. Layout (top → bottom on `/`)

1. **KPI row** (Viz 6) — 4 cards: Reserve Health %, Future Funding Needed, Highest-Priority Unfunded, Months to Fully Fund. Plus a small Monthly Surplus stat.
2. **Quick What-If bar** — name + cost inputs, Simulate / Clear; shows the simulation banner when active.
3. **Reserve Health** (Viz 1) — radial gauge.
4. **Funding Progress** (Viz 2) — horizontal bars per active item.
5. **Future Liability Breakdown** (Viz 3) — proportional treemap-style tiles.
6. **Goal Timeline** (Viz 4) — horizontal timeline.
7. **Monthly Surplus Projection** (Viz 5) — 12-month stacked bars.

## 4. New domain logic (`lib/finance.ts`, pure)

- **`monthsToFullyFund(profile, items)`** → `number | null`: `totalFutureLiability(items).total / monthlySurplus`; `null` if surplus ≤ 0.
- **`projectMonthlyAllocation(profile, items, opts)`** → `{ month: string; reserve: number; items: { id: string; title: string; amount: number }[] }[]` for the next `opts.months` (default 12). Reuses the existing allocation rule (refill reserve to target first, then fund queue items by priority/rank), but **records how much each month's surplus went to reserve and to each item**. Honors `opts.startReserve` so the what-if simulation shifts allocations. Months are labeled `Mon YYYY` from `opts.fromIso`.

Existing functions reused unchanged: `monthlySurplus`, `reserveDeficit`, `reserveRecoveryMonths`, `fundingProgress`, `sortQueue`, `remaining`, `totalFutureLiability`, `projectedCompletion`, `simulatePurchase`, `isActive`.

## 5. Components (all under `components/dashboard/`)

- `Dashboard.tsx` (client) — receives `profile` + `items`; holds `whatIf` state `{ name, cost } | null`. Derives `effectiveProfile` (reserve reduced by cost when active) and a `sim` (`simulatePurchase`) result. Passes derived data to children. Renders the What-If bar + banner and all six visuals.
- `KpiCards.tsx` — the 4 KPI cards + surplus stat.
- `WhatIfBar.tsx` — name/cost inputs, Simulate/Clear, and the `RecommendationBanner` reused from iteration 1 when active.
- `ReserveGauge.tsx` — SVG radial gauge with color logic: ≥90% green, 70–89% amber, <70% red. Shows current/target, %, recovery time.
- `FundingBars.tsx` — horizontal funded/target bars per active item, queue-sorted, with % and remaining.
- `LiabilityTreemap.tsx` — proportional tiles (flex-based) sized by `remaining` for active non-wishlist items; each tile labeled title + amount. Largest dominates visually.
- `GoalTimeline.tsx` — active commitments/goals/experiences placed along a horizontal axis by dueDate (min→max range), labeled month + title; degrades to a stacked list on narrow widths.
- `SurplusProjection.tsx` — 12 stacked bars (one per month); each segment = an item's allocation that month (+ a reserve-refill segment), with a color legend.

Reused: `Card`, `Money`, `RecommendationBanner`.

## 6. What-If behavior

- Inactive: charts/metrics use the real `profile`.
- Active (`cost > 0`): `effectiveProfile.reserveCurrent = max(real − cost, …)` (may go negative, shown in red). Reserve Health, recovery time, Months-to-fund context, and the **Surplus Projection** (via `startReserve = effective reserve`) all recompute. The banner shows `simulatePurchase` output (reserve before/after, % reduction, recovery months, per-goal delays, SAFE/CAUTION/WAIT). Funding-progress and liability charts reflect actual item funding (a hypothetical purchase isn't an item), but the projection/timeline reflect the simulated reserve.
- Clear restores `whatIf = null`.

## 7. Charts update triggers

- Funding/goal/reserve changes happen on other pages and persist; returning to `/` (a `force-dynamic` server fetch) re-renders with fresh data.
- What-if changes are client-side and instant.

## 8. Error / edge handling

- Surplus ≤ 0: recovery time and months-to-fund show "—"; projection shows an empty-state note ("No surplus to allocate").
- No active items: charts show friendly empty states.
- Treemap/timeline with a single item: still renders (one full-width tile / one marker).
- Division-by-zero guarded (target 0 → 0%).

## 9. Testing (Vitest)

- `monthsToFullyFund`: positive case (liability/surplus), zero-surplus → null.
- `projectMonthlyAllocation`: month count = horizon; first months allocate to reserve refill before items; an item's summed allocations across months ≈ its remaining (capped); `startReserve` lower → more reserve months → later item allocations; wishlist never allocated.

Chart components verified via clean build + live smoke (render + what-if recompute).

## 10. Out of scope

Recharts/any chart lib; expense/category/spending charts; net-worth trends; AI insights; persisting simulations; mobile-first (desktop-first is fine, charts still responsive).
