# Planning Dashboard — Premium Showcase Redesign (Design Spec)

**Date:** 2026-06-08
**Status:** AWAITING APPROVAL — do not implement until approved.
**Reference:** the shipped `/wealth` showcase (`2026-06-08-wealth-showcase-design.md`). Same tokens,
fonts (Hanken hero / mono dense), glow style, count-up + chart-entrance patterns, one chart lib
(Recharts, already a dep). **Scope:** `app/page.tsx` + `components/dashboard/*` only. Other tabs later.

## Thesis (same as Wealth)

The Planning dashboard is re-themed but flat — five equal KPI tiles + four equal visuals, nothing
leads. Apply **hierarchy, not more effects**: one hero answers the page's core question; everything
else stays calm.

## Hero — **Reserve Health**

The page's core question is *"how healthy am I / can I afford things?"* The persistent answer is the
**Opportunity Reserve health** (the What-If recommendation is transient — it only exists once you type
a cost). So the **hero is Reserve Health**, promoted from a same-size tile to a dominant hero band:

- An **enlarged radial gauge** (ring **entrance sweep**) with the **Reserve % as the hero figure**
  (Hanken Grotesk, large, `tabular-nums`, **count-up**), status-colored (accent ≥90 / warning 70–89 /
  negative <70 — unchanged thresholds).
- Supporting figures beside it (quiet, mono): reserve current / target, **deficit**, **recovery
  months**. A **soft radial accent glow** behind the gauge/number (low-alpha, static).
- It already reflects the **What-If**: the gauge/% read `m.effReserveCurrent`/`m.reservePct`, so when a
  cost is entered the hero recomputes — no model change.
- **Reserve Health is removed from the KPI row** (no duplication), exactly as Wealth moved Total
  Wealth out of its KPI row into the hero.

The **What-If bar** sits directly under the hero (it drives the hero); when active its
`RecommendationBanner` shows there. The What-If control stays calm (input row + banner).

## Per-visual decisions (the four existing SVG visuals)

| Visual | Decision | Reasoning |
|--------|----------|-----------|
| **ReserveGauge** | **Rebuild as `ReserveHero` — elevate in place (stay inline SVG), promote to hero** | Already pixel-perfect, token-driven, and supports a centered count-up % + status color. Recharts `RadialBarChart` would be *more* code for the same arc and make the centered count-up/!status harder. Keep SVG; enlarge, add glow + ring-sweep entrance + the hero count-up. |
| **LiabilityTreemap** | **Elevate in place** (no rebuild) | The bespoke flexbox treemap handles proportional sizing **and** white labels responsively; Recharts `<Treemap>` is fiddlier with labels and changes layout behavior for no gain. Elevate: token **gradient** tile fills (like the Wealth donut slices) + crisper hierarchy. Stays calm (no glow/motion). |
| **GoalTimeline** | **Elevate in place** (no rebuild) | Recharts has no timeline primitive; a scatter/number-line hack would be worse than the purpose-built horizontal rail. Elevate: hairline rail + accent dots, a subtle ring on the nearest upcoming milestone. Stays calm. |
| **SurplusProjection** | **Rebuild in Recharts (stacked BarChart)** — *the one that materially improves* | The hand-built stacked `<div>`s have **no real tooltip** (only a `title` attr), no axes, and fragile manual height math. A Recharts stacked bar gives hover tooltips (per-month allocation breakdown), proper scaling, responsive sizing, and matches the Wealth chart treatment — reusing the one lib. Token gradient fills (`colorFor` per item + `RESERVE_COLOR`), themed tooltip. |

`FundingBars` (not one of the four) stays as-is — simple token CSS bars, already calm.

## Motion & depth — and where withheld

**Applied:**
- **Hero only:** radial accent glow (static), Reserve-% **count-up**, gauge **ring-sweep entrance**.
- **SurplusProjection (rebuilt):** the same subtle Recharts **entrance** Wealth's charts use.

**Open call (please confirm):** the brief lists the projection among "supporting tiles [that] stay
quiet," yet also says reuse Wealth's chart-entrance pattern. I propose the rebuilt projection keeps a
**subtle entrance** (consistent with Wealth's supporting charts, which animated in quietly) — *no glow,
no count-up*. If you'd rather it be fully static, I set `isAnimationActive={false}` and it's purely
elevated visually. **Default unless you say otherwise: subtle entrance on the projection.**

**Deliberately WITHHELD (restraint):** glow appears on **one** surface (the hero). The KPI quartet,
treemap, timeline, What-If bar, FundingBars, and the Total-Wealth link get **no glow and no count-up**
— only existing hover. Treemap/timeline are elevated *visually* (gradients/polish), not with motion.

## Reduced motion (fully honored)

Reuse the established hooks: count-up jumps to the final value; the gauge ring renders full (no sweep);
Recharts `isAnimationActive={false}`; the glow is static decoration. No info conveyed by motion alone
(every figure is always text; charts always have labels/tooltips).

## Shared hooks (small presentation-only move)

`useCountUp` and `usePrefersReducedMotion` currently live in `components/wealth/`. Move them to
`components/hooks/` (neutral, shared) and update the Wealth imports — so Planning reuses them without a
cross-domain import. Pure move, no behavior change. (Alternatively leave them in `components/wealth/`
and import directly — they're generic UI hooks, not domain logic, so it isn't a firewall breach; I
recommend the move for cleanliness.)

## Constraints / firewall / recompute untouched

- **Pure presentation.** No changes to `lib/finance.ts`, `lib/wealth.ts`, `lib/market/`,
  `lib/data.ts`, `lib/types.ts`, **or `lib/dashboard.ts`**. The **What-If recompute /
  `deriveDashboardModel` stays byte-for-byte unchanged**; `Dashboard.tsx` still calls it identically
  with the same `useMemo([profile, items, costNum])`. Only JSX/layout and child components change.
  Deficit is derived in the hero component from existing props (`target − effReserveCurrent`) — no
  model change.
- Planning/Wealth firewall intact: dashboard components import no `lib/wealth`/`lib/market`; the
  rebuilt chart receives the existing `m.projection` (`MonthlyAllocation[]`) plain prop and flattens it
  client-side for Recharts.
- Recharts only (already a dep) — no second viz stack.

## Files

- **New:** `components/dashboard/ReserveHero.tsx` (client; gauge + count-up % + figures + glow),
  `components/dashboard/SurplusProjectionChart.tsx` (Recharts stacked bar).
- **New (moved):** `components/hooks/useCountUp.ts`, `components/hooks/usePrefersReducedMotion.ts`
  (from `components/wealth/`); update `HeroWealth.tsx` + the Wealth chart imports.
- **Modify:** `app/page.tsx`? (no — stays a thin server fetch); `components/dashboard/Dashboard.tsx`
  (new layout: hero → What-If → KPI quartet → charts), `components/dashboard/KpiCards.tsx` (drop Reserve
  Health → 4 cards), `components/dashboard/LiabilityTreemap.tsx` (gradient polish),
  `components/dashboard/GoalTimeline.tsx` (rail/dot polish).
- **Remove:** `components/dashboard/ReserveGauge.tsx` (→ ReserveHero), `components/dashboard/SurplusProjection.tsx` (→ Recharts).
- Unchanged: `WhatIfBar`, `FundingBars`, `lib/dashboard.ts`, `app/page.tsx`.

## Verification

Isolated copy: `npm test` (all **115** pass — pure presentation; `lib/dashboard.ts` untouched so the
dashboard recompute tests are unaffected) and `npm run build` clean. Confirm: recompute path
unchanged (git shows no `lib/dashboard.ts` diff), firewall (no wealth/market imports in
`components/dashboard/*`), one chart lib, reduced-motion path. Report per-visual decisions + files.

---

**Approval requested on:** (1) **hero = Reserve Health** (enlarged gauge + count-up %); (2) the
per-visual calls — gauge **elevate→hero**, treemap **elevate**, timeline **elevate**, projection
**rebuild in Recharts**; (3) the open call: **subtle entrance on the rebuilt projection** (vs fully
static); (4) moving the two hooks to `components/hooks/`. On approval I implement and report.
