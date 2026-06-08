# Financial Priority Planner — Iteration 3 Design Spec (P2)

**Date:** 2026-06-07
**Status:** Approved for implementation (decisions confirmed by author)
**Builds on:** iterations 1 and 2.

## 1. Scope

| # | Feature | Notes |
|---|---------|-------|
| 8 | Priority Ranking View (drag-and-drop) | Rank is a manual tiebreaker **within** a priority bucket; influences queue + projections |
| 9 | Wishlist aging ("Added: N days ago") | Per wishlist item |
| 10 | Wishlist → Goal conversion | Convert the same record in place |

**Deferred / not built:** AI, notifications, mobile, auto-allocation, multi-user, multi-currency.

## 2. Locked decisions

| Topic | Decision |
|-------|----------|
| **Rank model** | Add `rank: Int` to `PlanItem`. New sort order everywhere the queue is computed: **priority desc → rank asc → dueDate asc → title asc**. Rank reorders items *within* the same priority; priority remains the primary sort. |
| **Drag tech** | Native HTML5 drag (`draggable`, `onDragStart/Over/Drop`). No new dependencies. |
| **Reorder persistence** | `POST /api/items/reorder { ids: string[] }` assigns `rank = index` across the provided (active, queue-ordered) list. |
| **New item rank** | On create, `rank = (max existing rank) + 1` so new items land at the end. |
| **Convert** | `POST /api/items/:id/convert { amount, dueDate, priority }` flips the **same** record: `type='GOAL'`, sets amount/dueDate/priority, clears `notes`? no — keeps notes; `purchased` stays false. Keeps `id` and all `FundingTransaction`s. |
| **Projection impact** | Because `projectFunding` calls `sortQueue`, the new rank automatically influences projected completion + simulator goal-delays. No separate change. |

## 3. Data model

### PlanItem
- Add `rank Int @default(0)`.
- Everything else unchanged. (`db push` adds the column; reseed assigns ranks.)

`Item` TS type gains `rank: number`.

## 4. Domain logic (`lib/finance.ts`)

- **`sortQueue`** updated: sort by priority desc, then `rank` asc, then dueDate asc (nulls last), then title. Still excludes wishlist.
- **`daysSince(iso, fromIso)`** (new, in `lib/format.ts`): whole days elapsed since `iso`, floored at 0. Used for wishlist aging.
- No other finance changes. `projectFunding`, `simulatePurchase`, etc. consume the updated `sortQueue` automatically.

## 5. API

- `POST /api/items/reorder` — body `{ ids: string[] }`; sets `rank = index` for each id (transaction). Returns `{ ok: true }`. Ignores ids that don't exist.
- `POST /api/items/:id/convert` — body `{ amount: number ≥ 0, dueDate: ISO string, priority: 1–5 }`; 404 if missing, 400 if not currently a wishlist item or validation fails; updates the record to a GOAL. Returns the updated item.
- `POST /api/items` (create) — set `rank` to `(max rank in table) + 1`.
- Validation: `reorderSchema = { ids: string[] (min 1) }`, `convertSchema = { amount ≥ 0, dueDate: datetime, priority: int 1–5 }`.

## 6. UI

- **Ranking View** (`/ranking`, new) — active queue items as draggable rows (native HTML5 drag). Shows type badge, title, P-level. Dragging reorders; on drop, the new id order is POSTed to `/reorder` and the page refreshes. A short hint explains rank only reorders within a priority level. Nav gets a "Ranking" link.
- **Wishlist page** — each row shows **"Added: N days ago"** (from `dateAdded`). Add a **"Convert to Goal"** button that reveals a small inline form (target amount, target date, priority) → calls `/convert`.
- **Queue page** — no UI change; ordering now reflects `rank` via `sortQueue`.

## 7. Error handling

- Reorder with empty/invalid ids → 400. Non-existent ids are skipped silently.
- Convert on a non-wishlist item → 400 with a clear message; missing item → 404; bad/absent dueDate or out-of-range priority → 400.
- Drag with no movement (drop on self) → no network call.

## 8. Testing (Vitest)

- `sortQueue`: rank tiebreak within equal priority; priority still dominates across buckets; dueDate/title fall-through when ranks equal.
- `daysSince`: elapsed days, same-day → 0, future date → 0.

## 9. Seed

- Assign `rank` to each seed item by its array index (already roughly priority-ordered), so within-priority order is deterministic on a fresh DB.

## 10. Out of scope

Cross-priority drag changing an item's priority (priority is edited via the item form, not by dragging); reordering completed items; multi-list boards.
