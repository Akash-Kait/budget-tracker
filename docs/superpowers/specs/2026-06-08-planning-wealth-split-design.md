# Planning / Wealth Split + Remove Protected Capital — Design Spec (Iteration 5)

**Date:** 2026-06-08
**Status:** Approved for implementation (decisions confirmed by author)
**Builds on:** iterations 1–4.

## 1. Goal

Split finances into two **independent** modules and drop the unused "Protected Capital" concept:

- **Planning (cash-based):** reserve (current/target), monthly income/expenses/investments, derived surplus, and all items (goals, commitments, experiences, wishlist) + the projection engine, reserve-recovery, and purchase simulator. This is the existing app.
- **Wealth (investment-based):** manually-entered investment assets (mutual funds, stocks, other) with a total value. New page, new data, new pure module.

**Hard rule:** the planning engine, projections, reserve-recovery, and simulator operate **only** on Planning data and **must ignore Wealth assets entirely**. No Wealth value ever feeds a Planning calculation.

## 2. Locked decisions

| Topic | Decision |
|-------|----------|
| **Protected Capital** | Removed everywhere — `FinancialProfile.protectedCapital` column, `Profile` type, `profileSchema`, `getProfile` mapping, seed, and the Settings form field. It was used in zero calculations (confirmed in iteration-4 review P2-2). |
| **Module separation** | Planning logic stays in `lib/finance.ts` (unchanged except the `Profile` type loses `protectedCapital`). Wealth logic lives in a **new** `lib/wealth.ts`. They never import each other. |
| **Asset fields** | `name` (req), `type` (enum), optional `ticker`, `quantity`, `pricePerUnit`, and a manual `value` fallback. **Effective value** = `quantity × pricePerUnit` when both are present, else `value ?? 0`. Future market-data APIs update `pricePerUnit`. |
| **Asset types** | Fixed enum `MUTUAL_FUND | STOCK | OTHER`. Assets are grouped by type on the Wealth page. `OTHER` gets no special handling — same fields, same wealth-only role. |
| **Cross-link** | Planning dashboard shows a **passive, read-only Total Wealth stat** that links to `/wealth`. It never enters any Planning calculation. |
| **Persistence** | New `WealthAsset` table (Prisma/SQLite). `db push` drops `protectedCapital` and adds the table; reseed with a few demo assets. |

## 3. Data model

### FinancialProfile (Planning) — change
- **Remove** `protectedCapital`. Everything else unchanged.

### WealthAsset (Wealth) — new
- `id: String (cuid)`
- `name: String`
- `type: String` — `MUTUAL_FUND | STOCK | OTHER` (validated by Zod; SQLite has no enums)
- `ticker: String?`
- `quantity: Float?`
- `pricePerUnit: Float?`
- `value: Float?` — manual fallback when units/price don't apply
- `createdAt / updatedAt`

`WealthAsset` (TS type) + `ASSET_TYPES`/`AssetType` go in `lib/types.ts`.

## 4. Domain logic (`lib/wealth.ts`, pure — independent of `lib/finance.ts`)

- `assetValue(asset)` → `quantity != null && pricePerUnit != null ? quantity * pricePerUnit : (value ?? 0)`, rounded to paise.
- `totalWealth(assets)` → sum of `assetValue`.
- `groupByType(assets)` → `{ type, label, assets, subtotal }[]` in a fixed type order (Mutual Funds, Stocks, Other), omitting empty groups.

Planning (`lib/finance.ts`) is untouched apart from the `Profile` type dropping `protectedCapital`.

## 5. API (`/api/wealth`)

- `GET /api/wealth` → all assets, newest first, each with computed `value`.
- `POST /api/wealth` → create (Zod-validated).
- `PUT /api/wealth/:id` → update.
- `DELETE /api/wealth/:id` → delete.
All wrapped in `withErrorHandling` (the iteration-4 wrapper: bad JSON→400, P2025→404).

**Validation** (`wealthAssetSchema`): `name` min 1 (max 200), `type` enum, `ticker` optional string (max 20), `quantity`/`pricePerUnit`/`value` optional numbers ≥ 0, **refine**: at least one of (`quantity` AND `pricePerUnit`) or `value` must be provided so a value is always derivable.

## 6. UI

- **`/wealth` page** (new, server component) — loads assets + total; renders:
  - A header **Total Wealth** figure.
  - Sections **grouped by type** (Mutual Funds / Stocks / Other), each with a subtotal and its asset rows (name, ticker, `qty × price` or manual value, computed value).
  - An **Add asset** form and inline **Edit/Delete** per row (client components, mirroring the existing item CRUD patterns).
  - Empty state when no assets.
- **Nav** — add a **Wealth** link.
- **Planning dashboard** (`/`) — add a small, visually-distinct **Total Wealth** card (read-only) linking to `/wealth`, fed by a `totalWealth` prop the page computes server-side. It is *not* part of the Planning KPI row and never affects the gauge, liability, projection, or simulator.
- **Settings** — remove the Protected Capital input.

## 7. Components (new, under `components/wealth/`)

- `WealthAssetForm.tsx` (client) — create/edit; type select, name, ticker, quantity, price, manual value; submits to the API.
- `WealthAssetRow.tsx` (client) — display + Edit toggle (reuses the form) + Delete.
- The page composes these; `Money` is reused for ₹ formatting.

## 8. Error / edge handling

- Asset with neither (units+price) nor value → 400 (Zod refine).
- Quantity/price present but value also present → computed `units × price` wins (documented).
- Empty wealth → total ₹0, friendly empty state; dashboard Total Wealth shows ₹0.
- Negative inputs rejected (≥ 0).

## 9. Testing (Vitest)

- `lib/wealth.ts`: `assetValue` (units×price, manual fallback, both-missing→0, rounding), `totalWealth` (sum, empty→0), `groupByType` (order, subtotals, empty groups omitted).
- Confirm `lib/finance.ts` tests still pass after `Profile` drops `protectedCapital` (update the test fixture).

## 10. Migration / seed

- `prisma db push --accept-data-loss` (drops `protectedCapital`, adds `WealthAsset`).
- `seed.ts`: remove `protectedCapital`; add ~4 demo assets (e.g., an index fund with units×NAV, two stocks with ticker/qty/price, one OTHER with a manual value) so `/wealth` is populated.

## 11. Out of scope

Real market-data API integration (the schema leaves `ticker`/`pricePerUnit` headroom for it); linking `monthlyInvestments` (SIP) to Wealth assets (they stay decoupled per the hard rule); gain/loss vs cost basis; any Wealth figure influencing Planning.
