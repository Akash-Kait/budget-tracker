# Personal Financial Priority Planner

Decide whether to spend money today by seeing all future claims on it — commitments,
goals, experiences, and wishes — in one place. This is **not** a budgeting or
expense-tracking app; it answers a single question: *"Given my priorities, future
obligations, and available reserves, should I buy this today?"*

## Setup

```bash
npm install
npm run db:push     # create the SQLite schema
npm run db:seed     # load demo data
npm run dev         # http://localhost:3000
```

## Test

```bash
npm test            # vitest unit tests for the finance + format logic
```

## Views

- **Dashboard** — Protected Capital, Opportunity Reserve (with deficit + progress),
  Monthly Surplus (income − expenses − investments), and the highest-priority unfunded item.
- **Priority Queue** — every non-wishlist item sorted by priority (highest first) then
  due date; create / edit / delete inline.
- **Timeline** — commitments, goals, and experiences in chronological order.
- **Wishlist** — discretionary wants with a cooling-period guard: "Mark purchased" stays
  disabled until `dateAdded + coolingPeriodDays` has passed.
- **Simulator** — enter a cost and see reserve before/after, % reduction, months to restore
  the reserve, per-goal delays, and a colour-coded **SAFE / CAUTION / WAIT** verdict.
- **Settings** — edit the financial profile (reserves, monthly figures).

## How the simulator works

A hypothetical purchase is deducted from the **Opportunity Reserve**. A month-by-month
projection allocates the monthly surplus — refilling the reserve to target first, then
funding queue items by priority — to estimate when each goal completes. Running that
projection before and after the purchase yields the goal-delay figures.

## Tech

Next.js (App Router) · TypeScript · Tailwind CSS · Prisma + SQLite · Zod · Vitest.
Currency is INR (₹). Single-user, no authentication (MVP).

## Docs

- Design spec: `docs/superpowers/specs/2026-06-07-financial-priority-planner-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-07-financial-priority-planner.md`
