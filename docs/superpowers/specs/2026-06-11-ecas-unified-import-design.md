# Unified eCAS Import — one upload → one preview → one atomic confirm — Design Spec

**Date:** 2026-06-11
**Status:** AWAITING APPROVAL — spec only, no code yet.
**Branch:** `feat/ecas-unified-import` (off `main` @ `41d0236`, which has the merged stock + MF importers).

---

## 1. Goal (Reading A — orchestration/UI unification, NOT an engine merge)

One eCAS PDF upload → **one parse** → fan out to the **existing, unchanged** reconcile engines →
**one combined preview** (zero writes) → **one atomic confirm** (all-or-nothing). The user uploads the
PDF once and approves once. `stock-reconcile` (`lib/ecas/reconcile.ts`) and `mf-reconcile`
(`lib/ecas/mf-reconcile.ts`) stay **separate and untouched** — the unified flow *calls* them; it does
not reimplement or merge them.

This is the generalized home for the two high-value guards (§4) and the cure for the "owned by
nobody" class of bug: a single denominator (the parse) that must fully account for every row, and a
single transaction that makes a half-applied import impossible.

## 2. What exists today (the reality this refreshes against)

- **Two sidecar modes** in `scripts/ecas_parse.py`: `stocks` (equity holding statement → `EcasParsed`:
  INE equity per BO ID, INF skipped, unrecognized surfaced, equity stated total) and `mf` (folio table
  + demat-held INF rows → `MfParsed`: folio MF w/ cost basis, demat MF value-only, folio Grand Total,
  discrete demat-MF total).
- **Two routes**: `POST /api/wealth/import-ecas` (stock, single-phase) and
  `POST /api/wealth/import-ecas-mf` (MF, two-phase preview→confirm, stateless re-parse).
- **Two pure engines**: `reconcile()` (stock) and `planMfImport()` (MF) — both create/update/
  flag-absent-never-delete, idempotent, older-statement-guarded (`statementDate`), with coverage.
- **Display** is value-framed: per-type treemaps, value-only hero, type-aware `displayName`
  (`shortHoldingName` for stocks, `cleanMfName` for MFs). The unified import does **not** change
  display, but its preview shows holdings via the same `displayName` convention for consistency.

## 3. What changed since the originally-queued unified spec

- **MF now comes from TWO eCAS sections**, so a single parse produces **THREE** row sets fanning to
  **three destinations** (two of which share one engine):

  | Parsed rows | Destination | Engine | Basis? |
  |---|---|---|---|
  | equity (INE) holdings | stock-reconcile | `reconcile()` | no |
  | folio MF rows (page 9) | MF-reconcile | `planMfImport()` | yes (Cumulative Invested) |
  | demat-held INF rows (holding stmt) | MF-reconcile | `planMfImport()` | no (value-only) |
  | unrecognized (neither valid INE nor INF) | surfaced, **not** imported | — | — |

- **Coverage is now multi-part**: equity stated total (stock) **and** total-MF = folio Grand Total +
  discrete demat-MF total, **overlap-consistent** (MF). The unified confirm runs **all** of them.

## 4. Core requirements — the two high-value guards (central to this phase)

### 4.1 ROW-ACCOUNTING BALANCE (structural; the generalized "owned by nobody" fix)
Every parsed holding row must land in **exactly one** destination. The orchestrator asserts:

```
parsed_holding_rows
  == equity_imported + folio_mf_imported + demat_mf_imported + explicitly_skipped + unrecognized
```

- `parsed_holding_rows` = the count of **distinct** locator-matched holding rows the parser recognized
  (after the existing per-key dedup of multi-row holdings — pending/settlement collapse). The parser
  emits this denominator AND tags each holding with its class, so the buckets are computed from one
  source of truth, not re-derived downstream.
- `explicitly_skipped` = rows the parser intentionally dropped with a recorded reason (e.g. a
  zero-value settlement artifact collapsed into its holding) — counted, never silent.
- If the equation does not balance, a row fell through a gap → **BLOCK** the whole import with a
  visible error naming the discrepancy (count + any orphan ISINs). Covers all three destinations.
- **Must-break test:** feed a parsed row of an unexpected class (e.g. a valid ISIN that's neither INE
  nor INF, or an INF row from neither the folio nor a holding table) → it lands in `unrecognized` (or
  fails the balance) and is **surfaced loudly**, never silently dropped or double-counted.

### 4.2 ATOMIC CONFIRM (the new failure mode unification introduces)
The single confirm applies **stocks + folio MFs + demat MFs together in ONE `prisma.$transaction`** —
all-or-nothing. The engines produce **pure plans** (no writes); the orchestrator applies *all* writes
(stock creates/updates, MF creates/matched, both domains' flag-absents) inside one transaction. Any
failure in any sub-part → the whole transaction rolls back → **nothing is committed for any part**. A
half-applied combined import must be impossible.

**Hardening 1 — guards BEFORE the transaction (validate, then write).** Compute *all* plans, then run
*every* guard (row-accounting balance + every coverage check + both older-statement guards) against the
plans. **Only if every guard passes** is the `$transaction` opened. The transaction exists for
**write-atomicity ONLY**, never to catch a validation failure. "We decided not to import" (guard
failure → blocked, **zero writes attempted**, no transaction opened) stays cleanly separate from "a
write failed" (transaction rollback). A coverage shortfall must never be discovered mid-write.

**Hardening 2 — ONE transaction spanning BOTH domains via a shared `tx` handle.** The stock writes AND
both MF write paths must execute through the **same** Prisma interactive-transaction client (`tx`) —
not two sequential `$transaction` calls (which would re-admit partial success: stocks commit, MF
fails, stocks persist). The orchestrator's apply takes the single `tx` and drives every write through
it. Engines stay pure (they return plans); only the unified route's apply loop touches `tx`.

- **Must-break tests:** induce a write failure specifically in the **SECOND** domain's apply (e.g.
  stock writes succeed, then a MF write throws) → assert the **FIRST** domain's writes **rolled back**
  (zero rows for any part) — this only passes if both share one `tx`. Repeat inducing the failure in
  each sub-part (stock / folio-MF / demat-MF). Route returns a clean error (no PII leak).

## 5. Coverage gating (all checks fire independently; all must pass to confirm)
- **Equity:** sum of imported equity value vs the statement's stated Equity total (the stock route's
  existing completeness check — lifted to a pure value the orchestrator can read).
- **Total-MF:** folio-parsed vs folio Grand Total, demat-parsed vs the discrete demat-MF total, and the
  stored total vs `folio + demat − overlap` (the existing `MfPlan.coverage`/`coverageBlocking`).
- A shortfall in **any** class blocks the **whole** confirm (one bad class can't ride in on another's
  green). All run at **statement/preview time on statement valuations** — never against post-AMFI-
  refresh values.
- Older-statement guard: the unified flow runs **both** domains' guards (equity + MF `statementDate`),
  blocking if the uploaded statement is older than the newest already-imported of either domain.

## 6. Architecture

```
                       ┌─────────────────────────────────────────────┐
  one PDF + password → │  sidecar: ecas_parse.py  --mode unified      │  (one pdfplumber open,
                       │  → { equity[], folioMf[], dematMf[],         │   composing existing pure
                       │      unrecognized[], skipped[], totals,      │   helpers — no reimplement)
                       │      statementDate, rowCounts }              │
                       └───────────────┬─────────────────────────────┘
                                       │  one parse, three row sets
        ┌──────────────────────────────┼───────────────────────────────┐
        ▼                              ▼                                ▼
   EcasParsed (equity)        MfParsed (folio + demat)        row-accounting + coverage
        │                              │                       (orchestrator-level)
   reconcile()  ─────────────►  planMfImport()  ──────────►   combined plan
   (unchanged)                  (unchanged)                          │
                                                                     ▼
                                              ONE preview (zero writes)  ── confirm? ──► ONE $transaction
```

- **Single parse:** a new `unified` sidecar mode does one `pdfplumber.open` and buckets every holding
  row via the existing classifiers (`classify_isin`, `is_folio_table`, `is_demat_holding_table`,
  `parse_holding_row`, `parse_mf_row`) — composition, not reimplementation. Emits the three row sets in
  the shapes the existing engines already consume (`EcasParsed`, `MfParsed`), plus the row-accounting
  counts + all stated totals + statement date. *(Alternative considered: call both existing modes as
  two subprocesses on the same in-memory PDF — simpler but two parses and two denominators; rejected in
  favour of one parse / one denominator for the balance guard. Flag if you prefer the two-call form.)*
- **One route:** `POST /api/wealth/import-ecas` becomes the unified entry (two-phase: `confirm` flag),
  OR a new `POST /api/wealth/import-ecas-unified`. *(Decision to confirm — see §10.)* It parses, fans
  out to both engines (pure), runs the balance + all coverage + both older-guards, returns the combined
  preview; on `confirm` it re-parses, re-checks every gate server-side, and applies all writes in one
  `$transaction`.
- **Engines unchanged.** `reconcile()` and `planMfImport()` are called as-is. No engine merge.

## 7. UI
- A **single "Import from eCAS" panel** (two-phase preview → confirm). Preview shows three groups —
  **Stocks**, **Mutual Funds (folio, with gain/loss)**, **Mutual Funds (demat, value-only)** — each
  holding by `displayName`, plus every coverage result, the row-accounting summary, unmatched/blocking
  items, cost-basis discrepancies, and flagged-absent. Confirm is disabled while anything blocks; the
  server re-checks regardless.
- Old per-domain panels (`EcasImportPanel`, `EcasMfImportPanel`) and their routes: **code kept**,
  **unmounted** as entry points. Single entry only.

## 8. Invariants carried over (unchanged)
- PDF + password server-side only, in-memory, password via stdin (mode via argv), never logged, never
  returned to client, never persisted/committed; sidecar emits only needed fields (no PAN/transactions).
- Planning↔Wealth firewall intact (`lib/finance.ts` imports nothing here).
- Honest labeling: never stale-as-current; unknown ≠ zero; absent surfaced not deleted; parse failures
  visible. Reconcile discipline (idempotent, create/update/flag-absent-never-delete) unchanged.

## 9. Deep-review named must-breaks
1. **Row-accounting balance across all three destinations** — no row silently lost or double-counted;
   an unexpected-class row fails loudly.
2. **Atomic-confirm rollback on each sub-part's failure** — a failure in stock / folio-MF / demat-MF
   apply commits nothing for any part.
3. **All coverage checks fire independently** — equity, folio, demat, overlap-consistency each gate the
   combined confirm; one class's shortfall blocks the whole import.

## 10. Decisions to confirm before implementation
1. **One unified sidecar mode** (one parse, recommended) vs calling the two existing modes as two
   subprocesses on the same PDF.
2. **Route**: repurpose `POST /api/wealth/import-ecas` as the unified two-phase entry, or add a new
   `…/import-ecas-unified` and retire the two old routes from the UI. (Recommend: new unified route;
   keep old route code, unmount.)
3. **Equity coverage**: lift the stock route's imported-vs-stated-equity check into a small pure helper
   the orchestrator can call (so both old + unified paths share it), vs compute inline in the
   orchestrator. (Recommend: small shared helper.)

## 11. Test plan
- Pure orchestration unit tests (mock engines or feed fixtures): row-accounting balance passes on a
  clean 3-destination fixture; **fails loudly** on an unexpected-class row; coverage gating blocks when
  any class is short; both older-guards fire.
- Atomic-confirm tests (mock prisma `$transaction` + per-entity `create/update` like
  `routes-unit.test.ts`): induce a failure in each sub-part → assert `$transaction` used, no writes
  survive, 500 with no PII leak.
- Parser tests for the `unified` mode against the real fixtures (12 equity-statement rows incl. 4 demat
  INF, page-9 folio rows, unrecognized) → correct three-way bucketing + counts + totals.
- Full suite stays green; build clean.

## 12. Live-verify acceptance
One upload of the real eCAS → **one preview** shows **12 stocks + 9 MFs (5 folio with basis, 4 demat
value-only)**, every coverage check green, row-accounting balanced → **one confirm** → dashboard matches
(treemaps, value-only hero, all 21 holdings; folio MFs show gain/loss, demat MFs "— not set"). Then
deep review (the three must-breaks) → commit on `feat/ecas-unified-import`.
