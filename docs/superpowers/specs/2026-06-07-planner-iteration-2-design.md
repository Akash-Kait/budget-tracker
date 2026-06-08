# Financial Priority Planner — Iteration 2 Design Spec (P0 + P1)

**Date:** 2026-06-07
**Status:** Approved for implementation (scope + key decisions confirmed by author)
**Builds on:** `2026-06-07-financial-priority-planner-design.md`

## 1. Scope

Features 1–7 from the "Next Features" roadmap:

| # | Feature | Priority |
|---|---------|----------|
| 1 | Edit item (all types) | P0 |
| 2 | Complete / Archive item + history | P0 |
| 3 | Remaining funding needed per item | P0 |
| 4 | Total Future Liability dashboard card | P0 |
| 5 | Funding transactions (replaces manual fundedAmount) | P1 |
| 6 | Reserve recovery time metric | P1 |
| 7 | Projected completion date per item | P1 |

**Deferred:** #8 drag-drop ranking, #9 wishlist aging, #10 wishlist→goal conversion, and all "Future" items.

## 2. Locked decisions

| Topic | Decision |
|-------|----------|
| **Funding** | Transactions-first. New `FundingTransaction` table. `PlanItem.fundedAmount` **column removed**; computed as `SUM(transactions.amount)` in the data layer. Funding is added only via "Add Funding"; the edit form does not expose it. |
| **Completion** | An item is *done* when `status === 'COMPLETED'` (set on any type via a complete endpoint) **or** it is a wishlist item with `purchased === true`. Done items leave the active queue/timeline/dashboard and appear on `/history`. |
| **Edit UI** | Inline (row toggles into a prefilled `ItemForm`), not a modal — reuses the existing form component. |
| **Priority** | Unchanged numeric 1–5. Ranking (#8) deferred. |
| **Liability scope** | Total Future Liability sums `remaining` for active **non-wishlist** items (commitments, goals, experiences). Wishlist is discretionary, not an obligation. |
| **Projection reuse** | Projected completion dates reuse the existing `projectFunding` engine; no second projection model. |

## 3. Data model changes

### New model: FundingTransaction
- `id: String (cuid)`
- `itemId: String` → FK to `PlanItem.id`, `onDelete: Cascade`
- `amount: Float`
- `note: String?`
- `date: DateTime` default now
- `createdAt: DateTime` default now
- relation index on `itemId`

### PlanItem
- **Remove** the `fundedAmount` column.
- Add relation: `fundings FundingTransaction[]`.
- `status` is now meaningful for **all** types (used to mark completion), still nullable.

`Item.fundedAmount` (the TS type) stays — populated by the data layer as the transaction sum.

## 4. Domain logic additions (`lib/finance.ts`, all pure)

- `remaining(item)` = `Math.max(0, item.amount - item.fundedAmount)`.
- `isDone(item)` = `item.status === 'COMPLETED' || (item.type === 'WISHLIST' && item.purchased)`.
- `isActive(item)` = `!isDone(item)`.
- `totalFutureLiability(items)` → `{ total, breakdown: {title, remaining}[] }` over active non-wishlist items with `remaining > 0`, sorted by queue order.
- `reserveRecoveryMonths(profile)` → `number | null`: `surplus > 0 ? reserveDeficit / surplus : null` (raw; UI rounds to 1 dp).
- `projectedCompletion(profile, items, fromDate)` → `Record<id, { monthIndex: number | null; isoDate: string | null; behindMonths: number | null }>`:
  - Runs `projectFunding` over **active** items.
  - `monthIndex` from `completionMonth` (undefined → null = "not on current plan").
  - `isoDate` = `fromDate` + `monthIndex` months (first of that month).
  - `behindMonths` = months the projected date is later than the item's `dueDate` month (0 if on/ahead, null if no dueDate or no projection).

`sortQueue` and `projectFunding` already exclude `COMPLETED`/`purchased`; with derived `fundedAmount` they keep working unchanged.

## 5. API changes

- `POST /api/items/:id/funding` — body `{ amount: number > 0, note?: string }` → creates a transaction; returns the updated item (with recomputed `fundedAmount`).
- `GET /api/items/:id/funding` — returns the item's transactions, newest first.
- `POST /api/items/:id/complete` — sets `status = 'COMPLETED'`. `DELETE` on the same path (or `?restore`) reverts to `PLANNED`. (We expose `POST .../complete` and `POST .../restore`.)
- `POST /api/items` & `PUT /api/items/:id` — **drop `fundedAmount`** from the accepted body (Zod schema). Everything else unchanged.
- `GET /api/items` and data loaders return `fundedAmount` as the computed sum.

Validation: `fundingSchema = { amount: positive, note?: string }`. Item schema loses `fundedAmount`.

## 6. UI changes

- **ItemRow** → becomes an editable client row (`EditableItemRow`): shows Edit + Mark Complete + Delete; displays `Remaining: ₹X` and `Projected: Mon YYYY` (with "⚠ behind by N mo" when applicable). Clicking Edit swaps the row for a prefilled `ItemForm`.
- **ItemForm** → remove the `fundedAmount` input. On non-wishlist it keeps title/type/amount/priority/dueDate/(status for commitments).
- **FundingPanel** (new client component) → "Add Funding" amount + optional note, plus the transaction history list (`Jul 2026 +₹25,000 — note`). Shown on each active commitment/goal/experience row (expandable).
- **Dashboard** → add:
  - *Reserve Recovery Time* on the Opportunity Reserve card: `1.0 months` (or "—" when surplus ≤ 0).
  - *Total Future Liability* card: itemized breakdown + bold total.
- **History page** (`/history`) → table of done items (completed + purchased wishlist) with type, amount, and completion marker. Nav gets a "History" link.
- **Queue/Timeline/Wishlist** → filter to active items only (done items move to history). Wishlist "purchased" already hides the purchase button; purchased items also appear in history.

## 7. Error handling

- Funding with non-positive amount → 400. Funding/complete on missing item → 404.
- Completing an already-completed item is idempotent (200).
- Projected completion with surplus ≤ 0 → `monthIndex: null` and UI shows "Not on current plan".
- Reserve recovery with surplus ≤ 0 → UI shows "—".

## 8. Testing (Vitest, pure functions)

- `remaining`, `isDone`/`isActive`, `totalFutureLiability` (excludes wishlist + done, sums correctly).
- `reserveRecoveryMonths` (positive, zero-surplus → null).
- `projectedCompletion`: month-index → date mapping, behind-target detection, no-dueDate and no-projection cases.
- Aggregation helper for derived `fundedAmount` if extracted as a pure function.

## 9. Migration / seed

- `prisma db push` drops `fundedAmount` and adds the `FundingTransaction` table (dev DB reset acceptable).
- `seed.ts` creates each item without `fundedAmount`, then inserts one `FundingTransaction` (`note: 'Initial allocation'`) per item equal to the previous funded figure, so all views stay populated.

## 10. Out of scope (this iteration)

Drag-drop ranking, wishlist aging display, wishlist→goal conversion, AI, notifications, mobile, auto-allocation, multi-user, multi-currency.
