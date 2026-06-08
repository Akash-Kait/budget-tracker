# Wealth Dashboard — Dark Premium Fintech Redesign (Design Spec)

**Date:** 2026-06-08
**Status:** REVISED per feedback — AWAITING APPROVAL of this revision before any component code.
**Revision notes:** (a) light-Planning recorded as a deliberate, temporary interim state with a
follow-up to re-theme Planning; (b) `positive`/`negative` are now distinct semantic tokens, separate
from the emerald brand accent (for the upcoming cost-basis / gain-loss feature); plus seam-contrast
checks and font metric-matching (no layout shift) baked in.
**Scope:** Pure presentation. No changes to `lib/finance.ts`, `lib/wealth.ts`, `lib/market/`,
`lib/data.ts`, validation, or any API route. No schema/calculation changes. 56 tests + build must
stay green.

## 1. Visual direction

**Dark premium fintech** — reference feel: Linear / Arc. Restrained near-black canvas, elevated
matte surfaces, hairline borders (not heavy shadows), strong type hierarchy, generous spacing, and
**one refined accent** driving the data-viz. Calm, precise, expensive-feeling. The memorable moment:
a **monochromatic accent-ramp allocation donut** glowing on near-black, with large tabular-figure
KPIs above it.

## 2. The shell decision (please confirm)

The app has no theme tokens today; components hardcode light utilities, and `components/Card.tsx`
is shared by Planning **and** Wealth.

**Chosen approach:**
- Make the **global shell dark** — `app/globals.css` base + `app/layout.tsx` + `components/Nav.tsx`
  consume new dark tokens. The whole app now sits on the dark canvas.
- **Wealth gets its own dark surface primitives** (a new `components/wealth/Panel.tsx` + tokenized
  elements); it does **not** reuse the shared light `Card`.
- **Leave the shared `Card.tsx` (and all Planning components) on their light utilities.** They keep
  dark text on white cards → they render as legible light cards floating on the dark shell. This is
  "renders correctly / not broken," and keeps Planning fully out of scope (no risk of unreadable
  dark-on-dark text).

**This is a deliberate, temporary interim state — not a bug, and not to be "fixed" out of scope.**
Planning pages intentionally remain light cards on the dark shell until a dedicated follow-up
re-themes Planning to the same tokens (see §10 Follow-ups). Anyone reviewing the dark app should
treat light Planning surfaces as expected, scoped-out work-in-progress.

**Seam quality (must verify, §9):** the risk with light-on-dark is harsh seams. While implementing I
will confirm: (1) the shared `Card.tsx` keeps an adequate, visible-but-not-glaring border and
contrast against `--bg`; (2) the **Nav → content** seam reads cleanly (dark Nav meets dark canvas with
a single hairline, no double border / bright line); (3) **card edges** of the remaining light Planning
cards don't render as harsh white blocks — if they do, I'll add a soft hairline/`ring` so the edge is
intentional rather than jarring. These are presentation-only tweaks within scope.

## 3. Design tokens

### 3a. Semantic CSS variables (`app/globals.css`)
Defined on `:root` (dark only — no toggle, no `prefers-color-scheme`), and exposed as Tailwind v4
utilities via `@theme inline` so components write `bg-surface`, `text-muted`, `border-hairline`,
`text-accent`, etc. — never hex.

| Token | Value (proposed) | Use |
|-------|------------------|-----|
| `--bg` | `#0A0C0F` | app canvas |
| `--surface` | `#14171C` | panels/cards |
| `--surface-2` | `#1B1F26` | nested/hover surfaces, inputs |
| `--hairline` | `rgba(255,255,255,0.08)` | borders/dividers |
| `--hairline-strong` | `rgba(255,255,255,0.14)` | hover/focus borders |
| `--text` | `#E7EAEE` | primary text |
| `--muted` | `#9AA4B2` | secondary text |
| `--faint` | `#5A636F` | tertiary/labels |
| `--accent` | `#34D399` (emerald/mint) | **brand only:** UI emphasis, CTAs, focus, data-viz anchor |
| `--accent-weak` | `rgba(52,211,153,0.14)` | accent fills/tints, focus rings |
| `--positive` | `#4ADE80` (brighter spring green) | **financial gains only** (gain/loss figures) |
| `--negative` | `#F87171` (clear red) | **financial losses only** |

Mapped in `@theme inline` as `--color-bg`, `--color-surface`, `--color-surface-2`,
`--color-hairline`, `--color-hairline-strong`, `--color-text`, `--color-muted`, `--color-faint`,
`--color-accent`, `--color-positive`, `--color-negative`.

**`positive`/`negative` are distinct from the brand accent — by design.** The emerald accent
(`#34D399`, teal-leaning) drives brand/UI/data-viz; `positive` (`#4ADE80`, a warmer, brighter green)
is reserved exclusively for **gain/loss semantics**, with `negative` red for losses. They are
perceptibly different hues so a green figure is unambiguously a *gain*, never confused with brand
emphasis — this matters for the **upcoming cost-basis / gain-loss feature** (§10). **Rule:** never use
`--accent` to color a gain/loss number, and never use `--positive` for brand/UI chrome. (If you want
even more separation, `positive` could move to a lime `#A3E635`; I'm defaulting to `#4ADE80` to keep
"green = gain" unambiguous without reading as a warning.)

### 3b. Data-viz palette (`lib/colors.ts`)
Add **Wealth-specific, dark-tuned, accent-anchored** chart tokens **without changing the existing
`colorFor`/`RESERVE_COLOR`** (those still serve Planning — firewall + scope):

```
WEALTH_CHART = {
  MUTUAL_FUND: '#34D399',  // accent (mint)
  STOCK:       '#22D3EE',  // harmonized cyan
  OTHER:       '#64748B',  // neutral slate
}
export function wealthTypeColor(type: AssetType): string
```

Cohesive (green→cyan + neutral), high-contrast on near-black, and distinguishable for the three
asset types. The donut reads as "one accent family."

## 4. Typography

- **UI / display:** a distinctive geometric grotesque — proposed **Hanken Grotesk** (refined, not
  Inter/Space Grotesk) via `next/font/google`, weights 400/500/600/700. Tight tracking on large
  headings; clear scale (page title 28–32px/700, panel title 12px/600 uppercase tracked, KPI value
  28–34px/600).
- **Figures:** **JetBrains Mono** (via `next/font`) for all currency/numbers, with
  `font-variant-numeric: tabular-nums` so ₹ columns align — a hallmark of premium fintech.
- Body sits at 14px/`--muted` for secondary, `--text` for primary.

**No layout shift (metric matching):** both `next/font` faces are configured with `display: 'swap'`,
an explicit curated `fallback` stack, and `adjustFontFallback` left **enabled** (default) so Next
generates a size-adjusted (`size-adjust`/`ascent-override`) fallback `@font-face` metric-matched to
Hanken Grotesk / JetBrains Mono. Result: when the real font swaps in on a networked machine, there's
no reflow. All monetary figures use the mono face with `tabular-nums`.

> **Build-reliability contingency (HARD constraint wins):** `next/font/google` fetches at build
> time. If this environment can't reach Google Fonts during my verification build, I fall back to a
> curated grotesque **system stack** (`ui-sans-serif, "Segoe UI", …`) + a mono stack for figures, so
> `npm run build` always succeeds. On your machine the web fonts load normally. I'll report which
> path was used. (The metric-matched fallback above means either path renders without layout shift.)

## 5. Wealth layout & component treatment

Overall: `max-w-5xl`, generous vertical rhythm (`space-y-8`), section labels in `--faint` uppercase.
Subtle entrance — one staggered fade/translate on load (CSS `@keyframes`, `animation-delay`), no
gratuitous motion.

### 5a. `app/wealth/page.tsx`
- **Header band:** "Wealth" (display) + a right-aligned **`RefreshPricesButton`**; under it a one-line
  muted subtitle reaffirming Wealth is tracked separately from Planning.
- **KPI row** (`WealthKpiCards`).
- **Allocation panel** (`AllocationDonut`) — full-width Panel.
- **Holdings** — grouped, as a refined table (see 5d).
- **Empty state** when no assets (see 5e).

### 5b. `WealthKpiCards`
Four tokenized panels (Total Wealth, Holdings, Largest Holding, Asset Types). Treatment: small
`--faint` uppercase label, large tabular-mono value in `--text`, hairline border, `--surface`,
`rounded-2xl`, hover raises border to `--hairline-strong`. Total Wealth is the hero (largest, accent
underline or a thin accent top-rule). Grid: 1 col (mobile) → 2 (sm) → 4 (lg).

### 5c. `AllocationDonut`
- Larger donut (≈ 200px), thicker ring, segments in `wealthTypeColor`, soft track
  (`--hairline`). Small gaps between segments (stroke gap) for a crisp Linear-ish look.
- Center: "Total" (`--faint`) + total in tabular mono (`--text`).
- Legend to the right (stacks below on mobile): swatch · type label · value (mono) · % in `--muted`.
- Subtle: segment hover raises opacity / shows a thin accent outline (CSS only).

### 5d. Holdings (restyle `WealthAssetRow` + grouping in page)
Render holdings as a **table-like grid** grouped by type:
- Group header row: type label + subtotal (mono), with a `wealthTypeColor` dot.
- Columns: **Asset** (name + ticker chip) · **Holding** (`qty × price` or "Manual") · **Price as-of**
  (source + month, `--faint`) · **Value** (right-aligned mono, `--text`) · **actions** (Edit/Delete as
  quiet icon/text buttons revealed/edited inline).
- Row: hairline divider, hover `--surface-2`. Edit swaps the row to the form inline (current behavior).
- Mobile: collapses to stacked cards (label/value pairs) — no horizontal scroll jank.

### 5e. `WealthAssetForm`
- Dark inputs: `--surface-2` bg, `--hairline` border, `--text` text, `--faint` placeholder, focus ring
  `--accent-weak` + `--accent` border. Type `<select>` styled to match (dark).
- Primary action (Add/Save) is the accent button; secondary (Cancel) is ghost. Helper + error text in
  `--muted` / `--negative`. Same fields/validation as today (presentation only).

### 5f. `RefreshPricesButton`
Ghost/outline button (hairline border, `--text`, hover `--surface-2`). Busy state: label "Refreshing…"
+ a small CSS spinner. Result message in `--muted`.

## 6. Empty, loading & responsive states

- **Empty (no assets):** a centered Panel with a quiet glyph, "No assets yet" (`--text`) + one muted
  line, and the Add form beneath. KPIs show ₹0 / 0 / "—" gracefully; donut shows a faint full ring +
  "No assets to allocate."
- **Loading:** add `app/wealth/loading.tsx` (Next route-segment skeleton) — dark shimmer placeholders
  for the KPI row, donut, and a few holding rows, using a CSS shimmer keyframe over `--surface`/
  `--surface-2`. Plus the existing button busy state.
- **Responsive (desktop-first, must not break ≥320px):** KPI 1→2→4; donut+legend side-by-side ≥640px,
  stacked below; holdings table ≥640px, stacked cards below; header wraps gracefully.

## 7. Files in scope

- `app/globals.css` — dark tokens + `@theme inline` mapping + base; `app/layout.tsx` — dark body +
  fonts; `components/Nav.tsx` — dark chrome.
- `app/wealth/page.tsx`; `app/wealth/loading.tsx` (new).
- `components/wealth/{WealthKpiCards,AllocationDonut,WealthAssetRow,WealthAssetForm,RefreshPricesButton}.tsx`;
  `components/wealth/Panel.tsx` (new dark surface primitive).
- `lib/colors.ts` — add `WEALTH_CHART` + `wealthTypeColor` (existing exports unchanged).

**Explicitly NOT touched:** `lib/finance.ts`, `lib/wealth.ts`, `lib/market/*`, `lib/data.ts`, all API
routes, `lib/validation.ts`, Prisma schema, the shared `components/Card.tsx`, and all Planning
components/pages.

## 8. Constraints (reaffirmed)

- Pure presentation — no calc/schema/API changes; Wealth components import no Planning logic.
- Zero charting deps — Tailwind + inline SVG only.
- Dark only — no toggle, no light mode, no `prefers-color-scheme`.
- All 56 tests pass; `npm run build` succeeds (font contingency in §4 guarantees the build).

## 9. Verification plan

`npm test` (expect 56 pass — pure presentation shouldn't touch them) and `npm run build` in the
isolated build copy; report results and the exact list of changed files. Specifically verify:
- Planning pages still render and are **readable** on the dark shell (smoke `/` and `/queue`).
- **Seam quality (§2):** shared `Card` border/contrast adequate against `--bg`; Nav→content seam is a
  single clean hairline; light Planning card edges aren't harsh white blocks (add a soft hairline/ring
  if needed).
- Report which font path was used (web fonts vs. fallback) and confirm no layout-shift config.

## 10. Follow-ups (post-implementation, out of scope here)

- **Re-theme Planning** (`components/Card.tsx` + all `components/dashboard/*` and Planning pages) to
  the same dark tokens, retiring the interim light-on-dark state from §2.
- **Cost-basis / gain-loss** Wealth feature will consume `--positive`/`--negative` (now reserved and
  distinct from the brand accent) for unambiguous gain/loss figures.

---

**Approval of this revision requested.** It now bakes in (a) the deliberate/temporary light-Planning
state + seam checks, (b) `positive`/`negative` as tokens distinct from the emerald accent, and the
font metric-matching. On your go-ahead I'll implement and then run `npm test` + `npm run build` and
list exactly what changed.
