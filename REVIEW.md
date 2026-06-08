# Code Review: Budget Tracker — application source at HEAD (`f6b4867`)

**Date:** 2026-06-07
**Reviewers:** 7 perspectives (local Claude agents): security, architecture, ops, code-quality, devils-advocate, testability, requirements
**Scope:** `lib/`, `app/`, `components/`, `prisma/` at HEAD (master); docs/specs cross-referenced. No AWS/Bedrock (local mode).

## Summary

The architecture is genuinely strong: `lib/finance.ts` is pure and deterministic, `fundedAmount` is correctly derived from an append-only transaction ledger, validation is centralized in Zod, and the client what-if reuses the *same* pure functions as the server. There are **no P0s for the documented single-user local MVP** and no SQL injection (Prisma parameterizes everything). The findings cluster in three themes: (1) **the core "should I buy this?" verdict can be wrong or under-warned** — the half-built due-date/`underfunded` path never reaches the screen or the recommendation; (2) **float-money accumulation** can produce visibly wrong projected dates; (3) **no error handling in any API route** — fine for one local user, a hardening must-do before any deploy. Most issues are cheap to fix now and several are documentation/consistency gaps rather than code bugs.

---

## P1 — SHOULD FIX

### P1-1: The simulator never warns when a purchase pushes a *commitment/experience* past its due date
**Consensus:** 4/7 · **Flagged by:** requirements-analyst, devils-advocate, chief-programmer, (security noted integrity)
**Files:** `lib/finance.ts:132-159` (`goalImpacts` is GOAL-only; recommendation), `app/simulator/page.tsx:8-18,98-111`, `components/dashboard/WhatIfBar.tsx`
The spec's recommendation rule is "WAIT if … OR any commitment/experience pushed past its due date," and the brief promised showing where a purchase "leaves Wedding underfunded." But `goalImpacts` filters `type === 'GOAL'` only, the WAIT condition is `reserveAfter < 0 || goalImpacts.some(delayMonths > 0)` (no due-date clause), and the `underfunded` array that *is* computed (`finance.ts:147-152`, returned at `:169`) is **never rendered or used** — the simulator's `SimResult` interface omits it entirely. **Why it matters:** the app can show green "Safe to buy" while the purchase causes a dated commitment (Laptop due Jul, Wedding due Aug in the seed) to slip — the exact harm the simulator exists to prevent; and the SAFE copy literally says "No impact on funded commitments" without having checked. **Fix:** broaden delay detection to all dated non-wishlist items (or wire `underfunded` into the verdict: `|| underfunded.length > 0`), surface it in both the simulator page and the What-If banner, and correct `buildMessage`.

### P1-2: Float-money accumulation across the 120-month projection drifts; equality checks miss
**Consensus:** 2/7 · **Flagged by:** chief-programmer, testability
**Files:** `lib/finance.ts:84-87` (projectFunding), `:225-237` (projectMonthlyAllocation), `funding/route.ts:25`
Money is `Float` and the engine does repeated `funded[id] += add` over up to 120 iterations. Accumulation can land at `99999.9999…` so `funded >= amount` fails by an epsilon — the item never registers complete that month, pushing `completionMonth` out and flipping a goal "on track" → "behind" in `EditableItemRow`. Because the projection feeds the recommendation, this is load-bearing. **Fix:** round each accumulation to whole rupees/paise (`Math.round((x)*100)/100`) in both engines and the reserve refill, or (better, larger) store money as integer paise.

### P1-3: No error handling in any API route — unhandled `req.json()` / Prisma throws
**Consensus:** 3/7 · **Flagged by:** ops (rated P0 for deploy), security, architect
**Files:** every `app/api/**/route.ts` — e.g. `items/route.ts:21`, `[id]/route.ts:19,37`, `profile/route.ts:18`, `funding/route.ts:18`, `reorder/route.ts:6`, `simulate/route.ts:7`
Zero `try/catch` across the API layer. A malformed/empty body throws on `await req.json()` *before* Zod runs → uncaught 500 (with a **stack trace in dev**) instead of a 400. `DELETE`/`PUT /api/items/[id]` on a nonexistent id throws Prisma `P2025` → 500 instead of 404 (a real current bug; `complete`/`restore`/`purchase`/`convert` correctly `findUnique` first, but these two skip it). **Why it matters:** uncontrolled 500s, info leakage in dev, and a trivial malformed-input failure. Acceptable for one local user; a must before any deploy. **Fix:** a shared `withErrorHandling` wrapper mapping `P2025`→404, `P2002`→409, JSON-parse/Zod→400, else→`500 {error:'internal'}` + server-side `console.error`; guard `req.json()` with `.catch(()=>null)`.

### P1-4: Recommendation model can mislead — strict reserve-first fabricates delays; thresholds arbitrary; ignores resulting reserve health
**Consensus:** 2/7 · **Flagged by:** devils-advocate (P1), chief-programmer (P1)
**Files:** `lib/finance.ts:67-73` (refill-before-any-goal), `:119` (`reductionPct` denominator), `:154-159` (thresholds)
Because every rupee refills the reserve to target before funding any goal, almost any purchase that dips the reserve below target delays *every* goal → trips `WAIT` with no gradation (a ₹1 over-target dip and a reserve-negative purchase both say WAIT). `reductionPct` is measured against *current* reserve (so the CAUTION>10% band depends on how depleted you already are, not purchase size) and returns a fabricated `100` when reserve is 0. Thresholds (`>10`, `delay≥1`) are unstated magic numbers; a series of individually-"SAFE" purchases can drain a full reserve to near-empty. **Why it matters:** confident but misleading advice on exactly the big decisions the app is for. **Fix:** distinguish "delay caused only by reserve-refill ordering" (→ CAUTION) from "delay that pushes an item past its due date" (→ WAIT); anchor the verdict to *resulting* reserve health (`reserveAfter/reserveTarget`); surface the thresholds in the UI. (Product decision — document whichever way you choose.)

---

## P2 — RECOMMENDED

### P2-1: `reserveCurrent` is never updated by real actions — the model's anchor goes stale; manual-maintenance assumption is unstated
**Consensus:** 2/7 · **Flagged by:** devils-advocate, requirements-analyst
**Files:** `app/api/items/[id]/purchase/route.ts:21` (only sets `purchased`), funding/complete routes; `reserveCurrent` written only by `ProfileForm`
Marking a wishlist item purchased, adding funding, or completing an item never touches the reserve, yet the simulator's whole premise is "purchases come out of the reserve." A user who buys the ₹50k home theater sees the reserve stay flat, and the next simulation advises on money that's gone. **Fix:** either decrement the reserve on real purchase/funding, or state plainly (spec + a UI note) that the reserve is user-maintained.

### P2-2: `protectedCapital` is collected, seeded, and editable but used in zero decisions (and dropped from the new dashboard)
**Consensus:** 2/7 · **Flagged by:** devils-advocate, requirements-analyst
**Files:** `lib/types.ts:8`, `prisma/schema.prisma:12`, `prisma/seed.ts:34`; absent from `lib/finance.ts` and `KpiCards.tsx`
Defined as "money that should not be spent," implying a guardrail, but no logic enforces it and it's no longer displayed after the iteration-4 consolidation. **Fix:** either wire it in (WAIT/warn when a purchase would force dipping below protected capital) or explicitly mark it informational and restore/ remove it.

### P2-3: Two near-duplicate projection engines that can drift
**Consensus:** 3/7 · **Flagged by:** chief-programmer, testability, architect
**Files:** `lib/finance.ts:46-94` (`projectFunding`) vs `:202-242` (`projectMonthlyAllocation`)
Both implement the reserve-first/priority allocation rule independently; they already differ in completed-item handling. The dashboard chart and the queue's projected dates must tell one story but are maintained separately. **Fix:** extract a single `stepMonth(...)` the two thin wrappers drive; add a consistency test asserting they agree on which item funds in which month.

### P2-4: Data-access logic duplicated out of `lib/data.ts` into route handlers; `GET /api/items` returns a different shape than the `Item` DTO
**Consensus:** 1/7 (rated P1 by architect) · **Flagged by:** architect
**Files:** `app/api/items/route.ts:8-16`, `[id]/route.ts:7-10`, `funding/route.ts:24-25` vs `lib/data.ts:21-35`
The `fundings.reduce(...)` + row→DTO mapping is copied 3–4 places; the GET route spreads the raw Prisma row (`Date` `dueDate`, `createdAt/updatedAt`) instead of the normalized ISO-string `Item`. This is also the multi-user migration choke point (owner-scoping becomes a one-file change if reads funnel through `lib/data.ts`). **Fix:** make `lib/data.ts` the only reader; export `getItem(id)` + a single `toItem(row)` mapper; thin the routes.

### P2-5: Cooling-period rule lives in a route handler, duplicated in the wishlist page, and is untestable
**Consensus:** 2/7 · **Flagged by:** architect, testability (rated P0 for the untested safety gate)
**Files:** `app/api/items/[id]/purchase/route.ts:11-20`, `app/wishlist/page.tsx:13-19`
The anti-impulse-buy gate computes `new Date()` inline (non-deterministic, zero tests) and the expiry math is re-implemented for display — they can drift ("0 days left, buy now" vs API reject). **Fix:** extract `coolingDaysRemaining(dateAddedIso, days, nowIso)` (pure) into `lib/`, call from both, and unit-test the boundaries (exactly-expiry, 0-day, month rollover).

### P2-6: `reorder` silently no-ops on stale/unknown ids → partial, corrupt rank ordering with `ok:true`
**Consensus:** 3/7 · **Flagged by:** ops (P1), architect, testability (P0)
**Files:** `app/api/items/reorder/route.ts:9-13`
`updateMany({where:{id}})` updates zero rows for a missing id and still resolves success; a stale client list yields duplicate/gapped ranks that `sortQueue` then tie-breaks silently. **Fix:** validate the submitted id set equals the current active set (count match) inside the `$transaction`, or use `update` (throws on missing) so a stale request fails loudly and the client refetches.

### P2-7: Dashboard what-if updates the gauge/recovery/projection but the KPI cards stay on actuals — no indication which is hypothetical
**Consensus:** 1/7 · **Flagged by:** chief-programmer
**Files:** `components/dashboard/Dashboard.tsx:30-52`
`reservePct`/`recovery`/projection use `effProfile` (post-purchase) while `liability`/`surplus`/`m2f`/`topUnfunded` use the real profile. When a what-if is active, the gauge silently shows the hypothetical while adjacent cards show reality. **Fix:** apply the what-if consistently to all derived figures, or visually mark which tiles are simulated.

### P2-8: `delayMonths = 999` magic sentinel renders to the user as "delayed 999 months"
**Consensus:** 3/7 · **Flagged by:** chief-programmer, devils-advocate, requirements-analyst
**Files:** `lib/finance.ts:137-142`, `app/simulator/page.tsx:103`
A goal pushed past the 120-month horizon shows literal "999 months." **Fix:** model it explicitly (`nowUnfundable: boolean` or `newMonth===null`) and render "beyond 10-year horizon."

### P2-9: Over-funding is uncapped and silently vanishes
**Consensus:** 2/7 · **Flagged by:** devils-advocate, chief-programmer
**Files:** `lib/validation.ts:29-31` (funding), `lib/finance.ts:176` (`remaining` floors at 0), `EditableItemRow.tsx:28` (pct can exceed 100)
Funding past target is allowed; the overflow disappears from liability/projections and the progress bar overflows. **Fix:** warn/block funding beyond target (or carry overflow visibly); clamp displayed pct to 100.

### P2-10: Unbounded text inputs and `reorder.ids` have no max; missing input ceilings
**Consensus:** 2/7 · **Flagged by:** security, ops
**Files:** `lib/validation.ts:16,21,31,45` (`title`/`notes`/`note`/`name` no `.max()`), `reorder` `ids` no `.max()`
Multi-MB strings → storage bloat; an unbounded `ids` array → a giant `$transaction`. No XSS today (React escapes; no `dangerouslySetInnerHTML`) but it's a stored-payload sink. **Fix:** add `.max()` bounds (title ~200, notes/note ~2000, ids ~500).

### P2-11: `GET /api/items?type=` is unvalidated input passed straight into the Prisma `where`
**Consensus:** 1/7 · **Flagged by:** security
**Files:** `app/api/items/route.ts:6-8`
Not SQL injection (Prisma parameterizes), but an unvalidated trust-boundary value reaching the query filter; a bad precedent that becomes object-injection if the `where` is later extended. **Fix:** validate `type` against `ITEM_TYPES`, else 400.

### P2-12: `convert` has weak state guards — can resurrect a purchased item, doesn't re-anchor the cooling clock, hardcodes GOAL
**Consensus:** 2/7 · **Flagged by:** security, devils-advocate (architect noted hardcoded target)
**Files:** `app/api/items/[id]/convert/route.ts:9-24`
Only checks `type === 'WISHLIST'`; a `purchased:true` wishlist item can be converted back to an active GOAL (`purchased:false`), and existing `FundingTransaction`s may now exceed the new `amount`. **Fix:** reject conversion of purchased items (409), decide funding/cooling handling explicitly.

### P2-13: Test coverage gaps on the highest-risk surfaces
**Consensus:** 1/7 (testability, thorough) · **Flagged by:** testability-reviewer
**Files:** all `app/api/**` (no handler tests), `Dashboard.tsx` (untested recompute), `lib/__tests__/finance.test.ts` (edge gaps)
Missing: API handler tests (validation/404/400/422 branches), the client what-if derivation, and finance edges — negative surplus, zero/already-funded targets, the exact 120-month horizon boundary, the `999` sentinel, `reductionPct` on a zero reserve, and full sort ties. **Fix:** extract `coolingDaysRemaining` + a `deriveDashboardModel` pure fn and unit-test them; add mocked-Prisma handler tests + a small temp-SQLite suite for reorder atomicity; backfill the listed finance edges.

### P2-14: Deploy/data-safety hardening — `db push` (no migrations/rollback) and a destructive seed
**Consensus:** 1/7 · **Flagged by:** ops
**Files:** `package.json:11,14-16`, `prisma/seed.ts:31-32`
`prisma db push` has no migration history or rollback; the seed unconditionally `deleteMany()`s with no `NODE_ENV` guard, and the `package.json#prisma.seed` hook can auto-trigger it. Irrelevant to the current local MVP, real before any shared/prod DB. **Fix:** move to `prisma migrate` and guard the seed (`if (NODE_ENV==='production' && !ALLOW_SEED) throw`). (`--accept-data-loss` is correctly absent from scripts — good.)

---

## P3 — MINOR

- **P3-1 IDOR/no authorization on `[id]` routes** (security) — acceptable per the documented single-user scope; will be P0 the moment multi-user lands. Track it: add `ownerId` and scope every `where` when auth arrives.
- **P3-2 No observability / health endpoint** (ops) — no request/error logging beyond seed, no `/api/health`. Add structured `console.error` in the error wrapper and a DB-ping health route before deploy.
- **P3-3 SQLite single-writer + dev singleton** won't survive multi-instance/serverless deploy (ops) — document the single-instance/persistent-disk constraint; Postgres if it must scale.
- **P3-4 README troubleshooting is macOS-only** (ops) — the Prisma-TLS fix uses `security`/`.dylib`; add the Linux equivalent (`NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt`) and a checked-in `.env.example`.
- **P3-5 `sortQueue` docstring is stale** (chief-programmer) — omits the `rank` tiebreak it actually applies; update to "priority desc, rank asc, dueDate asc (nulls last), title asc."
- **P3-6 `fundingProgress` pct duplicated** in `EditableItemRow.tsx:28` and can exceed 100 (chief-programmer) — call `fundingProgress` and clamp.
- **P3-7 `amount: z.number().min(0)`** lets non-wishlist items have amount 0, which the projection treats as instantly complete (chief-programmer, testability) — consider `.positive()` for dated types; `convertSchema` likewise allows amount 0 / past dueDate.
- **P3-8 `daysUntil` (ceil) vs `daysSince` (floor) + locale split** (chief-programmer, architect) — fine for UTC-midnight data today; normalize to avoid off-by-one if non-midnight/local times ever appear. `formatINR` hardcodes `en-IN` while `formatMonth`/projection hardcode `en-US`; centralize locale for future multi-currency.
- **P3-9 `daysUntil`/`daysSince` live in `lib/format.ts`** (a presentation module) but are domain date math used by a business decision (architect) — move to the domain lib; keep `format.ts` purely presentational.

---

## Positive Observations

- **`lib/finance.ts` is genuinely pure** — no DB/React/`next` imports, dates injected via params, horizon-capped to guarantee termination. This is *why* the client what-if can call the identical `simulatePurchase` the server uses, and why 39 deterministic tests exist. Unanimously praised.
- **`fundedAmount` derived from an append-only `FundingTransaction` ledger** — single source of truth, no update-anomaly, recomputed consistently in every read path.
- **No raw SQL anywhere** — all access via Prisma's parameterized builder; SQL injection is structurally prevented. Mass-assignment blocked by explicit field whitelisting on writes; Zod at every mutating boundary.
- **State-change routes existence-check before mutating** (`complete`/`restore`/`purchase`/`convert`/`funding` → clean 404), cooling period enforced server-side, `onDelete: Cascade` on fundings, `force-dynamic` on all DB-backed pages (no stale financials).
- **Specs are exemplary** — locked-decision tables resolve ambiguities up front and flag them as changeable; the "no second projection model" decision is faithfully honored so rank changes propagate automatically; the iteration-2 column→ledger migration was well planned. Above-average troubleshooting docs for real, non-obvious failure modes.

---

### Suggested fix order
1. **P1-1** (surface `underfunded` + WAIT on past-due commitment) — closes the biggest wrong-answer gap; the logic is ~80% built.
2. **P1-2** (round the money math) — small change, removes visibly-wrong projected dates.
3. **P1-3** (shared API error wrapper + JSON-parse guard) — one helper fixes the whole 500/leak class.
4. **P1-4 / P2-1 / P2-2** (recommendation gradation, reserve-staleness note, protectedCapital role) — mostly product decisions; even *documenting* them closes most of the trust gap.
5. The P2 refactors (consolidate engines/data layer, extract cooling, reorder atomicity) and the test backfill.
