# Budget Tracker — Repository Analysis

> Snapshot as of 2026-06-08 (after iteration 5: Planning/Wealth split). A point-in-time
> architecture overview + recommendations. See `docs/superpowers/` for per-iteration specs/plans
> and `REVIEW.md` for the standing code-review findings.

**Personal Financial Priority Planner** — a single-user Next.js 16 (App Router) + TypeScript +
Tailwind 4 app over Prisma 6 / SQLite. Two independent domains: **Planning** (cash-based) and
**Wealth** (investment-based). No auth (single-user MVP).

## 1. Project structure

```
budget-tracker/
├── app/
│   ├── page.tsx                 Planning dashboard (server → client <Dashboard>)
│   ├── layout.tsx, globals.css
│   ├── queue/ ranking/ timeline/ wishlist/ history/ simulator/ settings/ wealth/  (page.tsx each)
│   └── api/
│       ├── profile/route.ts                     GET/PUT financial profile
│       ├── simulate/route.ts                    POST purchase simulation
│       ├── items/route.ts                        GET/POST plan items
│       ├── items/[id]/route.ts                   GET/PUT/DELETE
│       ├── items/[id]/{funding,complete,restore,convert,purchase}/route.ts
│       ├── items/reorder/route.ts                POST rank reorder
│       └── wealth/route.ts , wealth/[id]/route.ts  Wealth asset CRUD
├── components/
│   ├── dashboard/   Dashboard, KpiCards, WhatIfBar, ReserveGauge, FundingBars,
│   │                LiabilityTreemap, GoalTimeline, SurplusProjection   (Planning visuals)
│   ├── wealth/      WealthAssetForm, WealthAssetRow
│   └── (shared)     ItemForm, EditableItemRow, FundingPanel, WishlistRow, ConvertForm,
│                    RankingList, ProfileForm, Nav, Card, Money, ProgressBar, RecommendationBanner
├── lib/
│   ├── finance.ts     Planning engine (pure)
│   ├── wealth.ts      Wealth engine (pure, independent of finance.ts)
│   ├── data.ts        Prisma read layer → plain DTOs
│   ├── validation.ts  Zod schemas
│   ├── handler.ts     withErrorHandling API wrapper
│   ├── types.ts       shared types/enums
│   ├── format.ts      ₹ INR + date helpers     colors.ts     db.ts (Prisma singleton)
│   └── __tests__/     finance / format / wealth  (48 Vitest tests)
└── prisma/  schema.prisma, seed.ts
```

**Layering:** pure domain (`finance.ts`, `wealth.ts`) → read layer (`data.ts`) → thin API route
handlers (Zod + `withErrorHandling`) → server pages → client components. Pure logic imports no
DB/React, so the client what-if runs the same functions as the server.

## 2. Prisma schema

| Model | Purpose | Key fields |
|-------|---------|-----------|
| **FinancialProfile** (singleton `id=1`) | Planning cash state | `reserveTarget`, `reserveCurrent`, `monthlyIncome`, `monthlyExpenses`, `monthlyInvestments` |
| **PlanItem** | Unified commitment/goal/experience/wishlist | `type`, `title`, `amount`, `priority` (1–5), `rank`, `dueDate?`, `status?`, `notes?`, `coolingPeriodDays`, `dateAdded`, `purchased`, `fundings[]` |
| **FundingTransaction** | Append-only funding ledger | `itemId` (→PlanItem, `onDelete: Cascade`, indexed), `amount`, `note?`, `date` |
| **WealthAsset** | Investment holdings | `name`, `type`, `ticker?`, `quantity?`, `pricePerUnit?`, `value?` (manual fallback) |

SQLite has no enums — `type`/`status` are validated strings. **`fundedAmount` is not stored** —
derived as `SUM(fundings.amount)` in the read layer. Money is `Float`, rounded to paise via
`roundMoney`.

## 3. Main domain models (`lib/types.ts`)

- **`Profile`** — the 5 planning cash fields (Protected Capital removed in iteration 5).
- **`Item`** — PlanItem DTO with derived `fundedAmount`, ISO-string dates; `ItemType =
  COMMITMENT|GOAL|EXPERIENCE|WISHLIST`, `Status = PLANNED|FUNDED|COMPLETED`.
- **`WealthAsset`** — `AssetType = MUTUAL_FUND|STOCK|OTHER` + `ASSET_TYPE_LABELS`; nullable
  `ticker/quantity/pricePerUnit/value`.
- **`Recommendation = SAFE|CAUTION|WAIT`** — simulator verdict.

## 4. Routes / pages

**Pages (all `force-dynamic`):** `/` Planning dashboard · `/queue` · `/ranking` (drag) ·
`/timeline` · `/wishlist` (cooling period + convert) · `/history` · `/simulator` · `/settings` ·
`/wealth`.

**API (all `withErrorHandling`-wrapped):**
- Planning: `GET/PUT /api/profile`; `GET/POST /api/items`; `GET/PUT/DELETE /api/items/[id]`;
  `POST /api/items/[id]/{funding,complete,restore,convert,purchase}`; `POST /api/items/reorder`;
  `POST /api/simulate`.
- Wealth: `GET/POST /api/wealth`; `PUT/DELETE /api/wealth/[id]`.

`withErrorHandling` maps bad JSON→400, ZodError→400, Prisma `P2025`→404, `P2002`→409, else→500
(no stack leak).

## 5. Dashboard architecture

`app/page.tsx` (server) loads `getProfile()`, `getItems()`, `getWealthAssets()` in parallel and
renders the client `<Dashboard profile items totalWealth>`. The Dashboard holds **Quick What-If**
state and recomputes everything client-side from the pure finance functions:

- `sim = simulatePurchase(profile, items, cost)` when cost > 0; `effProfile.reserveCurrent =
  reserveCurrent − cost`.
- Renders: **KpiCards** (Reserve Health %, Future Funding Needed, Top Unfunded, Months to Fully
  Fund, Monthly Surplus) · passive **Total Wealth** link (never in any calc) · **WhatIfBar**
  (+`RecommendationBanner`) · **ReserveGauge** · **FundingBars** · **LiabilityTreemap** ·
  **GoalTimeline** · **SurplusProjection** (12-mo stacked, `startReserve = effProfile.reserveCurrent`).
- Visual components are zero-dependency Tailwind + inline SVG.

Wealth has no visual dashboard yet — `/wealth` is a grouped list with subtotals + total.

## 6. Finance calculation engine

**`lib/finance.ts` (Planning, pure):** `monthlySurplus`, `reserveDeficit`,
`reserveRecoveryMonths`, `monthsToFullyFund`, `remaining`, `fundingProgress`,
`totalFutureLiability`, `sortQueue` (priority→rank→dueDate→title), `isActive`/`isDone`,
**`projectFunding`** (month-by-month: refill reserve to target, then fund by queue order;
120-mo horizon), **`projectMonthlyAllocation`** (same rule, per-month breakdown for the chart —
near-duplicate of `projectFunding`), **`simulatePurchase`** (baseline-vs-after projection diff →
`goalImpacts`/`nowUnfundable`/`underfunded`/`monthsToRestore`/`reductionPct`/recommendation),
`projectedCompletion`.

**`lib/wealth.ts` (Wealth, pure, independent):** `assetValue` (`quantity × pricePerUnit` else
`value ?? 0`), `totalWealth`, `groupByType`.

Planning never reads Wealth and vice versa.

## 7. Recommended changes

### A. Planning dashboard
- Consolidate `projectFunding` + `projectMonthlyAllocation` into one `stepMonth()` primitive (they can drift — REVIEW P2-3).
- Extract the cooling-period rule from the route + wishlist page into a pure `coolingDaysRemaining()` in `finance.ts` (REVIEW P2-5).
- Centralize the read/DTO mapping in `data.ts`; `GET /api/items` currently returns a different shape than `getItems()` (REVIEW P2-4).
- Mark which dashboard tiles are simulated when a what-if is active (REVIEW P2-7).

### B. Wealth dashboard
- Give Wealth its own visual layer: type-allocation chart (donut/treemap), per-type subtotals, total headline, a WealthKpiCards row. Add `allocationByType()` to `lib/wealth.ts`.
- Add `getWealthAsset(id)` + a `toAsset()` mapper to `data.ts`; validate `type` on read.

### C. Funding transactions
- Cap over-funding or carry overflow visibly (`fundedAmount` is uncapped; overflow vanishes from liability, pct can exceed 100 — REVIEW P2-9).
- Add a dedicated funding-history view (data exists via `getFundings`).
- Optional `FundingTransaction.kind` (`DEPOSIT|WITHDRAWAL|ADJUSTMENT`) headroom.

### D. Investment assets
- Add `costBasis` (+ `purchaseDate`) for gain/loss; `account`/`institution`; `currency` (today implicitly INR).

### E. Future market-data integration (headroom already present via `ticker` + `pricePerUnit`)
- Add `lastPrice`, `priceUpdatedAt`, `priceSource (MANUAL|API)` so a fetched quote updates `pricePerUnit` while keeping a manual override. `assetValue` keys off `quantity × pricePerUnit`, so the value math needs no change.
- Introduce a `PriceProvider` interface in `lib/market/` (`ManualProvider` now, API provider later).
- A batch refresh endpoint/job (`POST /api/wealth/refresh-prices`) for assets with a `ticker`, behind a flag.
- Keep the hard rule: market data stays in Wealth; `finance.ts` never imports `lib/market/` or `lib/wealth.ts`.

### Cross-cutting (REVIEW.md, still open)
- API/handler + Dashboard test coverage (only pure libs tested today).
- Money as integer paise vs Float, if exactness becomes critical.
- `prisma migrate` instead of `db push`; prod-guard the destructive seed; before any shared/real DB.
