# Code Review: CAS PDF import (uncommitted working tree)

**Date:** 2026-06-09
**Reviewers:** 12 local Claude agents (deep pack) — security, architect, chief-architect, ops, chief-programmer, devils-advocate, testability, simplifier, user-advocate, api-designer, critic, requirements-analyst
**Scope:** CAS PDF → mutual-fund auto-populate (Python casparser sidecar, reconcile, route, UI, schema)

## Summary

The **privacy/subprocess seam — the feared part — is the strongest part**: password is the first stdin line (never argv/env), PDF stays in-memory, the temp-file fallback unlinks in a `finally`, stderr is swallowed, no PAN/raw-JSON is persisted, failures precede the `$transaction` so they change nothing, and the firewall holds (verified). The pure `reconcile` + adopt=MERGE is correct and well-tested. **But the data-integrity core has two P0s that silently corrupt money on the *second* upload** (the happy path of the feature), plus a one-line crash bug. The feature is well-isolated (manual default, AMFI/Planning untouched), so the runtime/UX gaps are acceptable fast-follows — the silent-corruption gaps are not.

Conformance: every approved spec requirement is **met** except the promised test matrix (item 13 — temp-file-unlink/no-log privacy assertion — and several CasError codes are untested).

---

## P0 — MUST fix before commit (silent money corruption, no user signal)

### P0-1: Re-importing an older/out-of-order statement silently rewinds units, NAV & as-of date
**Consensus:** 4 (devils-advocate, critic, user-advocate, testability) · **`lib/cas/reconcile.ts:25-34,89-123`**
No date guard anywhere. `reconcile` unconditionally overwrites `quantity`/`pricePerUnit`/`priceUpdatedAt` from whatever statement is uploaded. Upload April's CAS after June's (re-importing an old file is routine) → every holding's units roll **backward**, the as-of date regresses, and funds bought after April get wrongly flagged `ABSENT` — all reported as a cheerful "updated N." `parsed.statementDate` is captured but never compared.
**Fix:** pass `statementDate`/per-scheme `navDate` into `reconcile`; only write units/price/date when the incoming date `>=` the row's existing `priceUpdatedAt`; otherwise skip (optionally still set `casStatus`/`importKey`). ~10 lines in the pure fn + a test feeding an older fixture against a newer row.

### P0-2: `importKey = AMFI code alone` ignores folio → same fund in two folios / shared code → overwrite + lost holding
**Consensus:** 3 (chief-programmer, devils-advocate, critic) · **`lib/cas/reconcile.ts:11-14`**
`schemeKey` returns the bare AMFI code. A fund held in **two folios** (very common), or Growth+IDCW variants sharing a code, produce the same `importKey`. First import → two creates with identical `importKey` (the index is non-`@@unique`, so the DB accepts it). Re-import → `byImportKey.set` keeps only the last row, so one folio is updated and the other is orphaned → flagged `ABSENT` forever though still held; units conflate.
**Fix:** fold folio into the key even when AMFI is present: `` `${folio}|${amfi}` `` (folio is already parsed). Keep the `byTicker` adopt path on bare AMFI. Add a "same scheme, two folios" test.

---

## P1 — fix before commit (one is a crash; others small & money-relevant)

### P1-1: Unhandled `child.stdin` EPIPE can crash the Node server
**Consensus:** 5 (security, ops, chief-programmer, devils-advocate, critic) · **`lib/cas/sidecar.ts:91-93`**
The password + up-to-15MB PDF are written to `child.stdin` with **no `error` listener**. If the child exits early (bad password, casparser missing, crash), the pending write emits `EPIPE`; an unhandled stream `error` can take down the worker (DoS), and can also mask the real exit code (→ misleading `PARSE_ERROR`). **Fix (one line):** `child.stdin.on('error', () => {})` before writing; the child `close`/`error` handlers already settle the promise. Trivial — do it now.

### P1-2: Zero-balance / null-NAV / null-units schemes create phantom or zeroed holdings
**Consensus:** 4 (security, chief-programmer, devils-advocate, critic) · **`scripts/cas_parse.py:82-101`, `lib/cas/reconcile.ts:25-34`**
A redeemed scheme appears in a CAS with `close: 0`; a not-yet-priced one has `nav: null`. The Zod schema allows both, so reconcile creates `MUTUAL_FUND` rows with `quantity: 0` (clutter / counts as ₹0) or `quantity` set + `pricePerUnit: null` (phantom ₹0 holding, no NOT_FOUND/stale flag) — violating "never zero a holding." On an **adopt**, a `units: 0` write would zero a real hand-entered holding.
**Fix:** in `cas_parse.py`, skip schemes where units (`close`) is null or `<= 0`; never write a null/zero `quantity` over a non-null one. Add `units:0` and `nav:null` fixtures.

### P1-3: `cost` is read from the wrong casparser key → costBasis likely never populated; casparser dict shape is unverified
**Flagged by:** requirements-analyst · **`scripts/cas_parse.py:99`**
`val.get("cost")` reads cost from the *valuation* block, where casparser does **not** put invested amount (it's scheme/transaction-level). So `s.cost` is probably always `null` and the "cost basis from CAS when available" requirement silently never fires. Worse: **no Python test exists**, and `cas-sample.json` is hand-authored to match this mapping — so the suite can't catch a key mismatch in `statement_period`/`folios[].schemes[].valuation` either.
**Fix:** verify the real casparser keys against the pinned version; extract the dict→schemes mapping into a pure `map_cas(data)` and add `scripts/test_cas_parse.py` (pytest) feeding synthetic casparser-shaped dicts. Align the fixture to the real shape.

---

## P1/P2 — strong findings, acceptable as documented fast-follows (given manual default + firewall)

- **Entire subprocess seam is untested** (testability P1, critic, requirements): `cas-route.test.ts` mocks `runCasParser`, so `sidecar.ts` (stdin framing, exit→CasError map, `BAD_OUTPUT`, ENOENT→PYTHON_MISSING, TIMEOUT+kill) and `cas_parse.py` have **zero** coverage — including the spec's promised privacy assertion (temp-file unlink / no-log). Add `sidecar.test.ts` driving a fake interpreter stub.
- **Non-MF instruments imported as MUTUAL_FUND** (devils-advocate, critic, testability): the parser tags every `folios[].schemes[]` as MF; a consolidated CAS can carry NPS/ETF/SGB. MF-only is enforced on existing rows but **not** incoming. Fix: require `amfi` or an `INF…` ISIN in `cas_parse.py`.
- **Ops blind spots** (ops P1): a *partial* casparser install (import-time error that isn't `ImportError`) falls through to a misleading **422** instead of 501; and **no failure emits any log** (stderr swallowed + `CasError` returned without logging) — an operator can't tell bad-password from broken-venv from timeout. Fix: broaden the Python import catch → exit 4; log `err.code` (PII-free) at the route.
- **cwd-relative script path** (ops P1, chief-architect P2): `process.cwd()`-relative `SCRIPT`/`VENV_PY` break under `next start` from elsewhere / standalone output. Fix: resolve module-relative (`new URL(..., import.meta.url)`); document that CAS import needs a long-lived Node host with Python (unsupported on serverless).
- **`ticker`-less CAS rows never revalue & never flag stale** (chief-architect P1): a folio|name-keyed row has `ticker=null` → `refresh-prices` skips it (`ticker not null`) and the page's stale check only covers `priceSource==='API'` → frozen at the CAS NAV forever, silently. Decide: surface as "won't auto-update" or make CAS rows stale-eligible.
- **Result hides *which* funds were flagged absent** (user-advocate P1, api-designer P1): route returns counts; the names exist in the plan. The most alarming line ("3 not in this CAS") is the one with no detail. Return names; the refresh route already does this with `stale[]`/`notFound[]`.
- **Python/casparser-missing message isn't actionable** for a self-hoster (user-advocate P1): raw "casparser is not installed" with no "run pip install / see docs."

---

## P2 / P3 — polish

- **`as unknown as ExistingAsset[]` cast** (architect, simplifier): replace with a `select` projection — restores type-checking AND stops loading PII-adjacent columns reconcile doesn't need. *(route.ts:50)*
- **Subprocess inherits full env** incl. `DATABASE_URL` (security): pass a minimal `env`. **Unbounded stdout buffer** (security): cap it.
- **`BAD_OUTPUT` → 422 is wrong** (api-designer): it's a server/sidecar fault → 502/500, not a client 422.
- **Dual `source`/`priceSource` with shared `'CAS'` token** + **stale schema comment** (`priceSource // MANUAL | API` omits CAS) (api-designer, chief-architect): update the comment; consider `STATEMENT` for the price value; document the two axes. Centralize derived states (`isCasManaged`, price label) so 3 files don't re-derive `source!=='CAS'` ad hoc.
- **`source='MANUAL'` is never written** (manual rows are `null`) — the `SOURCES` constant advertises a value nothing writes (architect): stamp it or drop it.
- **ABSENT pill uses error-toned `--warning`** and ABSENT rows still count in totals & don't clear on manual edit (user-advocate, critic, devils-advocate): use a calmer tone; decide whether ABSENT is "still held" (then don't alarm) or "likely sold" (then exclude from totals); clear on manual edit.
- **No preview/confirm before mutating the portfolio** (user-advocate, critic): the pure `reconcile` makes a dry-run cheap — return the plan, confirm, then apply. (P0-1 reduces the urgency.)
- **`navDate`/`statementDate` via `new Date(str)` + unvalidated passthrough**: normalize in Python (`date.isoformat()`) and tighten Zod to a date.
- **`requirements.txt` comment says v0.4.3 but pins ≥0.7.0**; **mkstemp 0600 is a default, not explicit** (requirements): reconcile the comment; `os.fchmod(fd, 0o600)` to make the privacy control explicit. **Password-with-newline** truncates silently. **MIT-parser runtime guard**: optionally refuse if PyMuPDF is importable (license invariant currently comment-only). **`CasUpdate.data: Record<string,unknown>`**: type it so the adopt-omits-costBasis guarantee is compiler-enforced.

---

## What's solid (keep)
Privacy/subprocess invocation (stdin password-first-line, in-memory, `finally`-unlink, stderr swallowed, no PII persisted); `reconcile` pure + adopt=MERGE (tests assert `name`/`costBasis` absent from the adopt payload); cost-basis-never-nulled; MF-only scoping (tested); parse-before-transaction fail-safe; timeout SIGKILL with a settled-guard; firewall intact (verified by grep); the 3 new columns + 2 enums are each load-bearing (not over-modeled).

## Recommended path
Land **P0-1 (date guard) + P0-2 (folio-qualified key) + P1-1 (EPIPE one-liner)** before commit — all small, localized edits to already-pure/tested code, closing the silent-corruption + crash paths. **P1-2 (zero/phantom holdings)** and **P1-3 (cost key + a Python mapping test)** are cheap and money-relevant — fold in if doing the P0 pass. Everything else (full sidecar tests, MF-gating, ops logging, names-in-result, UI/preview) is a legitimate documented fast-follow given the manual default and intact AMFI/Planning firewall.
