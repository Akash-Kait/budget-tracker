# Stocks Hands-Off — CDSL/NSDL eCAS (DigiLocker) Stock Import — Design Spec

**Date:** 2026-06-10 (open questions Q1–Q7 settled 2026-06-10)
**Status:** APPROVED IN SHAPE — answers folded in; **awaiting go-ahead to implement**. (Spec only.)
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
5. **Current-price refresh = a live-quote provider behind the existing `PriceProvider` seam** — **SPLIT
   into its own follow-up spec (Q6).** This task ships **import only**: it uses the **eCAS
   statement-date price ONLY**, labeled **"as of <statement date> · end of day"** and visibly **NOT
   live** — the absence of a live provider must read as honest, never as a fresh quote.

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

## The normalized seam (Q1 — both inputs converge; reconcile never forks per source)

A single normalized interface is the contract between *any* input source and reconcile, so DigiLocker
(Phase 2) swaps in **behind the same entry point** with no change to reconcile/route:

```ts
interface EcasHolding { isin: string; name: string; units: number | null; price: number | null; value: number | null }
interface EcasAccount { boId: string; holdings: EcasHolding[] }          // one demat account (BO ID)
interface EcasParsed {
  statementDate: string | null;
  accounts: EcasAccount[];
  unrecognized: { isin: string; name: string }[];   // Q7 — ISINs neither INE* nor INF* (surfaced, not dropped)
}
```

Both the **pdfplumber sidecar** (Phase 1) and the **DigiLocker structured pull** (Phase 2) produce
`EcasParsed`; `reconcile(existing, parsed)` and the route consume only this. **There is one reconcile
path; the input source is interchangeable behind `EcasParsed`.** (Phase 2 is a different *producer*
of `EcasParsed`, not a different consumer.)

## Input design (two clearly-separated producers of `EcasParsed`)

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
  matches a **general Indian ISIN** `^IN[A-Z0-9]{10}$` (broad on purpose — see classification). Take
  columns **positionally** (ISIN, name, current-bal, …, market price, value) — **ignore the garbled
  header entirely**.
- **Three-way ISIN classification (Q7 — never a silent filter):** classify each holding row by ISIN:
  - `INE*` → **equity → import**.
  - `INF*` → **mutual fund → skip** (tracked via the CAMS/KFintech path; importing would double-count,
    decision #2). This skip is expected; report a count, don't surface as an error.
  - **neither `INE*` nor `INF*`** → **unrecognized → NOT imported, but surfaced** in
    `EcasParsed.unrecognized` and reported in the result as "unrecognized security — not imported
    (<isin>)". Never silently dropped. → regression test (h).
- The double-count guard (`INF*` never imported) → regression test (a).
- pdfplumber added to a **new** `scripts/requirements-ecas.txt` (or extend `requirements.txt`) — MIT.
  (Note: the MF path's optional PyMuPDF is unrelated.)

Both producers emit `EcasParsed` (above), Zod-validated at the sidecar/DigiLocker boundary before
reconcile sees it.

---

## Reconcile algorithm (mirrors the CAS ruleset; pure `lib/ecas/reconcile.ts`)

Input: existing assets + normalized eCAS (all BO IDs) + statement date. Considers **only
`type === 'STOCK'`** rows. Steps:

1. **Import `INE*` equities only.** `INF*` is skipped (MF double-count guard); unrecognized ISINs
   are carried through in `EcasParsed.unrecognized` and reported, **never silently dropped** (Q7).
2. **Match** each incoming holding by `importKey` to an existing stock; also match an existing row
   whose `ticker === isin` (adopt a hand-entered stock).
   - **Found + `source==='ECAS'`** → update `quantity`, `pricePerUnit`, `priceUpdatedAt`,
     `priceSource='ECAS'`, `tickerName`, `casStatus='CURRENT'`. **Never** write `costBasis`.
   - **Found + manual (adopt, MERGE)** → update units/price/source/key ONLY; preserve user
     `name`/`costBasis`/`value`/`purchaseDate`.
   - **Not found** → create `type:'STOCK'`, `source:'ECAS'`, `costBasis:null`, `casStatus:'CURRENT'`.
3. **Flag absent (per `boId|isin`):** any `source==='ECAS'` stock whose `importKey` is **not** in this
   statement → `casStatus='ABSENT'` (never deleted). Because the key is per-account, this correctly
   handles **(i)** an emptied demat account (**Nil-Holding BO ID** → all its stocks flagged), and
   **(ii)** the same ISIN held in two BO IDs where one statement drops it → **only the dropped
   account's row is flagged; the other account's row is untouched** (Q3 — the case most likely to hide
   a flag-vs-delete bug; regression test (i)).
4. **Never touch** non-`STOCK` rows, `INF*`, or `source!=='ECAS'` rows that don't match.
5. **Older-statement guard** (mirror CAS P0): if the eCAS statement date is older than the newest
   `priceUpdatedAt` among `source==='ECAS'` stocks → **reject (409)**, so a stale upload can't rewind
   quantities or wrongly flag holdings absent.
6. **Never null an existing price/quantity** if the incoming value is missing; **don't create a
   unit-less holding**.

Apply the resulting `{creates, updates, flaggedAbsent}` plan in one `prisma.$transaction` (mirrors the
CAS route).

**Match key (Q3 — DECIDED): `importKey = `${boId}|${isin}`` (per-account).** Storage + reconcile keep
per-account granularity; `ticker` stays the **bare ISIN** (live-provider lookup key, Phase 2). Aggregate-
by-ISIN is **rejected** — it erases which account holds what and breaks flag-absent when one account
drops a holding another still holds. The **dashboard MAY sum the same ISIN across BO IDs for DISPLAY**,
but that is a presentation concern only; storage/reconcile never aggregate. Mirrors the CAS folio-
qualified key fix.

---

## Live stock-quote provider — OUT OF SCOPE (Q6 — own follow-up spec)

Deferred to a separate spec to keep this review surface small. **This task ships import only.** Until
that lands, a stock's price is the **eCAS statement-date price ONLY**, stored `priceSource='ECAS'` and
rendered **"as of <statement date> · end of day"** — visibly **not** a live quote. The honest "no live
provider yet" reading is a **requirement**, not an omission (Q6) → UI test (k). The follow-up adds the
provider behind the existing `PriceProvider` seam (ISIN→exchange-symbol mapping as a visible
NOT_FOUND), reusing the AMFI stale/NOT_FOUND machinery.

---

## Dashboard / UI

- **Stocks render NO gain/loss** — automatic: `costBasis=null` → `assetGainLoss` returns `null` →
  `GainLossText` renders nothing. **No change to `lib/wealth.ts`, MF, or “other”.**
- **Import-sourced vs manual badge** (constraint): in `WealthAssetRow`, show a small source marker for
  `source==='ECAS'` stocks (e.g. "from eCAS") distinct from manual, so the maintenance gap is honest.
- **Price line is honestly NOT live (Q6):** `priceSource==='ECAS'` → **"as of <statement date> · end
  of day"** — same restraint as AMFI, no "live"/fresh implication. → UI test (k).
- **Absent flag — source-aware copy (Q4, REQUIRED):** reuse the amber pill + `casStatus`, but the
  wording is keyed off `source`: eCAS stocks read **"not in latest eCAS statement"**, MF rows keep
  **"not in latest CAS"**. Same column, honest but distinct text. → test (j).
- **Unrecognized securities (Q7):** the import result surfaces "N unrecognized securities — not
  imported (<isin>…)" as a visible warning (not a silent skip); these create no rows.
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
- **(h) Unrecognized ISIN surfaced, not dropped (Q7)** — a row whose ISIN is **neither `INE*` nor
  `INF*`** appears in `EcasParsed.unrecognized` and the import result, creates **no** row, and is
  **not** silently skipped.
- **(i) Two BO IDs, same ISIN, dropped from one (Q3) — the flag-vs-delete trap** — hold ISIN X in BO-A
  and BO-B; re-import a statement that omits X from BO-B only → `boId-B|X` → `casStatus='ABSENT'`
  (never deleted), `boId-A|X` **untouched** (still CURRENT, units intact). No row merged/lost across
  accounts. *(The deep review must specifically attempt to break this.)*
- **(j) Source-aware absent copy (Q4)** — an `ABSENT` stock (`source='ECAS'`) renders "not in latest
  eCAS statement"; an `ABSENT` MF (`source='CAS'`) still renders "not in latest CAS". Same column,
  different text keyed off `source`.
- **(k) Price reads as NOT live (Q6)** — an eCAS-seeded stock (`priceSource='ECAS'`) renders "as of
  <statement date> · end of day" with no live/fresh implication; no live-provider code path exists yet.
- **Parser:** ISIN-anchored positional extraction on a synthetic 9-column sample (garbled header
  skipped, INF row dropped, **unrecognized-prefix row surfaced**, multi-BO-ID, a Nil-Holding account);
  `scripts/test_ecas_parse.py` (zero-dep `python3` run, like `test_cas_parse.py`).
- **Older-statement guard** → 409 (mirror CAS P0).

## Resolved decisions (Q1–Q7, settled 2026-06-10)

- **Q1 — DigiLocker:** Phase 1 = manual eCAS PDF upload (ships now); DigiLocker auto-pull = Phase 2.
  **Requirement:** both produce the same `EcasParsed`; **one reconcile entry point**, no per-source
  fork (the normalized seam, above).
- **Q2 — Password:** reuse the existing optional-password stdin protocol (protected or not).
- **Q3 — Match key:** **`boId|isin`** (per-account). Aggregate-by-ISIN rejected. Dashboard may sum
  across BO IDs for **display** only. Regression test (i).
- **Q4 — Absent flag:** reuse `casStatus` + `source='ECAS'`, **no migration**; UI copy **source-aware**.
  Regression test (j).
- **Q5 — Parser:** new `scripts/ecas_parse.py` + **pdfplumber** (MIT), separate from casparser;
  `lib/cas/` and the casparser sidecar untouched.
- **Q6 — Live-quote provider:** **split into a follow-up spec.** This task = import only; price is the
  statement-date value, labeled NOT live. Regression test (k).
- **Q7 — ISIN classification:** `INE*` import / `INF*` skip / **neither → visible "unrecognized — not
  imported"**, never a silent filter. Regression test (h).

## Deep review (before commit) — must-break target

The review **must specifically attempt to break the `boId|isin` reconcile** with the two-account
scenario (same ISIN in BO-A and BO-B, dropped from one statement) — the case most likely to hide a
flag-vs-delete or cross-account-merge bug, and one that **won't appear while only one account is
funded**. Plus the usual: INF/unrecognized handling, adoption-merge, idempotency, older-statement
guard, firewall, no PDF/PII logging. Each fix lands with the regression test that would have caught it.

---

**On your go-ahead:** branch already cut (`feat/ecas-stock-import`); I implement **Phase 1 only** — the
manual eCAS-PDF-upload path: `ecas_parse.py` (pdfplumber, ISIN-anchored, three-way classification) →
`EcasParsed` seam → reconcile (`boId|isin`, INE-only, flag-absent, adoption-merge, older-statement
guard) → route → UI (source badge, "as of <date> · end of day", source-aware absent copy, unrecognized
warning) → the (a)–(k) tests. Then the **deep review before commit** with the `boId|isin` two-account
case as the explicit must-break target. **Out of this task:** DigiLocker auto-pull (Phase 2, behind the
same `EcasParsed` seam) and the live-quote provider (its own follow-up spec).
