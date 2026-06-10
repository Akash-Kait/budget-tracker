# Stocks Hands-Off — CDSL/NSDL eCAS (DigiLocker) Stock Import — Design Spec

**Date:** 2026-06-10
**Status:** AWAITING APPROVAL — do not implement until approved. (Spec only; no feature code this session.)
**Goal:** Make **stocks** hands-off: auto-populate/update `STOCK` `WealthAsset` rows from the user's
**CDSL/NSDL eCAS** (the depository consolidated statement), pulled via **DigiLocker**, with the
statement-date market value as a seed price. Stocks-only. The existing CAMS/KFintech **mutual-fund**
CAS path and all MF/“other” display are left **exactly as shipped**.

This is a NEW path, separate from the MF CAS work (`lib/cas/`, `scripts/cas_parse.py`,
`/api/wealth/import-cas`) — casparser does **not** handle eCAS. Do not touch the working MF code.

---

## Problem statement

Stocks are still hand-entered. The depository eCAS lists all demat holdings (equity + demat-held MF)
and is retrievable from DigiLocker. We want equity holdings to flow in automatically — quantity +
statement-date value — reconciled (not blindly replaced), with honest pricing and an explicit
import-vs-manual distinction in the UI.

## Settled context (decided after probing a real CDSL eCAS — do NOT relitigate)

1. **Input = CDSL/NSDL eCAS via DigiLocker.** The eCAS **Holding Statement** table parses cleanly with
   **pdfplumber** — 9 positional columns (ISIN, Security, Current Bal, Frozen/Pledge/PledgeSetup/Free
   Bal, Market Price, Value); data rows clean, only the bilingual header garbled. Parser is
   **ISIN-anchored and positional — never relies on header text**. DigiLocker may return **structured**
   data; if so, PDF parsing is bypassed. Structured pull = primary, PDF parse = validated fallback.
2. **Stocks-only via ISIN prefix.** The holding table **interleaves equity (`INE…`) and demat-held
   MF (`INF…`)**. Import **`INE*` rows ONLY** — importing `INF*` would **double-count** against the
   CAMS/KFintech MF data. Silent-corruption risk → explicit regression test.
3. **Import scope = quantity + statement-date market value only.** Statement price seeds
   `pricePerUnit`, labeled **"as of <date> · end of day"** (mirror AMFI labeling).
4. **Cost basis / gain-loss — STOCKS get NONE.** eCAS structurally has no cost column (holding table)
   and the transaction table is a single-month window. Imported stocks carry **`costBasis = null`** →
   **no gain/loss line** (the existing "unknown ≠ 0" handling in `lib/wealth.ts` already does this —
   **no math change**). MF/“other” keep their cost basis + gain/loss **untouched**. The temporary
   visible inconsistency (stocks no P/L, MFs P/L) is **accepted**; a product-wide gain/loss decision
   is **explicitly out of scope/deferred**.
5. **Current-price refresh = a live-quote provider behind the existing `PriceProvider` seam**,
   env-gated like `MARKET_DATA_PROVIDER`, same stale / NOT_FOUND / honest as-of labeling as AMFI. eCAS
   price is seed/fallback; the live provider refreshes between statements. ISIN↔exchange-symbol
   mapping = a visible NOT_FOUND, not a silent gap. **→ recommended as its own follow-up spec (below).**

## Non-negotiable constraints (carried into design)

- **Planning/Wealth firewall.** Stocks are Wealth-only. `lib/finance.ts` untouched; new code imports no
  finance, and finance imports no wealth/market/ecas. (Baseline verified clean — only comments
  reference the firewall.)
- **Reconcile, never blind-replace.** Match by stable key; create/update; **FLAG-absent (never
  delete)** — including a demat account (BO ID) that goes to **Nil Holding**; idempotent re-import;
  **adoption of a manual row MERGES** (never overwrites user fields); never touch non-stock rows; never
  touch `INF*`/MF rows.
- **Honest data.** Never show stale price as current; never silently zero/phantom a holding;
  distinguish unknown from zero; surface auth/not-found/stale as **persistent visible** states.
- **UI marks import-sourced vs manual** stocks (via `source`) so the manual-maintenance gap is honest.
- **Credentials server-side only** — never logged, sent to client, or in repo; read from env.

---

## Recommended scope split (keeps the review surface small)

**This spec = the import path** (DigiLocker/eCAS → reconcile stocks, seed price from the statement).
**Follow-up spec = the live stock-quote provider** (point 5) behind `PriceProvider`. Rationale: the
import crosses one trust boundary (DigiLocker/PDF + money values); the live provider crosses another
(a quote API + ISIN→symbol mapping) and reuses the AMFI stale/NOT_FOUND machinery. Splitting keeps each
deep-review focused — and the import is fully useful on its own (statement-date prices, refreshed each
time you import a newer eCAS). **Decision requested: approve the split** (§Open Questions Q6).

---

## Data model — NO migration (reuse columns + add string values)

`WealthAsset` already has every column needed. Stocks import **reuses** them; only TS enum consts gain
values (SQLite stores these as free strings → **no `db:push`/migration**):

| Field | Stock-import use |
|---|---|
| `type` | `'STOCK'` (existing) |
| `name` | security name from the statement |
| `ticker` | the **ISIN** (stable identity; also the live-provider lookup key) |
| `quantity` | Current Bal (units) |
| `pricePerUnit` | statement Market Price |
| `value` | left `null` (qty×price drives it; statement Value used as a parse cross-check only) |
| `priceUpdatedAt` | statement date (honest "as of") |
| `priceSource` | **`'ECAS'`** (new value) → live provider later flips to `'API'`. Mirrors `'CAS'`. |
| `priceStatus` | `OK` / `NOT_FOUND` (reused; live provider sets NOT_FOUND on unmapped ISIN) |
| `tickerName` | resolved security name echo (mirrors CAS) |
| `source` | **`'ECAS'`** (new value; `SOURCES = MANUAL \| CAS \| ECAS`) — scopes what stock reconcile may touch |
| `importKey` | stock reconciliation key (see §Reconcile / Q3) |
| `casStatus` | **reused** as the absent flag (`CURRENT`/`ABSENT`); UI copy made source-aware (Q4) |
| `costBasis` | **`null`** — never set for imported stocks (decision #4) |
| `purchaseDate` | `null` |

`lib/types.ts`: `PRICE_SOURCES += 'ECAS'`, `SOURCES += 'ECAS'`. `lib/data.ts`: already maps all these.
**No cost-basis schema change. No new columns** (pending Q4 — whether to reuse `casStatus` or add a
neutral `importStatus`).

---

## Input design (two clearly-separated paths)

### A. DigiLocker pull — PRIMARY (structured-first)
- Server-side OAuth2 to DigiLocker; fetch the issued CDSL/NSDL eCAS document. Credentials
  (`DIGILOCKER_CLIENT_ID`/`_SECRET`, redirect) from **env only**, never logged/client-exposed.
- If DigiLocker returns **structured holdings** (XML/JSON for the issued doc), map directly → bypass
  PDF parsing.
- If it returns only the **PDF**, hand it to path B.
- **Reality flag (Q1):** DigiLocker's pull/issued-document API requires **partner ("Requester")
  onboarding** — likely not in hand. So this path is specced but its *implementation* is gated on
  having credentials. **Phase 1 ships path B (manual eCAS PDF upload — the validated parser); the
  DigiLocker API auto-pull is Phase 2** (same route/reconcile, different source of bytes).

### B. eCAS PDF parser — VALIDATED FALLBACK (ships first)
- New Python sidecar **`scripts/ecas_parse.py`** using **pdfplumber** (MIT) — **separate** from
  `cas_parse.py`. Same hardened invocation as the CAS sidecar: PDF bytes + optional password over
  **stdin** (password first line — never argv/env), in-memory, temp-file fallback unlinked in
  `finally`, structured `{error,detail}` exits, never logs PDF/PII.
- **ISIN-anchored positional parse:** scan extracted rows; a holding row is one whose first cell
  matches `^IN[EF][A-Z0-9]{9}$`. Take columns **positionally** (ISIN, name, current-bal, …, market
  price, value) — **ignore the garbled header entirely**. Emit a trimmed JSON
  `{ statementDate, boId, holdings:[{isin, name, units, price, value}] }` per BO ID.
- **INE-only filter (decision #2):** the parser (or reconcile) keeps **`INE*` only**; `INF*` rows are
  dropped. This is the double-count guard → regression test (a).
- pdfplumber added to a **new** `scripts/requirements-ecas.txt` (or extend `requirements.txt`) — MIT.
  (Note: the MF path's optional PyMuPDF is unrelated.)

Both paths converge on the same normalized `{ statementDate, accounts:[{boId, holdings:[…]}] }` shape,
Zod-validated at the sidecar/DigiLocker boundary before reconcile sees it.

---

## Reconcile algorithm (mirrors the CAS ruleset; pure `lib/ecas/reconcile.ts`)

Input: existing assets + normalized eCAS (all BO IDs) + statement date. Considers **only
`type === 'STOCK'`** rows. Steps:

1. **Filter incoming to `INE*`** (drop `INF*` — MF double-count guard).
2. **Match** each incoming holding by `importKey` to an existing stock; also match an existing row
   whose `ticker === isin` (adopt a hand-entered stock).
   - **Found + `source==='ECAS'`** → update `quantity`, `pricePerUnit`, `priceUpdatedAt`,
     `priceSource='ECAS'`, `tickerName`, `casStatus='CURRENT'`. **Never** write `costBasis`.
   - **Found + manual (adopt, MERGE)** → update units/price/source/key ONLY; preserve user
     `name`/`costBasis`/`value`/`purchaseDate`.
   - **Not found** → create `type:'STOCK'`, `source:'ECAS'`, `costBasis:null`, `casStatus:'CURRENT'`.
3. **Flag absent:** any `source==='ECAS'` stock **not** present in this statement (across **all** BO
   IDs) → `casStatus='ABSENT'`. Covers the **Nil-Holding BO ID** case (an emptied demat account →
   all its stocks absent → flagged, never deleted).
4. **Never touch** non-`STOCK` rows, `INF*`, or `source!=='ECAS'` rows that don't match.
5. **Older-statement guard** (mirror CAS P0): if the eCAS statement date is older than the newest
   `priceUpdatedAt` among `source==='ECAS'` stocks → **reject (409)**, so a stale upload can't rewind
   quantities or wrongly flag holdings absent.
6. **Never null an existing price/quantity** if the incoming value is missing; **don't create a
   unit-less holding**.

Apply the resulting `{creates, updates, flaggedAbsent}` plan in one `prisma.$transaction` (mirrors the
CAS route).

**Match key (Q3):** ISIN alone **collides** when the same security sits in **two BO IDs** (same class
of bug as the MF two-folio collision we fixed by folio-qualifying). **Recommended:**
`importKey = `${boId}|${isin}`` (per-account positions stay distinct, idempotent); `ticker` stays the
bare ISIN for the live provider. **Alternative:** aggregate one ISIN across accounts into a single
summed position. Surfaced for decision (Q3).

---

## Live stock-quote provider (point 5 — high level; recommend follow-up spec)

Add a stock provider behind the existing `PriceProvider` seam (`getQuote`/`getQuotes`), selected by an
env flag alongside `MARKET_DATA_PROVIDER` (e.g. a stocks-specific gate). `refresh-prices` would route
`STOCK` tickers (ISINs) to it; eCAS price is the seed, the provider refreshes between statements; same
**stale** (business-day) + **NOT_FOUND** + "as of … · end of day" handling as AMFI. **ISIN→exchange
symbol** mapping is the crux and is surfaced as a visible **NOT_FOUND** when unresolved. Detailed
design (quote source, mapping table/API, rate limits) → **follow-up spec** to keep this review focused.

---

## Dashboard / UI

- **Stocks render NO gain/loss** — automatic: `costBasis=null` → `assetGainLoss` returns `null` →
  `GainLossText` renders nothing. **No change to `lib/wealth.ts`, MF, or “other”.**
- **Import-sourced vs manual badge** (decision/constraint): in `WealthAssetRow`, show a small
  source marker for `source==='ECAS'` stocks (e.g. "from eCAS") distinct from manual, so the
  maintenance gap is visible. Price line: `priceSource==='ECAS'` → **"as of <date> · end of day"**.
- **Absent flag:** reuse the amber pill, copy made source-aware — "not in latest statement" for
  stocks vs the existing "not in latest CAS" for MF (Q4).
- A `EcasImportPanel` (or extend the CAS panel) on `/wealth` — upload eCAS PDF (+ optional password) /
  or "Connect DigiLocker" (Phase 2). MF/other UI untouched.

## Firewall preservation (explicit)

New code lives in `lib/ecas/` (pure reconcile + sidecar boundary) and `app/api/wealth/…`. **`lib/ecas/*`
imports no `lib/finance`; `lib/finance.ts` is not modified and imports nothing new.** Verified by grep
in the test step (test (f)).

## Files (planned — for the eventual implementation, NOT this session)

- **New:** `scripts/ecas_parse.py` (pdfplumber, ISIN-anchored), `scripts/requirements-ecas.txt`;
  `lib/ecas/{types.ts, parse-normalize, reconcile.ts, sidecar.ts}`; `app/api/wealth/import-ecas/route.ts`;
  (Phase 2) `lib/ecas/digilocker.ts`; `components/wealth/EcasImportPanel.tsx`;
  tests `lib/__tests__/ecas-reconcile.test.ts`, `ecas-route.test.ts`, `scripts/test_ecas_parse.py`,
  fixture `lib/__tests__/fixtures/ecas-sample.json` (redacted synthetic — **never a real eCAS**).
- **Modify:** `lib/types.ts` (`SOURCES`/`PRICE_SOURCES` += `'ECAS'`), `components/wealth/WealthAssetRow.tsx`
  (eCAS price label + source badge + source-aware absent copy), `app/wealth/page.tsx` (mount panel),
  `docs/ARCHITECTURE.md` (eCAS setup). **`lib/data.ts` likely unchanged** (already maps the columns).
- **Untouched:** `lib/finance.ts`, `lib/wealth.ts`, `lib/cas/*`, `scripts/cas_parse.py`,
  `app/api/wealth/import-cas/route.ts`, all MF/other display, the Prisma schema (no migration).

## Test plan (fixture-based; redacted synthetic eCAS JSON — never a real statement)

Regression tests called out in the brief, plus parser/reconcile/route coverage:
- **(a) `INF*` never imported** — a fixture interleaving INE+INF; assert only INE rows create/update,
  zero INF rows touched (the double-count guard).
- **(b) Absent holding flagged, not deleted** — incl. a **Nil-Holding BO ID** (an account with zero
  holdings) → its prior stocks → `casStatus='ABSENT'`, still present in DB.
- **(c) Adoption MERGES** — a manual STOCK matched by ISIN: units/source updated, user
  `costBasis`/`name` **omitted from the update payload** (preserved).
- **(d) Idempotent re-import** — same fixture twice → no duplicates, none re-flagged.
- **(e) Stale / NOT_FOUND price surfaces visibly** — (live-provider spec; here: stale derives from the
  statement `priceUpdatedAt`, and an eCAS-seeded stock shows honest "as of <date>").
- **(f) `lib/finance.ts` has no wealth imports** — grep assertion (and ecas imports no finance).
- **(g) MF/other gain/loss display unchanged** — assert `assetGainLoss`/`totalGainLoss` outputs for MF
  fixtures are byte-for-byte unchanged; stocks with `costBasis=null` yield `null` (no P/L).
- **Parser:** ISIN-anchored positional extraction on a synthetic 9-column sample (incl. garbled
  header skipped, INF row dropped, multi-BO-ID, a Nil-Holding account); `test_ecas_parse.py`
  (zero-dep `python3` run, like `test_cas_parse.py`).
- **Older-statement guard** → 409 (mirror CAS P0).

## Open questions / inferred architecture (please confirm)

- **Q1 — DigiLocker API access.** The pull API needs DigiLocker **partner/Requester** credentials. Do
  you have/intend to obtain them? **Recommendation:** Phase 1 = manual eCAS PDF upload (validated
  parser, fully testable now); DigiLocker auto-pull = Phase 2 once creds exist (same route/reconcile).
- **Q2 — eCAS PDF password.** A DigiLocker-issued eCAS may be unprotected; the emailed CDSL eCAS is
  PAN+DOB-protected. Plan: reuse the optional-password stdin protocol (works either way). Confirm.
- **Q3 — Stock match key.** Recommend `boId|isin` (per-account, avoids the two-account collision);
  alternative is aggregate-by-ISIN. Which do you want?
- **Q4 — Reuse `casStatus`/add value vs new `importStatus` column.** Recommend reusing
  `casStatus` (CURRENT/ABSENT) + `source='ECAS'` (no migration), with source-aware UI copy. OK, or
  prefer a neutral column rename (touches MF code — I'd avoid)?
- **Q5 — Parser dep & sidecar.** New `scripts/ecas_parse.py` with **pdfplumber** (MIT), separate from
  casparser. Confirm pdfplumber (vs reusing PyMuPDF, which we kept as an opt-in for MF).
- **Q6 — Split the live-quote provider (point 5) into its own follow-up spec?** Recommended.
- **Q7 — Same ISIN appearing as both INE and INF?** Not expected (different prefixes = different
  instruments); INE-only filter handles it. Flagging in case your statement showed otherwise.

---

**On approval:** branch already cut (`feat/ecas-stock-import`); I implement Phase 1 (PDF parser +
reconcile + route + UI + tests), then a **deep review before commit** (external-PDF/DigiLocker +
credentials + money-values trust boundary), each fix landing with the regression test that would have
caught it. DigiLocker auto-pull (Phase 2) and the live-quote provider (point 5) per your answers to
Q1/Q6.
