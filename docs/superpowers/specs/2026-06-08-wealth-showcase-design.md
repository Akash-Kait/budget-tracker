# Wealth Dashboard — Premium Showcase Redesign (Design Spec)

**Date:** 2026-06-08
**Status:** AWAITING APPROVAL — do not implement until approved.
**Builds on:** the committed dark tokens (`globals.css`) + the cost-basis/gain-loss layer. Reuses
existing semantic tokens; does **not** redefine `accent`/`positive`/`negative`/`warning`.
**Scope:** `/wealth` only. This screen becomes the visual reference; whole-app rollout is a later,
separate pass (out of scope).

## Design thesis

Today `/wealth` is clean but flat — every card has equal weight, so nothing sings. The fix is
**hierarchy, not more effects**: **one hero moment** (the Total Wealth figure) gets scale + glow +
motion; everything else stays calm. That discipline is what reads as premium (Linear/Arc), not glass
on every tile.

## Charting library — proposal

**Recharts (latest 3.x).** Why:
- **React 19 support** — Recharts 3 officially supports React 19 (our stack is 19.2); no peer-dep
  hacks. (Recharts 2.x predates clean R19 support.)
- Declarative `<PieChart>`/`<BarChart>` + `<ResponsiveContainer>`, built-in **entrance animation**
  (`isAnimationActive`) and **SVG gradient defs** — exactly the levers we want, minimal code.
- vs **visx**: visx gives more control but is lower-level (we'd hand-build axes/arcs/animation) — no
  benefit at this scope. **One library only**, no parallel viz stacks; the hand-built `AllocationDonut`
  is removed.
- **Dependency:** add `recharts` (^3) — pulls a few `d3-*` transitive deps; acceptable for an internal
  dashboard. Build-reliability: installed/verified in the isolated copy; if 3.x hits a React-19 snag,
  fall back to `recharts@2.15` (last 2.x with R19 support) — noted, not expected.

## Layout & hierarchy

Top → bottom. **The single hero element is the Total Wealth figure.**

1. **HERO band** (one full-width card, the only "loud" element):
   - **Total Wealth** — dominant: `text-5xl`/`6xl`, mono, tabular, tight tracking, `--text`. **Count-up
     on mount.** Behind it a **soft radial accent glow** (low-alpha, static) + a subtle layered
     gradient surface.
   - Beneath it, **Total Gain / Loss** as a colored sub-line (`--positive`/`--negative`, mono, also
     count-up), with the partial-coverage caveat ("based on N of M holdings") small and quiet.
   - A **thin inline allocation strip** (3-segment stacked bar in `wealthTypeColor`) for instant
     composition context, plus the `RefreshPricesButton` (calm, top-right).
   - Labels around the hero are small/quiet — **strong scale contrast** is the point.
2. **Supporting KPI trio** (calm, flat — glow/motion deliberately WITHHELD): Holdings · Largest
   Holding · Asset Types. Smaller type than today; these recede so the hero dominates.
3. **Charts row** (`lg:grid-cols-2`, calm surfaces, charts animate in):
   - **Allocation by type** — Recharts donut (see below).
   - **Value & gain/loss by holding** — Recharts horizontal bar (see below).
4. **Holdings** — the existing grouped table (`WealthAssetRow`), calm/flat, unchanged in spirit
   (tokens only). No charts, no glow.
5. **Add asset** — existing form panel, calm.

## Chart treatments

### Allocation donut (`AllocationChart`, replaces `AllocationDonut`)
- Recharts `PieChart` + `Pie` (innerRadius for donut), one slice per asset type, fill =
  **linear gradients derived from `wealthTypeColor`** (token-referenced stops, e.g.
  `stopColor="var(--accent)"`), small padding angle for the crisp gap.
- Center label: **Total** (small, `--faint`) + total figure (mono, `--text`).
- Right/below: legend with value + %. Entrance: donut sweep (`isAnimationActive`, ~700ms), off when
  reduced-motion. Hover: slice highlight + tooltip (themed: `--surface-2` bg, hairline border).

### Value & gain/loss by holding (`GainLossChart`, new)
- Recharts horizontal `BarChart`: one bar per holding (sorted by value desc), **bar length = current
  value**, **bar color encodes gain/loss** — `--positive` (gain), `--negative` (loss), `--muted`
  (no cost basis). Gradient fill (token stops). Tooltip shows value + absolute/`%` gain-loss (or
  "cost basis not set"). Entrance: bars grow from 0 (off when reduced-motion).
- Gain/loss color stays on `--positive`/`--negative` only — never the brand accent.

## Motion & micro-interactions (and where withheld)

**Applied (the hero + charts only):**
- **Count-up** on the two hero figures (Total Wealth, Total Gain/Loss) — a small `useCountUp` client
  hook, ~700–900ms ease-out, formatted with the existing `formatINR` each frame; tabular numerals
  prevent width jitter.
- **Chart entrance** via Recharts `isAnimationActive`.
- **Hover**: chart tooltips/segment highlight; existing subtle border-lift on cards/rows.
- **Depth**: radial accent glow + layered gradient on the **hero card only**; charts sit on standard
  `--surface` panels (no glow).

**Deliberately WITHHELD (restraint):** the supporting KPI trio, the holdings table/rows, the add-asset
form, and the refresh button get **no glow, no count-up, no entrance motion** — only the existing
quiet hover. One hero moment; supporting elements stay calm.

## Reduced-motion handling (fully honored)

- A `usePrefersReducedMotion` hook (`matchMedia('(prefers-reduced-motion: reduce)')`).
- When reduced: count-up renders the **final value immediately** (no tween); Recharts
  `isAnimationActive={false}` (charts draw in final state instantly).
- The **radial glow/gradients are static decoration (not motion)** and remain — they convey no
  information.
- **No essential info is conveyed by motion alone**: every figure is always rendered as text; charts
  always have legends/labels/tooltips regardless of animation.

## Tokens & firewall

- Reuse committed tokens only. Chart gradients reference token CSS vars (`var(--accent)`,
  `wealthTypeColor` hexes); gain/loss uses `--positive`/`--negative`.
- **Pure presentation.** No changes to `lib/finance.ts`, `lib/wealth.ts`, `lib/market/`,
  `lib/data.ts`, `lib/types.ts`, `lib/dashboard.ts`, or any API route. Chart/hero components are
  `'use client'` and receive **plain serializable data** computed in the (server) page via existing
  pure functions — they import no Planning logic. Firewall intact.

## Files

- **Add dep:** `recharts` (^3) in `package.json`.
- **New:** `components/wealth/HeroWealth.tsx` (client, count-up + glow), `components/wealth/useCountUp.ts`,
  `components/wealth/usePrefersReducedMotion.ts`, `components/wealth/AllocationChart.tsx` (Recharts),
  `components/wealth/GainLossChart.tsx` (Recharts).
- **Modify:** `app/wealth/page.tsx` (new hero/hierarchy layout; compute plain chart data),
  `components/wealth/WealthKpiCards.tsx` (demote to the supporting trio — Total Wealth & Gain/Loss
  move into the hero).
- **Remove:** `components/wealth/AllocationDonut.tsx` (replaced by `AllocationChart`).
- Unchanged: `Panel`, `WealthAssetRow`, `WealthAssetForm`, `RefreshPricesButton`, `GainLossText`.

## Verification

Install `recharts` in the isolated copy; `npm test` (all **115** still pass — pure presentation,
no test touches Wealth UI) and `npm run build` (clean). Confirm: reduced-motion path (count-up + charts
static), firewall (chart/hero components import no `finance`/`wealth`/`market`), one charting lib only.
Report the new dependency + version and the changed/new files.

---

**Approval requested on:** (1) **Recharts ^3** as the one charting library; (2) the **hero = Total
Wealth count-up + glow**, with the supporting trio/holdings/form deliberately calm; (3) the two charts
(allocation donut + value/gain-loss horizontal bar). On approval I implement and report tests/build +
the new dependency + file list.
