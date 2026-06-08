# Budget Tracker — Architecture & Current State

> **Reading this fresh (e.g. pasted into a new chat)?** This is a self-contained snapshot of a
> working app so you can recommend next steps without seeing the code. It states what exists, what's
> already done, and what's open. Snapshot date: **2026-06-08**.

## What this app is

A **single-user Personal Financial Priority Planner**: it answers *"given my reserves, priorities,
and future obligations, should I spend money on this today?"* It is **not** a budgeting / expense
tracker. Two **independent** domains:

- **Planning** (cash-based) — Opportunity Reserve, monthly income/expenses/investments, a queue of
  future claims (commitments, goals, experiences, wishlist), funding progress, a month-by-month
  projection engine, and a purchase-impact simulator.
- **Wealth** (investment-based) — manually-entered holdings (mutual funds, stocks, other) with a
  visual dashboard. **Hard rule: Wealth never feeds any Planning calculation** (and vice-versa).

**Stack:** Next.js **16.2.7** (App Router), React **19.2.4**, TypeScript, Tailwind 4, Prisma **6** /
SQLite, Zod, Vitest. Currency **INR (₹)**. No auth (single-user MVP). Zero charting deps — all
visuals are Tailwind + inline SVG. **56 unit tests** pass (finance / format / wealth / market).

## 1. Project structure

```
app/
  page.tsx                      Planning dashboard (server → client <Dashboard>)
  layout.tsx, globals.css
  queue/ ranking/ timeline/ wishlist/ history/ simulator/ settings/ wealth/   (page.tsx each)
  api/
    profile/route.ts                          GET/PUT financial profile
    simulate/route.ts                          POST purchase simulation
    items/route.ts                              GET/POST
    items/[id]/route.ts                         GET/PUT/DELETE
    items/[id]/{funding,complete,restore,convert,purchase}/route.ts
    items/reorder/route.ts                      POST rank reorder
    wealth/route.ts , wealth/[id]/route.ts      Wealth CRUD
    wealth/refresh-prices/route.ts              POST batch price refresh (provider-backed)
components/
  dashboard/   Dashboard, KpiCards, WhatIfBar, ReserveGauge, FundingBars,
               LiabilityTreemap, GoalTimeline, SurplusProjection         (Planning visuals)
  wealth/      WealthAssetForm, WealthAssetRow, WealthKpiCards, AllocationDonut, RefreshPricesButton
  (shared)     ItemForm, EditableItemRow, FundingPanel, WishlistRow, ConvertForm, RankingList,
               ProfileForm, Nav, Card, Money, ProgressBar, RecommendationBanner
lib/
  finance.ts   Planning engine (pure; no DB/React imports)
  wealth.ts    Wealth engine (pure; never imports finance.ts)
  market/provider.ts   Price-provider interface + manual default (market-data boundary)
  data.ts      Prisma read layer → plain DTOs
  validation.ts (Zod)   handler.ts (withErrorHandling)   types.ts   format.ts   colors.ts   db.ts
  __tests__/   finance / format / wealth / market
prisma/  schema.prisma, seed.ts
docs/  ARCHITECTURE.md (this file), superpowers/specs+plans (per-iteration), REVIEW.md
```

**Layering:** pure domain (`finance.ts`, `wealth.ts`, `market/`) → read layer (`data.ts`) → thin
Zod-validated, error-wrapped API route handlers → server pages → client components. Because the pure
layer has no DB/React deps, the client what-if runs the *same* functions as the server.

## 2. Prisma schema (SQLite)

```prisma
model FinancialProfile {           // singleton id=1 — Planning cash state
  id Int @id @default(1)
  reserveTarget Float; reserveCurrent Float
  monthlyIncome Float; monthlyExpenses Float; monthlyInvestments Float
  updatedAt DateTime @updatedAt
}

model PlanItem {                   // unified commitment/goal/experience/wishlist
  id String @id @default(cuid())
  type String                      // COMMITMENT | GOAL | EXPERIENCE | WISHLIST
  title String; amount Float; priority Int (1–5); rank Int
  dueDate DateTime?; status String?  // PLANNED | FUNDED | COMPLETED
  notes String?; coolingPeriodDays Int; dateAdded DateTime; purchased Boolean
  fundings FundingTransaction[]
}

model FundingTransaction {         // append-only funding ledger
  id String @id; itemId String (→PlanItem, onDelete Cascade, @@index)
  amount Float; note String?; date DateTime
}

model WealthAsset {                // investment holding (Wealth only)
  id String @id @default(cuid())
  name String; type String         // MUTUAL_FUND | STOCK | OTHER
  ticker String?; quantity Float?; pricePerUnit Float?; value Float?  // value = qty×price else manual
  lastPrice Float?; priceUpdatedAt DateTime?; priceSource String?      // MANUAL | API (market-data headroom)
  createdAt; updatedAt
}
```

Notes: SQLite has no enums — `type`/`status`/`priceSource` are validated strings. **`fundedAmount` is
not stored** — derived as `SUM(fundings.amount)`. Money is `Float`, rounded to paise via `roundMoney`.

## 3. Domain models (`lib/types.ts`)

- **`Profile`** — 5 planning cash fields (Protected Capital was removed).
- **`Item`** — PlanItem DTO with derived `fundedAmount`, ISO-string dates.
- **`WealthAsset`** — `AssetType = MUTUAL_FUND|STOCK|OTHER`; nullable `ticker/quantity/pricePerUnit/value`
  + `lastPrice/priceUpdatedAt/priceSource (MANUAL|API)`.
- **`Recommendation = SAFE|CAUTION|WAIT`**.

## 4. Routes / pages

Pages (all `force-dynamic`): `/` Planning dashboard · `/queue` · `/ranking` (drag) · `/timeline` ·
`/wishlist` · `/history` · `/simulator` · `/wealth` · `/settings`.

API (all wrapped by `withErrorHandling`: bad JSON→400, ZodError→400, Prisma `P2025`→404, `P2002`→409,
else→500 with no stack leak): profile GET/PUT · simulate POST · items GET/POST · items/[id]
GET/PUT/DELETE · items/[id]/{funding,complete,restore,convert,purchase} POST · items/reorder POST ·
wealth GET/POST · wealth/[id] PUT/DELETE · **wealth/refresh-prices POST**.

## 5. Dashboards

**Planning** (`/`, `app/page.tsx` server → client `<Dashboard>`): loads profile + items + wealth-total
in parallel. Holds a **Quick What-If** (item name + cost) that recomputes everything client-side from
the pure finance functions (`simulatePurchase`, `projectMonthlyAllocation` with a reduced
`startReserve`). Renders: KPI row (Reserve Health %, Future Funding Needed, Top Unfunded, Months to
Fully Fund, Monthly Surplus) · a **passive Total Wealth** link (never in any calc) · WhatIf banner ·
ReserveGauge (SVG) · FundingBars (with over-funding state) · LiabilityTreemap · GoalTimeline ·
SurplusProjection (12-mo stacked).

**Wealth** (`/wealth`): WealthKpiCards (Total, Holdings, Largest, Asset Types) · AllocationDonut (SVG
donut + legend, value & % per type) · Refresh-prices button · assets grouped by type with subtotals,
inline add/edit/delete, and an "as of <month>" price line. Fully independent of Planning.

## 6. Calculation engines (pure)

**`lib/finance.ts` (Planning):** `monthlySurplus`, `reserveDeficit`, `reserveRecoveryMonths`,
`monthsToFullyFund`, `remaining`, `fundingProgress` (clamps pct, reports `overFundedBy`),
`totalFutureLiability`, `sortQueue` (priority→rank→dueDate→title), `isActive`/`isDone`,
`projectedCompletion`, **`simulatePurchase`** (baseline-vs-after projection diff →
`goalImpacts`/`nowUnfundable`/`underfunded`/`monthsToRestore`/`reductionPct`/recommendation).
**One private `runAllocation` core** (reserve-refill-first, then priority/rank order, 120-mo horizon)
backs both `projectFunding` (returns per-item completion month) and `projectMonthlyAllocation`
(per-month breakdown) — they cannot drift.

**`lib/wealth.ts` (Wealth):** `assetValue` (`qty×price` else manual), `totalWealth`, `groupByType`,
`allocationByType`, `largestHolding`.

**`lib/market/provider.ts`:** `PriceProvider` interface + `manualProvider` (no live quotes) +
`getPriceProvider()` (env-switchable later). The single market-data boundary; `finance.ts` never
imports it.

## 7. Status of recommendations (✅ done / ☐ open)

✅ **Planning/Wealth split** + Protected Capital removed (used in zero calcs).
✅ **Wealth visual dashboard** — KPI row + allocation donut.
✅ **Projection engines consolidated** onto one `runAllocation` core (+ consistency test).
✅ **Over-funding surfaced** — `fundingProgress.overFundedBy`, amber UI state; **funding-history**
   summary in the panel.
✅ **Market-data groundwork** — `PriceProvider` interface + manual provider, `lastPrice/priceUpdatedAt/
   priceSource`, `POST /api/wealth/refresh-prices` (no-op under manual mode), manual-price "as of" stamps.
✅ **API error wrapper** (`withErrorHandling`) on every route.

☐ **Wire a real price provider** behind `PriceProvider` (e.g. an MF NAV / equity quote API), env-gated,
   plus a scheduled/refresh trigger. Value math already keys off `pricePerUnit`, so no change needed there.
☐ **Cost basis / gain-loss** on `WealthAsset` (`costBasis`, `purchaseDate`); `account`/`institution`;
   per-asset `currency` (today implicitly INR).
☐ **Centralize the read/DTO mapping** in `data.ts` — `GET /api/items` still returns a slightly different
   shape than `getItems()`; add `getItem(id)`/`getWealthAsset(id)` + single mappers (eases future auth).
☐ **Extract the cooling-period rule** from the route + wishlist page into a pure `coolingDaysRemaining()`.
☐ **Mark which dashboard tiles are simulated** when a What-If is active (gauge shifts, KPI cards don't).
☐ **Test coverage** for API route handlers and the Dashboard recompute (only pure libs are tested today).
☐ **Money as integer paise** (vs Float) if exactness becomes critical.
☐ **`prisma migrate`** instead of `db push`; **prod-guard the destructive seed**; before any shared/real DB.
☐ **Multi-user/auth** (currently single-user; `FinancialProfile` is a hard-coded singleton `id=1`).

## 8. How to run

```bash
npm install
npm run db:push      # sync SQLite schema (after pulling schema changes too)
npm run db:seed      # demo data (Planning items + Wealth assets) — destructive reseed
npm run dev          # http://localhost:3000
npm test             # 56 Vitest unit tests
npm run build        # production build
```

## 9. Constraints / gotchas (for whoever works on this next)

- **No auth** by design; `FinancialProfile` is a singleton. Multi-user is a deliberate future step.
- **Keep the Planning/Wealth firewall:** `lib/finance.ts` must never import `lib/wealth.ts` or
  `lib/market/`. Wealth/market values are display-only and must not influence reserve/projection/simulator.
- **Native binaries / `node_modules` are per-OS** (esbuild, lightningcss, Prisma engine, rolldown). Do
  not share/sync a single `node_modules` across macOS and Linux — reinstall per platform. Never run
  `npm audit fix --force` (it has silently downgraded `next`).
- Currency is hardcoded ₹/`en-IN`; locale is not yet centralized.

---

### Suggested prompt to get next steps

> "Here's the architecture of my Next.js personal finance app (ARCHITECTURE.md below). Given the
> ✅ done and ☐ open items in §7, propose a prioritized next-steps plan — what to build next and why,
> with any design decisions I should make. Keep the Planning/Wealth firewall intact."
