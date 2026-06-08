# Personal Financial Priority Planner — Design Spec

**Date:** 2026-06-07
**Status:** Approved for implementation (decisions locked by author directive)

## 1. Purpose

A single-user web app that answers one question: **"Given my priorities, future
obligations, and available reserves, should I spend money on this today?"**

It is *not* a budgeting app and *not* an expense tracker. It surfaces the queue of
future claims on money (commitments, goals, experiences, wishes) and simulates the
impact of a hypothetical purchase.

## 2. Locked design decisions

These resolve ambiguities in the source spec. They are explicit so they can be changed.

| Topic | Decision |
|-------|----------|
| **Funding** | `fundedAmount` is entered/edited manually per item. A **projection engine** allocates monthly surplus by priority to *project* future funding (drives "delays goal by N months"). |
| **Priority** | Integer **1–5**, where **5 = highest**. Queue sorts priority desc, then due date asc. |
| **Simulator** | A hypothetical purchase deducts from **Opportunity Reserve**. Restore time = `ceil(deficit / monthlySurplus)`. Goal delay = diff of projection completion months (before vs. after). |
| **Currency** | Indian Rupee (₹), formatted with Indian digit grouping (e.g. ₹4,20,000). Hardcoded for MVP. |
| **Persistence** | SQLite via Prisma. Single `FinancialProfile` singleton + unified `PlanItem` table. Seeded with demo data. |
| **Auth** | None (single-user MVP). |

## 3. Architecture

```
Next.js (App Router, TypeScript, Tailwind)
├── app/                      UI routes (Dashboard, Queue, Timeline, Wishlist, Simulator)
│   └── api/                  Route handlers (REST-ish) over Prisma
├── lib/
│   ├── db.ts                 Prisma client singleton
│   ├── finance.ts            Pure domain logic: surplus, deficit, progress, projection, simulator
│   ├── format.ts             ₹ INR formatting + date helpers
│   └── types.ts              Shared TS types / enums
├── prisma/
│   ├── schema.prisma         FinancialProfile + PlanItem
│   └── seed.ts               Demo data
└── components/               Reusable UI (Card, ProgressBar, ItemRow, etc.)
```

**Key principle:** all money math lives in `lib/finance.ts` as **pure functions** with
no DB or React dependency, so it is unit-testable in isolation. API routes and React
components only fetch/persist and render.

## 4. Data model

### FinancialProfile (singleton, id = 1)
- `protectedCapital: Float` — current value of money that should not be spent
- `reserveTarget: Float` — Opportunity Reserve target
- `reserveCurrent: Float` — Opportunity Reserve current
- `monthlyIncome: Float`
- `monthlyExpenses: Float`
- `monthlyInvestments: Float`

### PlanItem
- `id: String (cuid)`
- `type: enum` — `COMMITMENT | GOAL | EXPERIENCE | WISHLIST`
- `title: String`
- `amount: Float` — target/estimated cost (`target_amount` for goals, `estimated_cost`/`cost` otherwise)
- `fundedAmount: Float` — default 0
- `priority: Int` — 1–5
- `dueDate: DateTime?` — required for commitment/goal/experience; null for wishlist
- `status: enum?` — `PLANNED | FUNDED | COMPLETED`; only meaningful for `COMMITMENT`
- `notes: String?` — wishlist
- `coolingPeriodDays: Int` — default 30; only meaningful for `WISHLIST`
- `dateAdded: DateTime` — default now; the cooling-period anchor for wishlist
- `purchased: Boolean` — default false; wishlist "marked as purchased" flag
- `createdAt / updatedAt`

A unified table keeps the queue/projection logic simple (one sort, one loop). Type-specific
fields are nullable and validated per-type at the API boundary.

## 5. Domain logic (`lib/finance.ts`)

All pure functions.

- `monthlySurplus(profile)` = `income - expenses - investments` (floored at 0 for projection use, but reported raw).
- `reserveDeficit(profile)` = `max(0, reserveTarget - reserveCurrent)`.
- `fundingProgress(item)` = `{ funded, target, pct }`, `pct = target>0 ? round(funded/target*100) : 0`.
- `sortQueue(items)` — priority desc, then dueDate asc (nulls last), then title.
- **`projectFunding(profile, items, opts)`** — month-by-month simulation:
  - Each month adds `monthlySurplus` to a pool.
  - The pool **first refills Opportunity Reserve** to `reserveTarget`.
  - Remaining pool funds items in queue order (priority desc, due asc), skipping
    `WISHLIST` (wishlist never auto-funded) and `COMPLETED`/`purchased` items.
  - Records the month index at which each fundable item reaches `amount`.
  - `opts.startReserve` lets the simulator start from a reduced reserve.
  - Horizon cap: 120 months (10y) to guarantee termination.
- **`simulatePurchase(profile, items, cost)`** returns:
  - `reserveBefore`, `reserveAfter = reserveCurrent - cost`
  - `reductionPct = cost / reserveCurrent * 100`
  - `monthsToRestore` = months for projection (post-purchase) to bring reserve back to target
  - `goalImpacts: [{ title, baselineMonth, newMonth, delayMonths }]` for each GOAL whose completion month shifts
  - `underfunded: string[]` — higher-or-equal-priority commitments/goals whose projected completion now exceeds their `dueDate`
  - `recommendation: 'SAFE' | 'CAUTION' | 'WAIT'` + human-readable `message`
  - **Recommendation rules:**
    - `WAIT` if `reserveAfter < 0` (can't afford from reserve), OR any goal delayed ≥ 1 month, OR any commitment/experience pushed past its due date.
    - `CAUTION` if `reductionPct > 10%` but no schedule impact.
    - `SAFE` otherwise.

## 6. UI / Views

Single app, top nav across pages. Tailwind, clean card-based layout, ₹ formatting everywhere.

1. **Dashboard** (`/`) — three summary cards: Protected Capital (current), Opportunity
   Reserve (current / target / deficit + progress bar), Monthly Surplus (with the
   income−expenses−investments breakdown). Plus a "highest-priority unfunded item" callout.
2. **Priority Queue** (`/queue`) — all non-wishlist items sorted by the queue rule, each
   row showing type badge, priority, due date, and funding progress bar (`₹funded / ₹target — %`).
   Inline create/edit/delete.
3. **Timeline** (`/timeline`) — commitments, goals, experiences grouped by month
   (`Jul 2026 — Laptop`), chronological.
4. **Wishlist** (`/wishlist`) — wishlist items with cooling-period status. "Mark purchased"
   is **disabled** with "X days remaining" until `dateAdded + coolingPeriodDays` has passed.
5. **Purchase Impact Simulator** (`/simulator`) — form (item name + cost) → calls
   `simulatePurchase`, renders reserve before/after, % reduction, months to restore, per-goal
   delays, and a color-coded recommendation banner (green SAFE / amber CAUTION / red WAIT).

## 7. API routes

- `GET/PUT /api/profile` — read/update the singleton.
- `GET/POST /api/items` — list (optionally `?type=`) / create.
- `GET/PUT/DELETE /api/items/:id` — read/update/delete one.
- `POST /api/items/:id/purchase` — wishlist mark-purchased (server re-validates cooling period).
- `POST /api/simulate` — body `{ cost }` → simulation result.

Validation with `zod` at each boundary; type-specific required fields enforced there.

## 8. Error handling

- API: invalid body → 400 with field errors; missing item → 404; profile always exists (seeded).
- Cooling-period purchase before expiry → 422 with `daysRemaining`.
- Simulator with `monthlySurplus <= 0` → returns result but `monthsToRestore = null` and a
  message noting reserve cannot be restored from surplus.
- UI: forms show inline validation; fetch failures show a toast/inline error, never crash.

## 9. Testing

- **Unit (Vitest):** `lib/finance.ts` — surplus, deficit, progress, sortQueue, projectFunding
  (including horizon cap and reserve-first allocation), simulatePurchase (SAFE/CAUTION/WAIT
  branches, goal-delay diff, zero-surplus edge).
- **Unit:** `lib/format.ts` — Indian grouping and date formatting.
- Manual smoke of each view against seed data.

## 10. MVP success criteria (mapping)

1. *What future expenses are coming?* → Timeline + Queue.
2. *Which goals are underfunded?* → Queue funding bars; Dashboard callout.
3. *Highest-priority unfunded item?* → Dashboard callout + top of Queue.
4. *Can I safely buy this today?* → Simulator recommendation.
5. *How does this affect larger goals?* → Simulator goal-delay output.

## 11. Out of scope (YAGNI for MVP)

Multi-user/auth, multi-currency, recurring transactions, bank sync, charts beyond simple
bars/timeline, editing the projection allocation strategy, mobile-native.
