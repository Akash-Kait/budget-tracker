# Wealth Cost-Basis + Gain/Loss Layer — Design Spec

**Date:** 2026-06-08
**Status:** AWAITING APPROVAL — do not implement until approved.
**Scope:** Add cost basis + gain/loss to the Wealth module (schema, types, Zod, data, pure logic,
Wealth UI). **Firewall holds:** `lib/wealth.ts` must not import `lib/finance.ts` or `lib/market/`.
No Planning changes. No price-provider work in this spec.

## 1. Goal

Make each holding's **gain/loss** visible — absolute and %, portfolio-wide and per asset — using the
**manual prices already entered**. The hard requirement: **"unknown cost basis" must be
distinguishable from "zero gain."** Unknown → `null` (and the UI says "—/not set"); a real flat
position → `{ absolute: 0, pct: 0 }`.

## 2. Key decision to confirm

**`costBasis` = total amount invested in the holding** (a single total, in ₹), *not* a per-unit average
price. Rationale: one nullable field works uniformly for `qty × price` assets and `manual value`
assets, and gain/loss is simply `currentValue − costBasis`. (Alternative — store avg cost/unit and
derive total as `avgCost × quantity` — is rejected for MVP: it doesn't apply to manual-value assets and
adds a second nullable interplay. Per-unit can come later if needed.) **Please confirm "total invested"
before I implement.**

`purchaseDate` is stored for display ("held since …") and as headroom for future annualized-return
(XIRR) work. **It does not enter the gain/loss math** (gain/loss is value − basis regardless of date).

## 3. Schema delta (additive — `prisma db push`, no data loss)

```prisma
model WealthAsset {
  // … existing fields …
  costBasis    Float?     // total amount invested (₹); null = unknown
  purchaseDate DateTime?  // optional; display + future XIRR headroom
}
```

## 4. Types (`lib/types.ts`)

```ts
export interface WealthAsset {
  // … existing …
  costBasis: number | null;
  purchaseDate: string | null; // ISO
}
```

## 5. Validation (`lib/validation.ts`, `wealthAssetSchema`)

Add (both optional/nullable; cost basis is system-meaningful so ≥ 0):
```ts
costBasis: z.number().min(0).nullable().optional(),
purchaseDate: z.string().datetime().nullable().optional(),
```
No change to the existing "qty+price OR manual value" refine. Cost basis is independent of how
*current value* is derived.

## 6. Data (`lib/data.ts`, `getWealthAssets`)

Map the two new columns into the DTO: `costBasis: r.costBasis`, `purchaseDate: r.purchaseDate ?
r.purchaseDate.toISOString() : null`. API `POST`/`PUT` (`app/api/wealth[/[id]]`) pass them through
(present → set, absent → null), unchanged otherwise.

## 7. Pure functions (`lib/wealth.ts`) — signatures + null rules

```ts
/** Total invested in the holding, or null when unknown (NOT 0). */
export function assetCostBasis(a: WealthAsset): number | null;

export interface GainLoss {
  absolute: number;     // currentValue − costBasis (may be negative)
  pct: number | null;   // % of cost basis; null when cost basis is 0 (undefined %)
}

/** Gain/loss for one asset, or null when cost basis is unknown (distinct from a flat 0 result). */
export function assetGainLoss(a: WealthAsset): GainLoss | null;

/** Sum of known cost bases; null when NO asset has a cost basis (fully unknown). */
export function totalCostBasis(assets: WealthAsset[]): number | null;

/** Portfolio gain/loss over the subset of assets WITH a cost basis; null when none have one. */
export function totalGainLoss(assets: WealthAsset[]): GainLoss | null;
```

**Null/edge rules (the crux):**

| Situation | `assetGainLoss` result | UI shows |
|-----------|------------------------|----------|
| cost basis **unknown** (`null`) | **`null`** | "—" / "Cost basis not set" (faint) — **never** ₹0/0% |
| cost basis set, value > basis | `{ absolute > 0, pct > 0 }` | gain in **`--positive`** |
| cost basis set, value < basis | `{ absolute < 0, pct < 0 }` | loss in **`--negative`** |
| cost basis set, value == basis | `{ absolute: 0, pct: 0 }` | flat, **neutral** (`--muted`), not green/red |
| cost basis **= 0** (explicit) | `{ absolute: value, pct: null }` | absolute in `--positive`; **pct "—"** (division guard) |

- Implementation: `basis === null → return null`; else `absolute = round2(assetValue(a) − basis)`,
  `pct = basis > 0 ? round2((absolute / basis) * 100) : null`. Reuse the existing private `round2`;
  pct rounded to 2 dp.
- `totalCostBasis` / `totalGainLoss` operate over `assets.filter(a => assetCostBasis(a) !== null)`;
  return `null` if that subset is empty. `totalGainLoss.absolute = round2(Σvalue − Σbasis)` over the
  covered subset; `pct = Σbasis > 0 ? round2(absolute/Σbasis*100) : null`. (Current value in the total
  is the covered subset's value, so absolute and basis are consistent.)
- **Partial coverage:** when some holdings lack a cost basis, the portfolio total reflects only the
  covered ones; the UI derives coverage as `count(assetCostBasis != null)` of `assets.length` and
  shows a caveat (e.g. "based on 3 of 5 holdings"). No extra function needed.

**Firewall:** these are pure, import only `WealthAsset`/existing wealth helpers — no `finance.ts`, no
`market/`.

## 8. Wealth UI

- **`WealthAssetForm`** — add **Cost basis (total invested)** and **Purchase date** inputs (both
  optional); cost-basis field is mono/tabular. No change to current-value logic.
- **`WealthAssetRow`** — add a gain/loss element near the value: `assetGainLoss` → colored with
  `--positive`/`--negative` (`+₹X (+Y%)` / `−₹X (−Y%)`), **neutral** when flat, **"— not set"** (faint)
  when `null`, and **"+₹X (—)"** when pct is null (zero basis). Optionally show "held since
  {purchaseDate}" in faint.
- **`WealthKpiCards`** — add a **Total Gain / Loss** KPI: `totalGainLoss` absolute + pct, colored;
  shows "—" when `null` (no basis anywhere); appends the coverage caveat when partial. (Likely a 5th
  card or replace "Asset Types"; final layout decided in implementation, KPI grid stays responsive.)
- Tokens: gain/loss uses **`--positive`/`--negative` only** — never the emerald brand `--accent`
  (already reserved for exactly this reason).

## 9. Test matrix (`lib/__tests__/wealth.test.ts`) — required cases

`assetCostBasis`: null when unset; returns the number when set (including `0`).
`assetGainLoss`:
- **no cost basis → `null`** (asserted distinct from a `{absolute:0}` result),
- **gain** (e.g. value 1200, basis 1000 → `{absolute:200, pct:20}`),
- **loss** (value 800, basis 1000 → `{absolute:-200, pct:-20}`),
- **zero gain** (value 1000, basis 1000 → `{absolute:0, pct:0}`),
- **zero cost basis** (basis 0, value 500 → `{absolute:500, pct:null}` — division guard),
- **qty×price asset vs manual-value asset** both compute from the right current value.
`totalCostBasis`: `null` when none have basis; correct sum of knowns in a mixed portfolio.
`totalGainLoss`: `null` when none have basis; **mixed portfolio** counts only covered assets; correct
aggregate absolute + pct; zero-total-basis guard → `pct: null`, `absolute = covered value`.

The `asset()` test factory gains `costBasis: null, purchaseDate: null` defaults.

## 10. Verification

`npm test` (existing 56 + new gain/loss cases) and `npm run build` in the isolated copy; confirm the
firewall (`grep` that `lib/wealth.ts` imports neither `finance` nor `market`); smoke `/wealth` to see
gain/loss colors, the unknown "— not set" state, and the zero-basis "—%" case.

## 11. Sequencing — flagged for later (do NOT skip)

1. **This spec:** cost-basis + gain/loss layer.
2. **⚠ BEFORE any price-provider work:** add the still-missing **route-handler tests** (wealth + items
   CRUD, validation/404/422 branches) and the **What-If recompute tests** (Dashboard's client
   derivation). These guard the surfaces a live price feed will start mutating; they must land first.
3. **Price provider — AMFI daily NAV for mutual funds** behind the existing `PriceProvider` interface
   (free, no-auth; MFs are the largest asset class). Depends on this spec's cost-basis fields to show
   gain/loss against live NAV.
4. **Groww (stocks)** importer as a *separate* provider boundary, after AMFI.

---

**Approval requested.** Confirm §2 (`costBasis` = total invested) and the §7 null rules — or adjust —
and I'll implement the schema → types → Zod → data → pure functions (TDD) → Wealth UI, then report
`npm test` + `npm run build` and the exact changed files.
