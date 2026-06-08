# API Route + What-If Recompute Test Coverage — Design Spec

**Date:** 2026-06-08
**Status:** AWAITING APPROVAL — do not implement until approved.
**Why now:** these are the two untested surfaces (ARCHITECTURE.md §7 — "only pure libs tested"); they
must land **before** any price-provider work, since a live feed will start mutating exactly these paths.

## Goal & constraints

Add automated coverage for (1) the **API route handlers** — specifically the `withErrorHandling`
mapping on each route — and (2) the **client What-If recompute path**. Tests + minimal test-only
scaffolding; **no behavior change to app code** except one proposed behavior-preserving refactor
(§2, needs approval). Don't touch/weaken the Planning/Wealth firewall. Never point tests at `dev.db`.
All existing **70** tests + the new ones pass; `npm run build` succeeds.

## 1. Test DB strategy — decision to confirm

**Recommended: mock `@/lib/db` (the Prisma singleton). Tests touch no database at all** — which
satisfies "don't point at the dev db" maximally — and it's the *only* reliable way to force the
specific error classes the goal requires (`P2025`/`P2002`/generic-500). Bad-JSON and Zod failures
happen before/at validation, so they need no DB either.

This deviates from the literal "temp SQLite" suggestion. If you also want genuine DB integration, I'll
add an **optional** temp-SQLite suite (its own file; `DATABASE_URL=file:./.test.db` in a global setup
that runs `prisma db push`, deleted after) covering a couple of real happy-path + real-404 cases.
**Default unless you say otherwise: mock-only (no temp DB).**

## 2. Behavior-preserving refactor (needs approval)

To test the What-If recompute without rendering the React component, **extract the Dashboard's inline
derivation into a pure function** `lib/dashboard.ts`:

```ts
export interface DashboardModel {
  surplus: number; reservePct: number; recovery: number | null;
  liability: ReturnType<typeof totalFutureLiability>;
  topUnfunded: string | null; monthsToFund: number | null;
  sim: SimulationResult | null;
  projection: MonthlyAllocation[];
}
export function deriveDashboardModel(
  profile: Profile, items: Item[], costNum: number, nowIso: string,
): DashboardModel
```

`Dashboard.tsx` then calls `deriveDashboardModel(profile, items, costNum, now)` inside its existing
`useMemo` instead of computing inline. **Identical math, identical order, identical result** — purely a
move. `lib/dashboard.ts` imports only `lib/finance` (Planning) — **firewall clean** (no wealth/market).
The `totalWealth` prop stays a prop (not part of the model). This is the only app-code change.

## 3. Test-only scaffolding

- `lib/__tests__/helpers/req.ts`: `jsonReq(method, body)` → `NextRequest` with a JSON body;
  `badJsonReq(method)` → request whose `.json()` rejects (body `'{'`); `params(obj)` →
  `Promise.resolve(obj)` for `[id]` route context.
- Per route-test file: `vi.mock('@/lib/db', () => ({ prisma: { …spy methods… } }))`; for the simulate
  route, also `vi.mock('@/lib/data')` to return the fixed profile+items. Prisma "known" errors are
  constructed via `new Prisma.PrismaClientKnownRequestError(msg, { code, clientVersion })`.
- `console.error` is spied/silenced (the 500 path logs server-side by design).
- Handlers are imported directly (`@/app/api/...`) and invoked as functions; assert `res.status` and
  `await res.json()`. (Contingency: if `next/server` needs runtime shims under vitest's `node` env,
  add a tiny setup file; flagged, not expected.)

## 4. Route test matrix (mock-prisma)

Legend: badJSON→400, Zod→400, P2025→404, P2002→409, ERR→500 (body **exactly** `{error:'Internal
server error'}`, asserting the thrown message/stack does **not** appear), OK→happy path.

| Route / method | Cases |
|---|---|
| `profile` GET | OK (returns profile); ERR→500 |
| `profile` PUT | badJSON; Zod (negative field); OK (upsert→200); ERR→500 |
| `simulate` POST | badJSON; Zod (cost ≤ 0 / missing); OK→200 **parity:** body `== {name, ...simulatePurchase(profile,items,cost)}` (mock `getProfile`/`getItems`); ERR→500 |
| `items` GET | OK (maps derived `fundedAmount`); ERR→500 |
| `items` POST | badJSON; Zod (missing title; non-wishlist missing dueDate refine); OK→201; **P2002→409** (create throws P2002 — the representative 409 mapping test); ERR→500 |
| `items/[id]` GET | OK; **404** (findUnique → null, handler's explicit 404); ERR→500 |
| `items/[id]` PUT | badJSON; Zod; OK→200; **P2025→404** (update throws P2025); ERR→500 |
| `items/[id]` DELETE | OK→`{ok:true}`; **P2025→404** (delete missing); ERR→500 |
| `items/[id]/funding` POST | badJSON; **404** (item findUnique → null); Zod (amount ≤ 0); OK→201 (recomputed `fundedAmount`); ERR→500 |
| `wealth` GET | OK; ERR→500 |
| `wealth` POST | badJSON; Zod (**refine**: neither qty+price nor value); OK→201 **incl. `costBasis` + `purchaseDate`** (assert both forwarded to `create` and `priceSource='MANUAL'` stamped when price given); ERR→500 |
| `wealth/[id]` PUT | badJSON; Zod; OK→200 **incl. cost-basis fields**; **P2025→404**; ERR→500 |
| `wealth/[id]` DELETE | OK→`{ok:true}`; **P2025→404**; ERR→500 |

Notes: P2002→409 is exercised once (items POST) since no route hits a unique constraint naturally — it
verifies the *mapping*. The explicit `404`s in `items/[id] GET` and `funding POST` are the handlers'
own `findUnique → null` guards (distinct from the P2025 mapping), so both 404 sources are covered.

## 5. What-If recompute test (`lib/__tests__/dashboard.test.ts`)

Fixed fixture: a `Profile` (e.g. reserve 420k/500k, surplus 50k) + a small `items[]` (a goal + a
commitment). `nowIso` fixed.

1. **cost = 0:** `model.sim === null`; `model.projection` deep-equals
   `projectMonthlyAllocation(profile, items, {months:12, fromIso, startReserve: reserveCurrent})`;
   `model.reservePct` from the full reserve.
2. **cost > 0 — same-as-server:** `model.sim` deep-equals `simulatePurchase(profile, items, cost)`
   (the exact value `/api/simulate` returns, sans `name`) → proves client & server use the **same pure
   function and identical numbers**.
3. **reduced-startReserve path:** `model.projection` deep-equals
   `projectMonthlyAllocation(profile, items, {…, startReserve: reserveCurrent − cost})` **and differs**
   from the cost = 0 projection → proves the reduced-reserve recompute (the `runAllocation`
   consolidation invariant) is exercised from the dashboard side.
4. **effective reservePct** uses `reserveCurrent − cost`.

(Optional belt-and-suspenders: the `simulate` route test §4 already asserts the server returns
`simulatePurchase(...)`, so route + dashboard both funnel through one function.)

## 6. Verification

In the isolated copy: `npm test` → report new total (**70 + ~40 new ≈ 110**, exact count in the report)
and `npm run build` clean. Confirm no test imports `dev.db` (mock-only) and the firewall holds
(`lib/dashboard.ts` imports no wealth/market; grep). List changed/new files.

---

**Approval requested on:** (1) **mock-`@/lib/db` as the test DB strategy** (no temp DB) vs. also adding
the optional temp-SQLite integration suite; (2) the **`deriveDashboardModel` extraction** in
`lib/dashboard.ts` (behavior-identical). On approval I implement the scaffolding + the route matrix +
the recompute tests, then report results and the file list.
