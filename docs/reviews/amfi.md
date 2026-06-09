# Code Review: AMFI mutual-fund price provider (uncommitted working tree)

**Date:** 2026-06-09
**Reviewers:** 12 local Claude agents (deep pack) — security, architect, chief-architect, ops, chief-programmer, devils-advocate, testability, simplifier, user-advocate, api-designer, critic, requirements-analyst
**Scope:** uncommitted changes adding an AMFI NAV `PriceProvider` (env-gated, manual default)

## Summary

The design is sound and the headline invariants hold: the **firewall is intact** (verified — `lib/finance.ts` and `lib/wealth.ts` import nothing from `lib/market/`), the **env default is a true no-op**, and **no failure path zeros a price**. But the deep pass found **one genuine money-corruption bug the green suite misses** (empty NAV field → `0` → zeroes a holding) plus near-unanimous consensus on a **mid-loop partial-write hazard** and a **missing fetch timeout**. Your three flagged hotspots: parser robustness is *mostly* solid but has two real holes (#1), the stale boundary is *correct* (#2, verified empirically), and fetch-once atomicity is correct for the feed-failure path but has a residual in-loop gap (#3).

---

## Your three hotspots — verdicts

**#1 Parse vs real feed messiness — MOSTLY ROBUST, TWO HOLES.** Header/section/blank/`N.A.`/junk lines are all correctly dropped (numeric-code regex + `f.length>=6` + `Number.isFinite` + explicit date parse — a genuinely good quadruple-guard). But: (a) an **empty** NAV field `;;` parses to `0` (not `N.A.`), survives `isFinite`, and zeroes the holding — **P1-1**; (b) a scheme **name containing `;`** shifts columns and is read positionally from the left — **P1-5**.

**#2 The 3-business-day boundary — CORRECT (verified by multiple agents).** Exactly 3 business days old = **fresh**; the 4th = stale. **Friday NAV checked Monday = fresh** (1 business day; weekend skipped). All math is UTC-day based, so no DST/off-by-one. This is the strongest-tested part of the change.

**#3 Fetch-once-before-any-write — CORRECT for the feed failure; residual in-loop hazard.** `getQuotes` throws before the loop, so a feed/network/parse failure writes nothing (tested). **But** once the loop starts, each `prisma.update` is its own commit — a mid-loop rejection leaves earlier assets updated, later ones not, and returns a 500 that says "nothing changed." **P1-2**.

---

## P0 — none

No defect breaks normal operation with the manual default. The P1s below matter once `MARKET_DATA_PROVIDER=amfi` is enabled.

## P1 — fix before enabling AMFI

### P1-1: Empty/non-positive NAV parses to `0` and zeroes a holding (money corruption)
**Consensus:** 2 strong (chief-programmer, testability) + reinforced by security/critic
**File:** `lib/market/amfi.ts:47`
AMFI emits an empty NAV field (`...;;14-May-2025`) for not-yet-priced/suspended schemes, alongside `N.A.`. `Number("") === 0`, which is finite, so the row is kept as `{ price: 0 }` → written to `pricePerUnit` → `assetValue = quantity*0 = 0` → `totalWealth` silently understated. This is the one parsed-feed path that violates the money-safety invariant, and the suite only tests `N.A.`, never empty.
**Fix:** `if (!Number.isFinite(price) || price <= 0) continue;` (NAV is always > 0; a dropped row safely becomes NOT_FOUND with last price kept). Add a test row with empty + whitespace NAV.

### P1-2: Mid-loop partial write — non-transactional per-asset updates
**Consensus:** ~9/12 (architect, ops, devils-advocate, testability, critic P1; security, chief-architect, chief-programmer, requirements P2/P3)
**File:** `app/api/wealth/refresh-prices/route.ts:37-59`
If asset #5's `update` rejects (`SQLITE_BUSY`, P2025, connection drop), assets #1-4 are already committed; `withErrorHandling` returns 500 ("nothing changed") while some prices silently changed. Never zeros money (each write is a valid NAV), so it's inconsistency + a lying error, not corruption.
**Fix:** wrap the write loop in `prisma.$transaction(async (tx) => { ... })` (keep the fetch outside it — never hold a txn across an HTTP fetch). Add a test: update resolves for #1, rejects for #2, assert 500 + decide rollback.

### P1-3: No timeout/size cap on the AMFI fetch — a hang bypasses the fail-safe
**Consensus:** 3 strong (security, ops, critic)
**File:** `lib/market/amfi.ts:70`
A clean outage rejects fast (fail-safe works), but a *stalled* connection (accept + no response — common during partial outages the spec itself cites) hangs the request with no upper bound; the user sees a spinner forever, never a "failed." `res.text()` is also unbounded.
**Fix:** `fetch(AMFI_NAV_URL, { signal: AbortSignal.timeout(10_000), headers: {...} })`; optionally cap body size. A timeout rejects → existing throw→500→no-write path, so it preserves money safety for free.

### P1-4: `MARKET_DATA_PROVIDER` not added to `.env`/docs — a committed spec requirement was dropped
**Consensus:** requirements-analyst (conformance table: this is the ONLY unmet spec item)
**File:** `.env` (only `DATABASE_URL`); no `.env.example`
The spec's Env-Flag section explicitly said "add to `.env`/docs as commented/off by default." Without it the feature ships dark — the only trace is the refresh-button message.
**Fix:** add `# MARKET_DATA_PROVIDER=amfi  # live MF NAVs from AMFI; unset = manual` to `.env`/`.env.example`.

---

## P1/P2 — trust & robustness (slightly larger changes)

### P1-5: Scheme name containing `;` shifts columns (positional-from-left parse)
**File:** `lib/market/amfi.ts:43-49` — `f.length < 6` rejects too-few but not too-many fields.
AMFI's real feed uses `-`/`(...)` in names (not `;`), so this is largely defensive — but the fix is cheap and strictly safer: index from the **right** (`date = f.at(-1)`, `nav = f.at(-2)`, `code = f[0]`, name = the middle). Add a semicolon-in-name test.

### P1-6: `parseAmfiDate` accepts impossible/rolled-over dates (e.g. `31-Feb` → 3-Mar; any future year)
**Consensus:** 5/12 (security, chief-programmer, devils-advocate, requirements, critic)
**File:** `lib/market/amfi.ts:23-31`
Guard is only `day 1..31`. `Date.UTC(2025,1,31)` silently rolls to Mar 3 — a *future* date that reads "fresh" forever, defeating the one guard against showing old NAVs as current. Contradicts the function's own "drop, don't guess" docstring.
**Fix:** round-trip verify (`if (d.getUTCDate()!==day || d.getUTCMonth()!==mon) return null;`) and reject absurd years. Tests for `31-Feb`, `00-Jan`, future date.

### P2-7: Truncated-but-nonempty feed → mass false NOT_FOUND
**Consensus:** 2 (devils-advocate, critic)
**File:** `lib/market/amfi.ts:73` guards `map.size === 0` but not a partial feed (AMFI publishes truncated dumps during its daily rebuild). Absent schemes get flagged "scheme code didn't resolve," telling users to fix correct data.
**Fix:** plausibility floor (`if (map.size < 1000) throw`) and/or hedge the badge wording during partial feeds.

### P1-8: Valid-but-wrong scheme code silently fetches the wrong fund (no name confirmation)
**Consensus:** 3 (user-advocate P1, api-designer P1, devils-advocate P2)
**Files:** `lib/market/provider.ts:8-11`, `lib/market/amfi.ts:51`, UI
`Quote` is `{price, asOf}` — `parseNavAll` discards `f[3]` (the scheme name). A typo to a *different valid* code returns a real NAV, `priceStatus: 'OK'`, totals shift, and nothing shows which fund resolved. NOT_FOUND only catches codes that match *nothing*.
**Fix:** add `name?` to `Quote`, populate `f[3].trim()`, echo it back (row tooltip / one-time "Resolved to: <name>" confirmation). Pairs with the form-hint improvement (P3).

---

## P2 — worth doing

- **NOT_FOUND + stale double-pill** (`WealthAssetRow.tsx`): a previously-API asset that goes NOT_FOUND keeps old `priceUpdatedAt`/`priceSource:'API'` and can render *both* amber pills. Suppress `stale` when `priceStatus === 'NOT_FOUND'`. *(user-advocate, devils-advocate, critic, api-designer)*
- **"Refresh failed." is scary + mobile-invisible** (`RefreshPricesButton.tsx:15-18,36`): on the common feed-down case, tell the user "Couldn't reach the NAV feed — your values are unchanged" (true: no writes on 500), and drop the `hidden sm:inline` so mobile users get feedback. Align toast wording with the row badge. *(user-advocate)*
- **`ticker` set but `quantity == null`**: refresh writes `pricePerUnit` but `assetValue` falls back to manual `value`, so the fetched NAV is stored-then-ignored while the row shows both "Manual value" and "NAV as of…". Skip such assets or surface it. *(devils-advocate, testability)*
- **`getQuote` contract incoherence**: interface doc says "or null," but `amfiProvider.getQuote` delegates to a method documented to *throw*. Also `getQuote` doesn't `.trim()` the ticker while `getQuotes` does. Document the throw contract on the interface; trim consistently. *(api-designer, chief-programmer)*
- **Response uses display names, not ids** (`route.ts:61`): `stale[]`/`notFound[]` are `a.name` — two same-named assets are indistinguishable and the client can't link back. Return `{id, name}`. *(api-designer)*
- **Cache under serverless/multi-instance**: module-level cache near-zero hit rate on cold lambdas; multi-instance users see flickering NAV-as-of dates. Spec acknowledged single-instance MVP — fine to ship, but document the deployment assumption (or key the cache by NAV date, which is immutable once published). *(chief-architect, architect, ops)*

---

## P3 — quality / preferences (non-blocking)

- **`lastPrice` is redundant** — written identically to `pricePerUnit` on every refresh, never read. Drop it or give it a distinct meaning (e.g. previous close). *(simplifier, chief-architect, api-designer)*
- **TTL cache & `getQuote`/optional-`getQuotes` machinery** flagged as YAGNI by the simplifier — **NOTE: both were explicitly approved in the spec** (fetch-once + 30-min cache, point 1). Not acting on this without your call; raising it only so the trade-off is on record.
- **Second-provider generalization** (`route.ts:20` hardcodes `type:'MUTUAL_FUND'`; single global provider): adding a stock provider will need route surgery. Consider `provider.assetType` + a provider list when that day comes. *(chief-architect)*
- **BOM/encoding** (`res.text()` assumes UTF-8); **stale boundary is UTC-day not IST-day** (±½ day skew near midnight IST, display-only). Both low-risk; worth a comment. *(devils-advocate, chief-programmer)*
- **Spec prose drift**: spec line ~80 still says not-found "do not touch the asset," but the approved point-3 refinement writes `priceStatus`. Reconcile wording. *(api-designer)*

---

## Your two pre-commit checks — input from the review

1. **Re-run the suite threaded** — your call; the two files that failed earlier did so with `Timeout waiting for worker to respond` (worker-startup), and a single-threaded re-run was 138/138. If they flake *again* threaded, it's worth a look; if green, it was contention.
2. **`package-lock.json`** — the critic verified the diff: it's **entirely the recharts transitive tree** (d3-*, redux, victory-vendor — all pure-JS) left over from the earlier Planning/Recharts work; `package.json` has **no diff**. Grep for `darwin`/`linux`/`os:`/`cpu:`/`@next/swc`/`lightningcss`/`esbuild` in the added lines found **none**. So **no cross-OS binary hazard in this diff** — safe to commit, but it's **scope creep** for an "AMFI provider" commit. Recommend staging it separately (or discarding and letting the recharts commit own it).

---

## What's solid (keep)
- Firewall intact; staleness as a pure shared module; explicit `parseAmfiDate` (never `new Date(string)`); fetch-once-before-write for feed failures; never-zero last-good-price on NOT_FOUND; manual-mode true no-op; `priceStatus` cleared on manual save; honest "NAV as of … · end of day" labelling. Stale-boundary tests (`staleness.test.ts`) are exemplary.
