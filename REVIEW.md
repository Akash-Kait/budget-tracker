# Code Review: Stock EOD price provider via nselib (`feat/stock-eod-nse`)

**Date:** 2026-06-11
**Reviewers:** 12 perspectives (local Claude agents): security, architect, chief-architect, ops, chief-programmer, devils-advocate, testability, simplifier, user-advocate, api-designer, critic, requirements-analyst
**Scope:** working tree on `feat/stock-eod-nse` (0 commits ahead of main; all changes uncommitted) — `lib/market/nse.ts`, `scripts/nse_quote.py`, the refresh-prices route fan-out, provider seam, `priceSource:'NSE'`, UI labels, tests, `requirements.txt`.

## Summary

Architecturally sound and faithful to the shipped AMFI/eCAS patterns. **The three named must-breaks are correctly implemented and (for the pure ones) well-tested:** (a) `ClosePrice` read by exact key — verified by 12/12 perspectives; (b) max(Date) not `iloc[-1]` — verified; (c) feed failure → soft 200 with prices kept, DB-write failure → 500 rollback — verified at the route layer. The Planning↔Wealth firewall holds. No P0 (no shipping data-corruption defect — every failure path fails *safe*).

The findings cluster on the **edges the unit tests don't reach**: the impure sidecar↔provider seam was never run against a real `nselib` (it isn't installed in either verify tree), and the UI/error copy was written for the mutual-fund world and hasn't been generalized to stocks. **4 P1 issues** should be addressed before the feature is enabled in production; the live-verify (spec §9) remains the gate.

---

## Resolution (2026-06-11) — all 4 P1s fixed + live-verify done

- **P1-1 fixed** — `nseProvider.getQuotes` now sets `name` to the resolved NSE symbol; `apply` only writes `tickerName` when the quote carries a name (never nulls an existing one). `lib/market/nse.ts`, `app/api/wealth/refresh-prices/route.ts`.
- **P1-2 fixed + live-verified** — sidecar now does `frame.astype(object).where(frame.notna(), None)` (NaN→None) and `json.dumps(out, allow_nan=False, default=str)` wrapped in a guard that exits `serialize_error` rather than emit invalid JSON or crash. **Live fetch against real nselib 2.5.1** confirmed: 12/12 symbols, exact `ClosePrice` column, `Date` is a `DD-Mon-YYYY` string (not a Timestamp), close is a comma-grouped string, all 12 have `ClosePrice ≠ PrevClose`, and Node `JSON.parse` accepts the output. `scripts/nse_quote.py`.
- **P1-3 fixed** — NOT_FOUND badge + stale tooltip are now source-aware (stock copy drops "scheme code"/"NAV"/"edit to fix it"). `components/wealth/WealthAssetRow.tsx`.
- **P1-4 fixed** — added `scripts/test_nse_quote.py` (8 tests: exit-code contract, partial success, NaN serialize guard) and TS tests for `runSidecar`/`getQuotes` via a faked child process (non-zero exit, malformed JSON, ENOENT, timeout-kill, ISIN mapping, name=symbol) + a missing-`ClosePrice`-column drop test.

Verification: `tsc` clean · vitest **266 passed** (was 259) · Python **8 + 33** passed · `next build` ✓. P2/P3 items below remain as tracked follow-ups.

---

## P0 — MUST FIX (0 issues)

None. The devil's-advocate "P0" (spec text says feed-down → 500 while the code soft-fails) is a **documentation** contradiction, not a code defect — tracked as P2-2. The code's behavior is the correct one.

---

## P1 — SHOULD FIX (4 issues)

### P1-1: NSE refresh silently nulls out the eCAS-provided stock name (`tickerName`)
**Consensus:** 3/12 — **Flagged by:** critic (P1), architect (P2), api-designer (P2)
**File:** `app/api/wealth/refresh-prices/route.ts:61` (+ `lib/market/nse.ts:69-78`)
`nseProvider`'s `Quote` never carries `name` (`pickLatestClose` returns only `{price, asOf}`), yet `apply` writes `tickerName: quote.name ?? null` for **both** domains. So the first `EQUITY_DATA_PROVIDER=nse` refresh overwrites the human-readable name captured at eCAS import (`lib/ecas/reconcile.ts:116,130`) with `null` for all 12 stocks — and the UI's "↳ resolved name" echo (`WealthAssetRow.tsx:69-74`), an explicit honesty safeguard, silently disappears. AMFI is unaffected (it returns a name). Test fixtures mask this (they pass `name:'SBIN'` in the NSE quote, which the real provider never does).
**Fix:** Either only write `tickerName` when the quote carries one — `...(quote.name != null ? { tickerName: quote.name } : {})` — or (better, closes the wrong-mapping-visible gap symmetrically with AMFI) have `pickLatestClose`/`getQuotes` set `name: sym` (the resolved NSE symbol is in hand at `nse.ts:133`). Add a stock fixture with **no** `name` asserting `tickerName` is not nulled.

### P1-2: Sidecar `json.dumps` on raw pandas records — unverified, crash-risk, feature may never work in prod
**Consensus:** 5/12 — **Flagged by:** critic (P1), chief-programmer (P2), ops, requirements (P2), devils-advocate (P3)
**File:** `scripts/nse_quote.py:45,58`
`out` holds raw `frame.to_dict("records")`, then `json.dumps(out)` at line 58 — **outside** the per-symbol try/except (`:43-51`). Two real pandas hazards: (1) missing cells → float `NaN` → `json.dumps` emits literal `NaN`, **invalid JSON** that Node's `JSON.parse` rejects → whole stock domain fails; (2) any `pandas.Timestamp`/`numpy` scalar → `json.dumps` raises `TypeError` → uncaught → non-zero exit → whole batch fails. Critically, **`nselib` is not installed in either verify tree** (CONTEXT §50), so the real shape/dtypes of `price_volume_data(...,period="1M")` — including whether `Date` is a `DD-Mon-YYYY` string or a `Timestamp`, and the exact `ClosePrice` column name — were never exercised end-to-end. The failure mode is honest (loud domain failure, not corruption), but the feature could ship green and never work.
**Fix:** `json.dumps(out, allow_nan=False, default=str)` and wrap so a serialization error maps to a clean `fail(3, ...)`; if `Date` comes back as a Timestamp, coerce (`df["Date"] = df["Date"].astype(str)`). **Run one real `nselib` fetch in `/home/node/bt-verify` before commit** to confirm column names and dtypes match `pickLatestClose`'s assumptions. This is the single biggest untested risk and overlaps the still-outstanding spec §9 live-verify.

### P1-3: NOT_FOUND badge + "stale" tooltip use MF/NAV vocabulary, now misleading for stocks
**Consensus:** 3/12 — **Flagged by:** user-advocate (P1×2), api-designer (P2), chief-architect (P3)
**File:** `components/wealth/WealthAssetRow.tsx:45-52` (badge) and `:92-98` (stale tooltip)
`priceStatus: 'NOT_FOUND'` and the stale pill are now shared by the STOCK/NSE domain, but the copy is hard-wired MF language: the badge says "scheme code didn't resolve" / "wasn't found in the **NAV feed**" / "**Edit the asset to fix it**", and the stale tooltip says "This **NAV** is older … for this **scheme**." A stock has no scheme/NAV, and for an unmapped-ISIN stock the user *cannot* "edit to fix it" (the map is hardcoded in `nse.ts`) — that instruction is actively false. This is the honesty discipline defeated at the copy layer.
**Fix:** Make the copy `type`/`priceSource`-aware, mirroring the source-aware `casStatus` pattern already in the same component (`:53-60`). Stocks: badge "price not refreshed", tooltip "This stock's ISIN isn't mapped to an NSE symbol; the last known price is kept" (no "edit to fix"). Stale tooltip: neutral "This price is older than expected — the feed may not have updated recently" (drop NAV/scheme).

### P1-4: `runSidecar` and `nse_quote.py` have zero tests — must-break (c) is untested at its source
**Consensus:** 2/12 (deep) — **Flagged by:** testability (P1×2), devils-advocate (P1)
**File:** `lib/market/nse.ts:90-123`; `scripts/nse_quote.py` (no `scripts/test_nse_quote.py`)
The route tests mock the provider (`vi.fn().mockRejectedValue`), so they verify the route's *reaction* to a throw — never that `runSidecar` *actually* throws on timeout / non-zero exit / malformed JSON / ENOENT, nor that the Python side exits 3 on total failure (`if symbols and not out`). The exact mechanism that prevents a feed outage from corrupting NOT_FOUND flags is dark; a regression that resolved `{}` instead of throwing would ship green. The Python testing convention already exists here (`test_cas_parse.py`, `test_ecas_parse.py`).
**Fix:** (1) Add `runSidecar` tests with an injected/`vi.mock`'d `spawn`: code-0+valid-JSON resolves; code-3 rejects; non-JSON rejects "invalid output"; `error` ENOENT rejects "Python 3 is not available"; fake-timer timeout rejects + asserts `kill('SIGKILL')` and no double-settle. (2) Add `scripts/test_nse_quote.py` (monkeypatch `price_volume_data`): bad stdin→3, non-list→3, nselib-missing→4, partial success→0 with only good symbol, all-fail→3, empty input `[]`→0+`{}`. (3) Add a provider-level partial-success test for `getQuotes` (some ISINs resolve, some omitted, one unmapped).

---

## P2 — RECOMMENDED (10 issues)

- **P2-1 — Opaque failure: nselib-missing vs NSE-outage indistinguishable; provider errors fully swallowed.** *(ops P1, devils-advocate P2, critic/api-designer/user-advocate P3)* `runSidecar` collapses exit 3 (fetch_error) and 4 (nselib_missing) into one generic `NseError`; `resolve()`'s bare `catch {}` (`route.ts:26`) discards it with no `console.error`, so a one-time setup error and a transient outage and a *code bug* all surface identically as "stocks feed unavailable". **Fix:** give `NseError` a `code`, map exit 4 distinctly, and `console.error('[refresh] <domain> provider failed', err)` server-side (symbols aren't PII). Thread a short reason to the button.
- **P2-2 — Spec contradicts shipped code (LOCKED text now lies).** *(devils-advocate P0, critic/requirements/chief-architect P2)* `docs/…/2026-06-11-stock-eod-price-provider-design.md` §5/§8.2 say feed-down → "route 500", and §3 shows the sidecar emitting `{close,date}`; the code soft-fails per-domain and the sidecar emits raw records (both the *better* designs, per §8's footer). **Fix:** reconcile §5/§8.2 to the fan-out soft-fail behavior and §3 to the raw-records contract before commit, so no one "fixes" the code back.
- **P2-3 — No setup docs for the new dependency.** *(ops P1)* `docs/ARCHITECTURE.md` §8 documents casparser/pdfplumber but never mentions `nselib`, `EQUITY_DATA_PROVIDER=nse`, or the pandas/scipy footprint `scripts/requirements.txt` now pulls. **Fix:** add a stock-EOD subsection mirroring the CAS note.
- **P2-4 — Duplicate, conflicting `pdfplumber` pin.** *(ops P1)* `requirements.txt` adds `pdfplumber>=0.11,<0.12` but `requirements-ecas.txt:4` already has `>=0.11,<1.0` — same venv, divergent upper bounds. **Fix:** drop the pdfplumber line from `requirements.txt` (it belongs to eCAS); keep only the `nselib` addition.
- **P2-5 — MF feed-down silently downgraded 500→200; monitoring blind spot.** *(devils-advocate P1, critic P2)* The previously-shipped AMFI path now returns 200 on feed failure, so `RefreshPricesButton`'s `!res.ok` branch never fires for feed-down and any 5xx-based alerting goes silent. Intended, but **document it** and ensure `failed.length>0` is the machine-readable signal a health check can key on.
- **P2-6 — Mobile users get zero refresh feedback.** *(user-advocate P2)* `RefreshPricesButton.tsx:38` renders the result message `hidden … sm:inline` — on phones the "feed unavailable / N stale / couldn't update" messages never show, hiding exactly the surfaced failures this change exists to communicate. **Fix:** show the message at all breakpoints (stack below the button, or a toast).
- **P2-7 — Sidecar output not validated at the boundary.** *(chief-architect P2)* `nse.ts:114` does `JSON.parse(out) as Record<string, Row[]>` — a bare cast, whereas eCAS/CAS `safeParse` every sidecar return. The only unvalidated subprocess→TS crossing. **Fix:** a small Zod `safeParse`, throwing `NseError('invalid output')` on mismatch (consistent with `BAD_OUTPUT`). (`pickLatestClose` is defensive enough that current failure is benign → P2 not P1.)
- **P2-8 — `failed` mixes display strings into the API contract.** *(api-designer P2)* `failed: ['mutual funds','stocks']` bakes English into the wire response; a client can't programmatically branch on which domain failed. **Fix:** emit an enum (`'mutual_funds' | 'stocks'`) and move the wording to the button.
- **P2-9 — No NSE-side cache or concurrency guard (rate-limit / IP-block risk).** *(security P2-P3, ops P2)* AMFI caches 30 min; NSE re-spawns Python+pandas and re-fetches 12 symbols on every click — the exact behavior NSE rate-limits. **Fix:** add an AMFI-style TTL cache and/or single-flight; one bounded retry on `fetch_error`.
- **P2-10 — `ClosePrice` column-rename → silent feature death, undetected; no missing-column test.** *(devils-advocate P1, testability P2)* If nselib renames `ClosePrice`, every row drops → all 12 stocks go NOT_FOUND with no signal distinguishing schema drift from per-symbol miss; no test feeds a row missing `ClosePrice`. **Fix:** if a symbol returned non-empty rows but zero parseable `ClosePrice`, surface a distinct schema failure (loud). Add a test: row with `PrevClose`/`Close` but no `ClosePrice` → `null`.

---

## P3 — MINOR (cluster)

- **Dead `errors` counter** in `nse_quote.py:38,49,51` — incremented, never read; delete it. *(architect, chief-programmer, simplifier, api-designer)*
- **`parseNseDate`/`MONTHS` duplicate `parseAmfiDate`** near-verbatim — extract to a shared `lib/market/dates.ts` (or `staleness.ts`); the two are already drifting (`(s ?? '')` vs `s`). Safety-critical parser should have one home. *(architect, simplifier, chief-programmer)*
- **Sidecar spawn scaffolding is now the 3rd copy** (cas/ecas/nse) — file a follow-up to extract `spawnJsonSidecar(...)`; don't block (refactor touches CAS/eCAS which "must not be deleted"). *(architect, chief-architect, simplifier)*
- **Equal-date tie in `pickLatestClose`** keeps first-seen (strict `>`) — benign for EOD, document it or break ties deterministically. *(chief-programmer, ops, devils-advocate)*
- **`a.ticker!` non-null assertions** (`route.ts:25,45,46`) rely on a query filter 50 lines away — narrow the type with a guard. *(chief-architect, chief-programmer)*
- **`Resolved.quotes: Map|null` overloads null** (didn't-run vs failed, disambiguated by `failed`) — a discriminated union would be unrepresentable-invalid. *(api-designer)*
- **ISIN→symbol map not validated against reality** — NSE symbols (unlike ISINs) drift on rename/delisting; the test is a tautology. Setting `Quote.name = symbol` (P1-1) + periodic re-validation mitigates. *(devils-advocate, architect)*
- **Staleness uses UTC `now` vs NSE's IST trading day** — possible 1-business-day skew; the 3-day window absorbs it; document or compute in IST. *(devils-advocate)*
- **"Updated X/Y" double-counts a failed domain** — its assets sit in both the denominator and `failed`; exclude failed domains from `checked`. *(user-advocate)*
- **Discoverability copy:** ticker help text is MF-only (a stock needs an *ISIN*, not "SBIN") and the page intro still says "entered manually for now". *(user-advocate)*
- **`prisma/schema.prisma:30-31` comments** omit `CAS | ECAS | NSE`. *(critic)*
- **Unbounded sidecar stdout buffer** + **`python3` PATH fallback** when venv absent — cap the buffer; consider failing loudly instead of falling back to ambient python3. *(security)*

---

## Positive Observations

- **Must-breaks (a) and (b) are correct and sharply tested** — exact-key `ClosePrice` read with an inline trap comment; max-Date via `asOf > best.asOf` over zero-padded ISO strings; fixtures use distinct `PrevClose`/`LastPrice`/`ClosePrice` values and a descending frame so a regression genuinely fails. Verified independently by all 12 perspectives.
- **The pure-core / dumb-bridge split is exactly right** — all price/date interpretation lives in unit-testable TS; the Python sidecar deliberately picks nothing. Better than the spec's proposed `{close,date}` sidecar.
- **Fan-out independence is real, not cosmetic** — fetch outside the `$transaction`, writes inside one transaction; "MF down doesn't 500 or block stocks" and "DB-write failure → 500 rollback" are both locked by tests. `resolve`/`apply` is *good* factoring (a clean generalization of the prior single-domain loop), not over-engineering.
- **Security posture is strong** — argv-form `spawn` (no shell) with symbols delivered via stdin (no injection); a static 12-entry allow-list filters all user input before nselib (no attacker-steered SSRF); stderr swallowed and errors generic (no PII/secret leak).
- **Honesty discipline & firewall intact** — unknown→null→NOT_FOUND (never zeroed), absent surfaced not deleted, stale flagged, feed-down keeps last price; `lib/finance.ts` imports nothing market/wealth/ecas and is untouched. The as-of label deriving from `priceSource` (not type) is the strongest honesty win: an unrefreshed stock honestly shows "· eCAS" until a real NSE refresh flips it to "· NSE close".
- **Date parsing hardened** — explicit month-map + `Date.UTC` round-trip rejects `31-Feb` and locale formats, cloning the proven AMFI guard.
