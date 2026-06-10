# MF via the eCAS folio section — replace CAMS/KFintech as the MF source — Design Spec

**Date:** 2026-06-10
**Status:** AWAITING APPROVAL — spec only, no code until approved.
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
  exactly what the eCAS shows). Documented, not hidden. Also verify `units×NAV ≈ eCAS Valuation` on the
  sample (rounding); if they diverge materially, store the eCAS `value` instead — Open Q5.

## ⚠️ Open question that reshapes the feature: AMFI NAV refresh for eCAS-MF rows (Q1)

The folio section gives **ISIN + folio but NO AMFI scheme code**. Existing CAS MF rows store
`ticker = <AMFI code>`, and `POST /api/wealth/refresh-prices` (the AMFI provider) revalues MFs by
**AMFI code = ticker**. If eCAS-MF rows store `ticker = ISIN` (no AMFI code), **the AMFI daily-NAV
refresh can no longer revalue them** — MF prices would come only from the (monthly) eCAS statement.

This is a first-order trade-off, not a detail:
- **(a) Keep AMFI refresh:** add an **ISIN → AMFI-code mapping** (AMFI's published master has both) so
  eCAS-MF rows still get `ticker = AMFI code` and refresh daily. More machinery; needs the mapping
  source.
- **(b) Statement-date MF pricing:** eCAS NAV is the price (refreshed each eCAS import), labeled "as of
  <statement date> · end of day", AMFI MF-refresh effectively retired. Simpler; loses daily NAVs on 91%
  of the portfolio.

**Recommendation: (a)** — losing daily NAVs on 91% of value is a real regression; the AMFI work exists
precisely for that. But it's your call. **This decision gates the data model and the parser's ticker
mapping — please answer before implementation.**

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

**The bridge (Open Q2 — needs your decision):** the only fields common to both a CAS row and an eCAS
folio row are **folio + scheme name** (CAS has no stored ISIN; eCAS folio has no AMFI code). Options:
- **(b1) folio + normalized scheme name** — exact folio + fuzzy-normalized name. Works on the sample but
  name rendering can differ between CAMS-CAS and eCAS-folio. Fragile on 91% of value.
- **(b2) ISIN ↔ AMFI master map** (the same map Q1-a needs) — bridge CAS `ticker=amfi` ↔ eCAS `ISIN`
  via AMFI's master. The robust key bridge; needs the mapping source.
- **(b3) one-time preview/confirm** — present the proposed CAS→eCAS matches (old basis vs eCAS invested,
  old units vs eCAS units) and require explicit user confirmation before converting. Safest for a 91%
  migration; most work.

**Recommendation: (b2) for the match + (b3)'s preview as a safety net** — but flag for approval.

**Cost-basis on migration (Open Q3):** per the constraint "never clobber a user-adjusted MF cost basis":
- existing `costBasis == null` → take the eCAS `amount_invested` (a strict gain — finally a real basis).
- existing `costBasis != null` → **preserve it** (merge), and **surface a discrepancy** when it differs
  materially from the eCAS `amount_invested` ("your basis ₹Y vs statement ₹X") rather than silently
  clobber OR silently keep a possibly-stale number. Decision: preserve + surface (honest), vs prefer
  eCAS (accurate but clobbers). Recommend preserve + surface.

**Non-destructive & reversible:** migration is an in-place **update** (CAS row → `source` flips,
`importKey`→`folio|ISIN`, units/NAV/invested refreshed, costBasis per Q3) — **no deletes**. The old
`source='CAS'` + `importKey=folio|amfi` are recorded in the commit/migration notes so it's reversible.
Applied in one `prisma.$transaction`. The CAS rows are converted, not duplicated.

## Data model

Likely **no new columns** — reuse `source`, `importKey`, `casStatus`, `costBasis`, `tickerName`,
`priceSource`. **Open Q4:** the `source` value for eCAS-MF — reuse `'ECAS'` (scoped by `type` in each
reconcile: stock reconcile filters `STOCK`, MF reconcile filters `MUTUAL_FUND`) vs a distinct
`'ECAS_MF'`. Reuse + type-scoping is simplest and the `@@unique([source, importKey])` still holds if
`folio|ISIN` (MF) never equals `boId|isin` (stock) — they won't (different ID formats). Recommend reuse
+ type scoping; confirm. `priceSource = 'ECAS'` (statement NAV) until an AMFI refresh (Q1-a) flips it.

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
- **(c) migration preserves user-adjusted cost basis:** an existing CAS MF row with a user-set
  `costBasis` migrates to eCAS-sourced **without** the basis being overwritten (merge); a null-basis CAS
  row gains the eCAS `amount_invested`. No duplicate row created (bridge matched).
- **(d) reconcile discipline:** absent fund flagged not deleted; idempotent re-import (no dupes);
  older-statement guard (409) / undateable (422).
- **(e) semantic reconciliation:** stored `costBasis = amount_invested` → `lib/wealth` P/L equals the
  eCAS Unrealised P/L on the sample (Canara Robeco 23.56%, etc.).
- **(f) MF gain/loss still renders** (coloured bars, real P/L) — the regression the chart drove this
  revisit for; `gainLossStatus` returns gain/loss (not striped) for an eCAS-MF row with a basis.
- **(g) firewall:** `lib/finance.ts` imports nothing here; `lib/ecas` imports no finance.

## Open questions (please answer before implementation)

- **Q1 — AMFI refresh:** keep daily NAV refresh via an ISIN→AMFI-code map (ticker=AMFI), or accept
  statement-date MF pricing (ticker=ISIN, AMFI MF-refresh retired)? **Reshapes the feature.** (Rec: keep.)
- **Q2 — migration bridge** CAS(`folio|amfi`) ↔ eCAS(`folio|ISIN`): folio+name, ISIN↔AMFI master map,
  and/or a preview/confirm step? (Rec: ISIN↔AMFI map + preview.)
- **Q3 — cost basis on migration** when the CAS row already has one: preserve+surface-discrepancy
  (rec), or prefer the eCAS figure?
- **Q4 — source value:** reuse `'ECAS'` (type-scoped) vs `'ECAS_MF'`. (Rec: reuse + type scope.)
- **Q5 — value source:** `units×NAV` (recompute) vs the eCAS `Valuation` column if rounding diverges.
- **Q6 — does the folio section actually omit the AMFI code?** (Confirm from the real page 9; if it's
  present, Q1/Q2 simplify enormously — ticker=AMFI directly, key bridge trivial.)

---

**On approval:** implement on `feat/ecas-mf-import` (parser + pure MF reconcile + migration + route + UI
+ tests), then a **DEEP review before commit** with the **CAMS/KFintech→eCAS migration preserving
user-adjusted cost basis on 91% of the portfolio** as the named must-break target. Each fix lands with
its regression test. Verify live on the real eCAS (the 5 schemes + the Grand Total reconcile).
