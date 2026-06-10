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
