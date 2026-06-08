# Planning Dark Re-theme — Design Spec

**Date:** 2026-06-08
**Status:** AWAITING APPROVAL — do not implement until approved.
**Builds on:** `2026-06-08-wealth-dark-redesign-design.md` (same token system). Retires that spec's
"light cards on dark" interim state.

## Goal & constraints

Bring the **shared chrome + all Planning surfaces** onto the **existing** dark token system so the
whole app matches the Wealth dashboard. **Pure presentation.** No changes to `lib/finance.ts`,
`lib/wealth.ts`, `lib/market/`, `lib/data.ts`, `lib/types.ts`, or any API route. Firewall intact.
Zero charting deps (Tailwind + inline SVG). Reuse the existing tokens — **no second palette, and the
`--accent`/`--positive`/`--negative` *values* are unchanged.**

## Token additions (the only proposed additions — please approve)

1. **`--warning: #fbbf24` (amber)** + `--color-warning` mapping in `globals.css`. The app has green
   (accent/positive) and red (negative) but **no amber**, which several existing Planning states need
   (gauge mid-band, partial funding, over-funding, "behind target", simulator CAUTION). This completes
   the status triad; it is **not** a parallel palette. Optional companion `--warning-weak`
   (`rgba(251,191,36,0.14)`) for tints.
2. **Retune `PALETTE` in `lib/colors.ts`** (the categorical treemap/projection colors only) to a
   dark-legible, cohesive set. `colorFor` signature unchanged; `WEALTH_CHART`/`wealthTypeColor` and
   `RESERVE_COLOR` unchanged. Proposed (mid-tones that hold white labels on `--surface`):
   `#6366f1 #8b5cf6 #ec4899 #f59e0b #22d3ee #f87171 #38bdf8 #a3e635 #fb923c #2dd4bf`.

**Semantic rule (kept):** `--positive`/`--negative` stay reserved for **gain/loss figures**. Generic
status uses **accent = good/safe**, **warning = caution**, **negative = bad/attention**. (So the
reserve gauge "healthy" band uses `--accent`, not `--positive`.)

## Before → after token mapping

### Shared components
| Component | Before (light) | After (tokens) |
|-----------|----------------|----------------|
| `Card.tsx` | `bg-white border-gray-200 shadow-sm`, title `text-gray-500` | `bg-surface border-hairline` (no shadow), title `text-faint` |
| `Money.tsx` | — (no color) | unchanged |
| `ProgressBar.tsx` | track `bg-gray-100`; fills green/blue/amber by pct | track `bg-surface-2`; <50 `bg-warning`, 50–99 `bg-accent/70`, ≥100 `bg-accent` |
| `RecommendationBanner.tsx` | `bg-*-50 border-*-300 text-*-800` | SAFE `bg-accent-weak border-accent/30 text-accent` · CAUTION `bg-warning/10 border-warning/30 text-warning` · WAIT `bg-negative/10 border-negative/30 text-negative` |
| `Nav.tsx` | — | **already dark** (Wealth pass); no change |
| `ItemForm.tsx` | `border-gray-300` inputs, `bg-blue-600` btn, `text-red-600` err | dark inputs (`bg-surface-2 border-hairline text-text placeholder:text-faint focus:border-accent focus:ring-accent-weak`), `bg-accent text-bg` btn, `text-negative` err — matches `WealthAssetForm` |
| `EditableItemRow.tsx` | type badges `bg-*-100 text-*-700`, `text-gray-*`, on-track `text-green-600`, behind/over `text-amber-600`, btns blue/green/red | badges → token tints (`bg-accent-weak text-accent`, `bg-surface-2 text-muted`, etc.), text → `text/muted/faint`, on-track `text-accent`, behind/over `text-warning`, btns `text-muted hover:text-accent / hover:text-negative` |
| `FundingPanel.tsx` | `text-blue-600`, `bg-gray-50`, gray inputs, `bg-blue-600` btn | `text-accent`, `bg-surface-2`, dark inputs, `bg-accent text-bg` btn |
| `WishlistRow.tsx` | cooling `text-amber-600`, purchased `text-green-600`, `bg-green-600` btn, disabled `bg-gray-100` | cooling `text-warning`, purchased `text-accent`, `bg-accent text-bg` btn, disabled `bg-surface-2 text-faint`, delete `text-negative` |
| `ConvertForm.tsx` | `text-purple-600`, gray inputs, error | `text-accent`, dark inputs, `text-negative` |
| `RankingList.tsx` | badges, `border-gray-200 bg-white` rows | token badges, `border-hairline bg-surface` rows; drag `opacity-50` kept |
| `ProfileForm.tsx` | gray inputs, `bg-blue-600` btn, saved `text-green-600` | dark inputs, `bg-accent text-bg` btn, saved `text-accent` |

### Planning dashboard components (`components/dashboard/*`)
| Component | Notes |
|-----------|-------|
| `Dashboard.tsx` | Section wrappers use shared `Card` (now dark). Passive **Total Wealth** link `border-gray-300 bg-white text-gray-*` → `border-hairline bg-surface text-muted`, value `text-text`. |
| `KpiCards.tsx` | values `text-gray-*` → `text-text`/`font-mono tabular-nums`; surplus negative `text-red-600` → `text-negative`. (Mirror Wealth KPI treatment.) |
| `WhatIfBar.tsx` | inputs → dark; "Clear Simulation" `bg-gray-200` → `bg-surface-2 text-text`; helper `text-faint`. |
| **`ReserveGauge.tsx`** (SVG) | track `#e5e7eb` → `var(--hairline)`; **health bands** `#10b981/#f59e0b/#ef4444` → `var(--accent)` (≥90) / `var(--warning)` (70–89) / `var(--negative)` (<70); center text → `var(--text)` + `var(--faint)`. |
| **`FundingBars.tsx`** (SVG/CSS) | text → `muted`; bar fill `bg-blue-500` → `bg-accent`; over-funded `bg-amber-500`/`text-amber-600` → `bg-warning`/`text-warning`; left/remaining `text-muted`. |
| **`LiabilityTreemap.tsx`** (CSS) | tiles use `colorFor` (retuned palette) with `text-white` retained (legible on mid-tones); empty text → `text-muted`. |
| **`GoalTimeline.tsx`** (CSS) | connector `bg-gray-200` → `bg-hairline`; dots `bg-blue-500` → `bg-accent`; labels `text-gray-*` → `text-muted`/`text-faint`. |
| **`SurplusProjection.tsx`** (SVG/CSS) | segment colors via `colorFor` (retuned) + `RESERVE_COLOR` (slate, legible on dark) retained; month axis `text-gray-400` → `text-faint`; legend `text-muted`; "No surplus" → `text-muted`. |

### Pages (scan + fix hardcoded light utilities)
`app/page.tsx`, `queue`, `ranking`, `timeline`, `wishlist`, `history`, `simulator`, `settings`:
- Headings inherit `--text` (body) — OK. Fix any literal `text-gray-*`, `bg-white`, `border-gray-*`,
  `bg-gray-50`, `text-blue/green/red-*`, and inline inputs (e.g. simulator's cost field, timeline's
  inline dots/line) → tokens per the patterns above. I'll grep each page for these classes and convert.

## SVG data-viz on dark — explicit contrast pass

- **Gauge:** dark hairline track + accent/warning/negative arc; verify the arc and the centered
  tabular figure are legible on `--surface`.
- **Treemap:** retuned `PALETTE` mid-tones + white labels — verify each tile's white text passes on its
  fill; tiles sit on `--surface`.
- **Timeline:** accent dots on a hairline rule; labels `muted`/`faint`.
- **Projection:** stacked segments (retuned `PALETTE`) + `RESERVE_COLOR` slate for the reserve band;
  verify adjacent segments are distinguishable and the rotated month labels (`faint`) are readable.

## Cleanup

On completion, mark the Wealth dark-redesign spec's interim note **resolved** (§2/§10 of
`2026-06-08-wealth-dark-redesign-design.md`): the whole app is now dark; light Planning cards no longer
exist.

## Verification

`npm test` (70 still pass — pure presentation) and `npm run build` (clean) in the isolated copy. Smoke
**every** page (`/`, `/queue`, `/ranking`, `/timeline`, `/wishlist`, `/history`, `/simulator`,
`/settings`, `/wealth`) and **grep the whole `app/` + `components/` tree for residual light utilities**
(`bg-white`, `bg-gray-*`, `text-gray-*`, `border-gray-*`, `text-(blue|green|red|amber|purple)-*`) →
expect zero outside intentional cases. List changed files.

---

**Approval requested**, specifically on: (1) adding `--warning` (+ optional `--warning-weak`);
(2) retuning `PALETTE`; (3) the semantic rule that generic status uses accent/warning/negative while
`--positive`/`--negative` stay reserved for gain/loss figures. Then I implement and report
`npm test` + `npm run build` + the changed-file list + the residual-light-utility grep result.
