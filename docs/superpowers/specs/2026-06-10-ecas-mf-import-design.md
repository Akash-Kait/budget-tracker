# MF via the eCAS folio section — replace CAMS/KFintech as the MF source — Design Spec

**Date:** 2026-06-10 (Q1–Q6 settled 2026-06-10)
**Status:** APPROVED IN SHAPE — decisions folded in; **awaiting go-ahead to implement**. Spec only.
**Branch:** `feat/ecas-mf-import` (off `main`, which has the merged eCAS stock feature it reuses).
**Stakes:** MF ≈ **91% of portfolio value** (₹10.26L of ₹14.4L). Deep-review rigor proportional —
the **CAMS/KFintech → eCAS migration preserving user-adjusted cost basis** is the named must-break.

## Problem & the reversed assumption

We previously believed the depository eCAS couldn't source MF because it lacked cost basis. Probing the
real eCAS **reverses that**: page 9 ("MUTUAL FUND UNITS HELD AS ON 30-04-2026") is a clean table with
**Scheme Name · ISIN · Folio No · Closing Bal (Units) · NAV · Cumulative Amount Invested · Valuation ·
Unrealised P/L · P/L %** (+ a Grand Total: ₹8,50,000 invested → ₹10,26,056.02). It's RTA-sourced
(CAMS/KFin, per the statement's pages 3–4), so it carries cost basis. **Replacing CAMS/KFintech with
eCAS no longer loses MF cost basis** — the old blocker is gone.

## Scope

- **MF source = the eCAS FOLIO section** (page-9 "MUTUAL FUND UNITS HELD AS ON" table) — **replaces**
  the CAMS/KFintech CAS import as the source of mutual-fund data.
- Parse per-scheme rows: scheme name, ISIN (`INF*`), folio, closing units, NAV, amount invested,
  valuation. ISIN-anchored, positional, ignore the garbled bilingual header — the **same technique as
  the equity parser** (reuse `scripts/ecas_parse.py` helpers: locator, `parse_holding_row`-style
  right-indexing, AS-ON date, ISIN classification).
- **Decommission-not-delete:** stop using CAMS/KFintech as the MF source, but **leave `lib/cas/`,
  `scripts/cas_parse.py`, `/api/wealth/import-cas` in place** until the eCAS MF path is proven on real
  data. Removal is a later, separate change.

## Double-count guard (critical — MFs appear TWICE in the eCAS)

The eCAS holds MFs in two places:
1. **Folio section** (page 9, ~₹10.26L, **WITH** cost basis) — the source we import.
2. **Demat-held `INF*` rows** in the equity-style holding statement (pages 6–7, ~₹1.8L, **NO** cost
   basis) — the stock importer already **excludes** these (it imports `INE*` only).

**Import MFs from the FOLIO section ONLY.** The demat-`INF*` rows are never imported as MF here. A fund
present in both sections must be imported **once, from the folio section**. → regression test (a).

## Cost-basis semantics — the mapping check (RESOLVED, with a flagged nuance)

Read `lib/wealth.ts`: `assetCostBasis(a) = a.costBasis` (**total amount invested, ₹** — not avg/unit,
not FIFO lots); `assetGainLoss = round2(assetValue(a) − costBasis)`, `pct = absolute/basis×100`;
`assetValue = quantity × pricePerUnit` (else manual value).

- The eCAS **"Cumulative Amount Invested"** is total ₹ invested (net of withdrawals) → maps **directly**
  onto `costBasis`. No derivation needed (it's total invested, exactly what the model expects).
- **Decision — recompute, don't store the eCAS's P/L.** Store `quantity = units`, `pricePerUnit = NAV`,
  `costBasis = amount_invested`; let `lib/wealth` compute P/L = `assetValue − costBasis` =
  `units×NAV − invested` = the eCAS's own Unrealised P/L. Single source of truth (the chart already
  uses it). **Reconciles on the sample:** Canara Robeco ₹2,20,000 → units×NAV = ₹2,71,826.59 →
  +₹51,826.59 = **23.56%**, matching the eCAS. → regression test (e).
- **Flag (not silent):** "Cumulative Amount Invested" is **net of withdrawals** — after partial
  redemptions it's the net figure, so the recomputed P/L is "unrealised P/L vs net invested" (which is
  exactly what the eCAS shows). Documented, not hidden.
- **Value storage — DECIDED (Q5):** store the eCAS **Valuation column as the statement-date `value`**
  (the document's asserted figure, which ties to the Grand Total ₹10,26,056.02) — do **not** treat a
  `units×NAV` recompute as the authoritative stored figure. Store `quantity = units` + `pricePerUnit =
  NAV` too (for display + the AMFI refresh). **Verify `units×NAV` reconciles with the eCAS Valuation to
  ≤ ₹1 at import; if it diverges by more than a rounding rupee, that's a PARSE-ERROR signal — surface
  it, don't absorb it.** The coverage check (below) sums the eCAS Valuations against the Grand Total.
  (Note: `assetValue` prefers `qty×price`, so the *live* displayed value tracks the refreshed NAV; the
  stored `value` is the verified statement snapshot + the Grand-Total reconciliation anchor.)

## AMFI NAV refresh for eCAS-MF rows — DECIDED (Q1): keep refresh, resolve ISIN→AMFI from the feed

The folio section gives **ISIN + folio, no AMFI code** (Q6 confirmed; the "RTA scheme code" like
`ETDG/8019` is the AMC/RTA code, **not** the AMFI code — never conflate). We **keep daily NAV refresh**
(losing it on 91% of the portfolio is a real regression), resolving **ISIN → AMFI code from the AMFI
`NAVAll` feed itself** — not a static hand-maintained map:

- The AMFI feed line is `Scheme Code;ISIN-Growth;ISIN-Reinvest;Scheme Name;NAV;Date` — it already
  carries the **ISIN columns alongside the scheme code**, and the existing provider already downloads
  it. **Extend `lib/market/amfi.ts` `parseNavAll` to also index `ISIN → scheme code` (both ISIN
  columns)**, so the map stays current from live data on every refresh.
- **eCAS-MF rows store `ticker = ISIN`** (their stable identifier from the folio section). The AMFI
  provider/`refresh-prices` resolves a MUTUAL_FUND row's identifier by **AMFI code OR ISIN** (existing
  CAS rows keep `ticker = AMFI code`; eCAS rows use ISIN — both resolve via the same feed). So
  `amfiProvider.getQuotes` accepts either and looks up `code→quote` directly or `ISIN→code→quote`.
- **ISIN not found in the feed → a visible `priceStatus = NOT_FOUND` "NAV refresh unavailable for this
  fund" state**, never silent staleness (reuses the existing NOT_FOUND surfacing).

(Wealth→market is allowed by the firewall — the refresh route already calls the provider. The eCAS-MF
import also consults this feed-derived ISIN→code map for migration matching — see below.)

## Reconcile (reuse the established discipline; pure `lib/ecas/mf-reconcile.ts`)

- **Match key `folio|ISIN`** (a fund can span folios — same ISIN in two folios stays distinct, mirroring
  the stock `boId|isin` and CAS folio-qualified keys). `ticker` = AMFI code (per Q1-a) or ISIN (Q1-b).
- Considers **only `type === 'MUTUAL_FUND'`** rows. create / update / **flag-absent never delete** /
  idempotent / **adoption MERGES** (never overwrites a user-adjusted MF cost basis) / **older-statement
  guard** (reject 422 if undateable / 409 if older — reuse the stock route's guard).
- Never nulls an existing value; surfaces unreadable rows (incomplete) and a coverage check vs the
  folio **Grand Total invested → valuation** (reuse the equity coverage pattern).

## Migration: CAMS/KFintech MF rows → eCAS-sourced (the high-stakes step — 91% of the portfolio)

Existing CAS MF rows: `source='CAS'`, `importKey = folio|<amfi>`, `ticker = <amfi>`, `tickerName =
scheme name`, `costBasis` possibly user-adjusted (casparser cost was often null, so many are null or
hand-entered). eCAS-MF rows key on `folio|ISIN`. **The keys don't bridge** (`amfi ≠ ISIN`), so a naive
import would **create new MF rows beside the CAS rows → double-count 91% of the portfolio.** This is the
must-break.

**The bridge — DECIDED (Q2): feed-derived ISIN→AMFI + a MANDATORY, BLOCKING preview/confirm.**
- Resolve each eCAS folio row's **ISIN → AMFI code via the Q1 feed-derived map**, then **match to
  existing CAS rows by `folio + AMFI code`** (CAS rows are `importKey = folio|amfi`, `ticker = amfi`).
  This is the exact equivalence — not fuzzy name matching.
- The import is **two-phase**: phase 1 parses + resolves + matches and returns a **PREVIEW** (no
  writes): e.g. *"5 existing → 5 matched · 0 new · 0 unmatched."* Phase 2 applies **only on explicit
  user confirmation**. Any row **unmatched on either side** (an eCAS fund with no CAS row, or a CAS row
  with no eCAS match — including an ISIN the feed can't resolve) is **surfaced in the preview, never
  auto-created or auto-deleted**. The one-time friction is justified by it being 91% of the portfolio.

**Cost-basis on migration — DECIDED (Q3): preserve, surface, never auto-prefer eCAS.**
- existing `costBasis == null` → take the eCAS `amount_invested` (finally a real basis).
- existing `costBasis != null` → **preserve it (merge)** and **surface the discrepancy** in the preview
  ("eCAS reports ₹X invested; stored basis ₹Y") for the user to choose **per fund** — never silently
  overwrite, never silently keep.
- **Schema note (stated, per your ask):** the schema does **NOT** track whether `costBasis` was
  user-adjusted vs import-set (it's a plain `Float?`). So we take the **safe side**: a non-null basis is
  always treated as possibly-user-adjusted → preserve + surface, never auto-adopt. (A future
  `costBasisSource`/`costBasisManual` flag could enable auto-adopt for never-touched rows; out of scope.)

**Partial-match hardening — DECIDED (Q2-adjacent, the dangerous case):** AMFI reachable but **one
fund's ISIN not found in the feed** (new fund / changed ISIN / per-scheme hiccup) → preview shows
4/5 matched, 1 unmatched. "Mostly right" invites a confirm — and if apply then **creates** the
unmatched row, that fund exists as BOTH the old CAS row AND a new eCAS row = **double-count on a real
holding.** Contract:
- **In a MIGRATION context (any `source='CAS'` MUTUAL_FUND rows exist), an unmatched eCAS folio row is
  NEVER created** — those funds are known to exist as CAS rows, so unmatched means the
  `folio|amfi ↔ folio|ISIN` bridge FAILED for that fund: an **error to resolve, not new inventory**.
  The apply is **blocked** (or that row quarantined for explicit per-row action) — never a silent create.
- **In a genuine FIRST import (no prior CAS MUTUAL_FUND rows), an unmatched fund IS a legitimate
  create.** The create-on-unmatched path is **gated on migration-vs-first-import**, not uniform.
- The **preview visually distinguishes three buckets — `matched` / `unmatched-blocking` / `new
  (first-import only)`** — so a partial-match migration cannot be confirmed into a double-count.

**Non-destructive & reversible:** on confirmation, migration is an in-place **update** (CAS row →
`source` flips to `ECAS`, `importKey`→`folio|ISIN`, `ticker`→ISIN, units/NAV/value refreshed, costBasis
per Q3) — **no deletes**. The prior `source='CAS'`/`importKey=folio|amfi`/`ticker=amfi` are recorded so
it's reversible. Applied in one `prisma.$transaction`. CAS rows are **converted, not duplicated** —
test (c) asserts no duplicate appears for any of the 5 funds.

## Data model

**No new columns** — reuse `source`, `importKey`, `casStatus`, `costBasis`, `tickerName`, `priceSource`,
`value`. **DECIDED (Q4): `source = 'ECAS'`, type-scoped** (no `'ECAS_MF'`) — the `type` field already
distinguishes MF from STOCK, so each reconcile filters by type (stock → `STOCK`, MF → `MUTUAL_FUND`),
consistent with the stock importer. `@@unique([source, importKey])` still holds — `folio|ISIN` (MF) and
`boId|isin` (stock) never collide (different ID formats). `ticker = ISIN`; `priceSource = 'ECAS'` (the
statement NAV) until an AMFI refresh resolves ISIN→code and flips it to `API`.

## Firewall / honesty (unchanged)

Wealth-only; `lib/finance.ts` untouched, imports nothing here; `lib/ecas/` imports no finance. NAV/
valuation labeled **"as of <statement date> · end of day"**; unknown ≠ zero; absent surfaced not
deleted; parse failures visible. The as-of date anchors to the folio section's **"AS ON 30-04-2026"**
via the same label-anchored explicit-ISO logic the stock fix uses — never a stray date, never a locale
parser.

## Files (planned — for implementation after approval)

- **New:** folio-MF parsing in `scripts/ecas_parse.py` (a `parse_folio_mf` table reader + `build`
  emitting MF holdings — reuse the locator/date/number helpers); `lib/ecas/mf-reconcile.ts` (pure) +
  `lib/ecas/mf-types.ts` (or extend `types.ts`); `app/api/wealth/import-ecas-mf/route.ts` (or a `kind`
  param on the existing route); a `EcasMfImportPanel` (or extend the eCAS panel); tests
  `lib/__tests__/ecas-mf-reconcile.test.ts`, route test, `scripts/test_ecas_parse.py` MF cases, a
  redacted synthetic folio-MF fixture (the 5 sample schemes — **never a real eCAS**).
- **Modify:** `lib/types.ts` (source value per Q4), `app/wealth/page.tsx` (mount), `docs/ARCHITECTURE.md`.
  Possibly `lib/data.ts` (none expected). The migration runs in the import route's transaction.
- **Untouched (decommission, don't delete):** `lib/cas/*`, `scripts/cas_parse.py`,
  `/api/wealth/import-cas`. `lib/finance.ts`, `lib/wealth.ts` (math unchanged).

## Test plan

- **(a) double-count:** a fund in both folio + demat-`INF` sections → imported once (folio); the
  demat-`INF` row is not imported as MF.
- **(b) folio MF row parses** with amount-invested + valuation intact (the 5 sample schemes).
- **(c) migration — must-break: no duplicates + preserve user basis.** Existing CAS rows
  (`folio|amfi`) bridged to eCAS (`folio|ISIN`) via feed-resolved ISIN→AMFI must **convert in place,
  not duplicate** any of the 5 funds. A user-set `costBasis` is preserved (merge) + the discrepancy
  surfaced; a null-basis row gains the eCAS `amount_invested`.
- **(c2) bridge no-duplicate (named must-break):** feed `ISIN→amfi` resolution + `folio+amfi` match —
  assert each of the 5 funds matches its CAS row (0 new, 0 unmatched) and produces exactly one row.
  And: an ISIN the feed can't resolve → surfaced unmatched in the preview, **not** auto-created.
- **(c3) preview is blocking:** phase-1 returns the preview with **zero DB writes**; nothing is written
  without explicit confirmation (assert no `create`/`update` before confirm).
- **(c4) PARTIAL-match migration (the dangerous case — named must-break):** migration with 4 matched +
  1 ISIN-not-in-feed → apply is **blocked** (or that row quarantined); the unmatched fund is **NOT
  created**; **no double-count**. AND: a genuine first-time import (no prior CAS MF rows) with an
  unmatched fund → it **IS created** (the create path still works when it should). Create-on-unmatched
  is gated on migration-vs-first-import.
- **(d) reconcile discipline:** absent fund flagged not deleted; idempotent re-import (no dupes);
  older-statement guard (409) / undateable (422).
- **(e) semantic reconciliation:** `costBasis = amount_invested` → `lib/wealth` P/L equals the eCAS
  Unrealised P/L on the sample (Canara Robeco 23.56%, etc.). And **value = eCAS Valuation**, with
  `units×NAV` reconciling to ≤ ₹1 (a larger gap → parse error, asserted).
- **(f) MF gain/loss still renders** (coloured bars, real P/L) — the regression the chart drove this
  revisit for; `gainLossStatus` returns gain/loss (not striped) for an eCAS-MF row with a basis.
- **(g) ISIN→AMFI from the feed:** `parseNavAll` indexes both ISIN columns → `getQuotes` resolves a MF
  row by ISIN; an ISIN absent from the feed → `priceStatus = NOT_FOUND` ("NAV refresh unavailable"),
  not silent staleness.
- **(h) firewall:** `lib/finance.ts` imports nothing here; `lib/ecas` imports no finance.

## Resolved decisions (Q1–Q6, settled 2026-06-10)

- **Q1 — keep AMFI refresh**, resolving **ISIN→AMFI code from the `NAVAll` feed** (extend `parseNavAll`
  to index both ISIN columns); `ticker = ISIN`; ISIN-not-in-feed → visible NOT_FOUND.
- **Q2 — feed-resolved ISIN→AMFI + `folio+amfi` match, behind a MANDATORY, BLOCKING preview/confirm;**
  unmatched (either side) surfaced, never auto-created/deleted.
- **Q3 — preserve a stored `costBasis` + surface the discrepancy** (never auto-prefer eCAS); null →
  adopt eCAS. Schema does **not** flag user-adjusted, so non-null is always treated as user-owned.
- **Q4 — `source = 'ECAS'`, type-scoped** (no `'ECAS_MF'`).
- **Q5 — store the eCAS Valuation as `value`** (ties to the Grand Total); units+NAV for display/refresh;
  `units×NAV` vs Valuation > ₹1 ⇒ parse error.
- **Q6 — confirmed: folio section has NO AMFI code** (RTA scheme/AMC code present, not AMFI). Residual:
  confirm against full page 9 in case a column was off-screen.

---

**On your go-ahead:** implement on `feat/ecas-mf-import` (folio-MF parser + feed-derived ISIN→AMFI index
in the AMFI provider + pure MF reconcile + two-phase preview/apply route + migration + UI + tests), then
a **DEEP review before commit** with TWO named must-break targets:
1. the **CAMS/KFintech→eCAS migration preserving user-adjusted cost basis on 91% of the portfolio**, and
2. the **`folio|amfi` (CAS) vs `folio|ISIN` (eCAS) bridge must not duplicate any of the 5 funds** —
   re-attacked via the feed-resolved ISIN→AMFI match + the blocking preview.
Each fix lands with its regression test. Verify live on the real eCAS (the 5 schemes + the Grand Total
₹10,26,056.02 reconcile, and the preview showing 5 matched / 0 new / 0 unmatched).

---

## Implementation outcome (shipped on `feat/ecas-mf-import`, deep-reviewed + live-verified 2026-06-10)

**Parser source — FOLIO TABLE ONLY (key correction found in live-verify).** The same MF ISINs appear in
three tables: the page-9 **folio** section (cost-basis source), the demat **equity** holding statement
(MF units held in demat, no basis), and a **transaction** statement (Op.Bal/Cr/Debit). The first cut
scanned every table and double-counted (transaction rows' Op.Bal/Cr were misread as invested/valuation,
+₹5,650/+₹861 over the Grand Total). Fix: `is_folio_table` gates on the folio header (`Folio` +
`Cumulative Invested` columns); `collect_mf_rows` parses only that table. The demat MF funds
(INVESCO/MOTILAL/SBI Gold/UTI, ~₹1.8L, no basis) are intentionally **not** imported — folio-only scope.

**Deep-review hardening (all with regression tests):**
- **Coverage is BLOCKING:** sum of parsed valuations/invested must tie to the Grand Total (±₹1); a
  shortfall means a folio row silently didn't parse → block (don't under-report 91% / mis-flag absent).
- **Half-migrated conflict blocks:** if a fund has BOTH a CAS (`folio|amfi`) and an eCAS (`folio|ISIN`)
  row, converting one would orphan the other → block, don't silently double-count.
- **`migrationContext` = any non-ECAS MF row** (CAS *or* manual) — a manual MF overlap can't be
  auto-created either.
- **Older-statement guard includes CAS dates** so the first migration is protected.
- **Soft-hyphen/zero-width ISIN repair** in the parser AND re-cleaned in the reconcile + route (the
  route keys the AMFI bridge map on the same normalization) — verified on Mirae `INF769K01DM9`.
- **Grand-Total valuation = col 6 (`nums[1]`)**, P/L-bleed-proof.
- Security review clean: PDF/password server-side, in-memory, stdin-only, never logged; finance firewall intact.

**Two-phase route** `POST /api/wealth/import-ecas-mf` (`confirm` flag): stateless preview→apply, the
server re-parses and re-checks `blocked` on apply (client never trusted). CAS import **code retained**;
CAS panel **unmounted** as the MF source.

**Live-verify (real eCAS, 30-04-2026):** 5 folio funds imported, ₹8,50,000 basis preserved, parsed
valuation tied exactly to ₹10,26,056.02; AMFI then refreshed every fund to live NAV by ISIN (Mirae's
wrapped ISIN resolved). Verification: Python 25, vitest 218, tsc clean, `next build` exit 0.

> **⚠ ROUND 1 WAS INCOMPLETE — NOT SHIPPED.** Live-verify surfaced a silent under-report: the eCAS
> holds **9** mutual funds, not 5. Four are **demat-held MFs** (INVESCO `INF205KA1213`, Motilal
> `INF247L01AE7`, SBI Gold `INF200K01RP8`, UTI `INF789FC12T1` = **₹1,80,540.01**, the "Mutual Funds
> Held in Demat Form" bucket) — INF rows in the equity-style holding statement (pages 6-7). They fell
> into a scope gap: the stock importer skips INF (correct) and the folio MF importer was page-9-only,
> so **no importer owned them**. Worse, the coverage check tied to the **folio Grand Total** — its own
> section's total — so it structurally could not see a whole MF sub-class vanish: green **and** wrong.
> DB trace confirmed 0 prior MF rows (so nothing was orphaned by unmounting the CAS panel; the demat
> MFs were simply never imported). Round 2 (below) fixes the scope gap **and** the coverage blind spot.

---

## Round 2 — own ALL mutual funds (folio + demat-held); fix the coverage blind spot (awaiting approval)

**Decision (approved 2026-06-10):** Option 1 — the single MF importer ingests BOTH MF sections of the
eCAS, so one importer owns all 9 funds. Demat-held MFs are tracked **value-only** (quantity + statement
value, **no cost basis**, **no gain/loss** — the same honest treatment as eCAS stocks). They are mutual
funds, so `type = MUTUAL_FUND` (not STOCK). Stays on `feat/ecas-mf-import` (Round 1 is uncommitted;
shipping the folio-only version would ship the under-report).

### What the importer reads now — TWO sections of the eCAS
| Section | Where | Has cost basis? | Key | gain/loss |
|---|---|---|---|---|
| **Folio MF** (Round 1) | page 9 "MUTUAL FUND UNITS HELD AS ON" | yes (Cumulative Invested) | `folio\|ISIN` | yes |
| **Demat-held MF** (new) | holding statement, pages 6-7 (INF rows) | **no** | `boId\|ISIN` | no — "— not set" |

The transaction statement (page 6 table 1: Op.Bal/Cr/Debit/Stamp) is NEITHER — it must stay excluded
(its INF rows already double-counted once; never read it as a holding).

### Design delta

1. **Parser (`scripts/ecas_parse.py`, `mf` mode).** In addition to `is_folio_table` (Round 1), add
   `is_demat_holding_table` (header has *Current/Free Bal* + *Market Price/Value*, and lacks *Folio*,
   *Cumulative*, and the transaction-table markers *Op. Bal/Stamp*). From those tables, parse the INF
   rows (reuse `parse_holding_row`; keep `classify_isin == 'mf'` instead of skipping), tagged with the
   page's BO ID. Emit a unified `holdings[]` where each holding carries `section` (`'folio'|'demat'`),
   its key inputs (`folio` or `boId`), `amountInvested` (null for demat), and `valuation` (= statement
   value for demat). Also parse the **demat-MF stated total** for coverage (see #3).
   - **Demat-MF anchor = the DISCRETE stated line.** Parse the page-5 summary line "Mutual Funds Held
     in Demat Form ₹1,80,540.01" directly. Do **NOT** derive it as `demat Portfolio Value − Equity
     total` — that subtraction assumes the demat account holds *only* equity + MF and silently
     misattributes any other class (bonds/ETFs/REITs) into the MF bucket (the same closed-world
     assumption that caused the original gap). Derivation is a fallback ONLY if the discrete line truly
     doesn't exist, and then it must `assert demat_total == equity + MF` and **BLOCK/surface** if the
     arithmetic doesn't close — never absorb the remainder into MF. *Probe at implementation to confirm
     the discrete line's exact (likely bilingual/garbled) label + location.*

2. **MANDATORY no-overlap guard (where a double-count would hide).** Before storing, assert NO ISIN
   appears in both sections. Probe data shows the 9 are disjoint (folio: Canara/ICICI Tech/Mirae/quant
   ELSS/quant Small; demat: INVESCO/Motilal/SBI Gold/UTI) — **verified in code, not eyeballed**. If an
   ISIN IS in both → same fund held two ways → ingest **once, folio wins** (it carries cost basis), drop
   the demat copy at the storage step. *Regression: an ISIN in both sections → imported once, from
   folio, with basis; never twice.*

3. **Coverage fix (the blind spot) — three checks, all must tie (±₹1):**
   - **folio:** folio-parsed-valuation vs folio Grand Total (₹10,26,056);
   - **demat:** demat-parsed-valuation vs the **discrete** demat-MF stated line (₹1,80,540);
   - **stored total (overlap-consistency):** the value actually STORED must equal
     `folio Grand Total + demat stated − overlap-dropped`. This closes the hole where an ISIN in both
     sections makes folio coverage tie (counts it) AND demat coverage tie (counts it) while storage
     dedups to one (folio wins) → two green checks but a stored total low by the overlap. The
     overlap-dropped amount (the demat copy we discard) is subtracted from the anchor, and the stored
     total is validated against that adjusted figure — the two per-section checks may not pass while
     the stored total ≠ what they blessed.
   `coverageBlocking` if ANY of the three fails → impossible for a sub-class to vanish, or for an
   overlap to silently shrink the total. Coverage runs at PREVIEW/IMPORT time against **statement
   valuations only** — never re-run against post-AMFI-refresh values (those move daily → false-positive).
   *Regressions: drop one demat MF → demat check fails → blocked; drop one folio MF → folio check
   fails → blocked; an ISIN in BOTH sections → stored once (folio, with basis), surfaced as a notable
   overlap event, and the stored total ties to folio+demat−overlap (never silently merged).*

4. **Reconcile/storage (`mf-reconcile.ts`).** Demat MF create: `type=MUTUAL_FUND`, `source='ECAS'`,
   `costBasis=null`, `importKey=boId|ISIN`, `priceUpdatedAt=`statement AS-ON, `priceSource='ECAS'` →
   AMFI daily refresh by ISIN applies (same as folio). Per-section ownership: `flaggedAbsent` and
   idempotency must treat `folio|ISIN` and `boId|ISIN` keys correctly so a future re-import is stable.
   (Current import is a pure create — DB trace shows 0 prior MF rows — but the discipline must hold.)

5. **No UI/firewall change of substance.** Demat MF rows render like no-basis stocks (gain/loss line
   "— not set"). `lib/finance.ts` still imports nothing here.

### Deep-review named must-breaks (Round 2)
1. **No-overlap guard** — an ISIN in both sections is stored once (folio), never double-counted.
2. **Total-MF coverage** — neither the folio NOR the demat sub-class can vanish without the coverage
   check firing; coverage uses statement valuations, never post-refresh values.
3. **Overlap-coverage-consistency** — when an overlap is deduped, the stored total ties to
   `folio+demat−overlap`; the two per-section checks cannot both pass while the stored total is wrong;
   the overlap is surfaced, never silently merged.

### Live-verify acceptance (Round 2)
All 9 MFs present; MF total reconciles to folio + demat buckets at statement date
(≈ ₹10,26,056 + ₹1,80,540 = ₹12,06,596); the 5 folio funds show gain/loss, the 4 demat funds show
"— not set"; AMFI refresh works on all 9. Then housekeeping (`git log --all -- app-full.zip
.claude/settings.json` → gitignore → exclude) and commit.
