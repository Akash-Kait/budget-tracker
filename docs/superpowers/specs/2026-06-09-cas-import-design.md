# CAS (Consolidated Account Statement) Import — Design Spec

**Date:** 2026-06-09
**Status:** AWAITING APPROVAL — do not implement until approved.
**Goal:** Let the user upload a CAMS/KFintech **CAS PDF** and have their **mutual-fund** holdings
auto-populate / update as `WealthAsset` rows — "stop entering every fund by hand." MF only. The
payoff is the **AMFI scheme code** per scheme: written as `ticker`, it lets the existing AMFI provider
([2026-06-08-amfi-price-provider-design.md]) revalue the holding on every later refresh.

This builds directly on the AMFI work: CAS seeds `ticker` (= AMFI code), `quantity`, an initial
`pricePerUnit`/`priceUpdatedAt` from the statement, and `tickerName`; thereafter
`POST /api/wealth/refresh-prices` (amfi provider) keeps NAVs live.

---

## Hard constraints (unchanged from the codebase)

- **Planning/Wealth firewall:** Wealth-only. `lib/finance.ts` is untouched and imports nothing new.
  CAS code lives in the Wealth/market side.
- **MF only:** rows of `type` `STOCK`/`OTHER` are **never** read, updated, flagged, or deleted by CAS.
- **Auto-write, but reconcile — never blind-replace, never auto-delete.** Holdings present in the app
  but **absent** from the uploaded CAS are **flagged**, not removed.
- **Idempotent:** re-uploading next month's CAS **updates** existing rows by a stable key — no
  duplicates.
- **Money safety:** never fake data — cost basis only when the CAS provides it; don't zero a holding.
- Tests stay green (current total **144**); build clean.

---

## New runtime dependency (flag this — it's an architectural shift)

The app is pure Node today. **Accurate CAS parsing has no maintained JS library**; the de-facto tool
is the Python package **`casparser`** (codereverser/casparser, PyPI, MIT). So this feature introduces
a **Python sidecar** invoked only by the CAS-import route — the rest of the app needs no Python.

- **MIT parser ONLY.** Do **not** install/enable the `casparser[mupdf]` / PyMuPDF extra (GPL/AGPL).
  The default pure-Python text parser is MIT and sufficient for CAMS/KFintech CAS PDFs.
- `casparser.read_cas_pdf(file, password)` → dict with `folios[].schemes[]` carrying scheme name,
  `open`/`close` units, `valuation` (date + nav + value), `rta_code`, and (v0.4.3+) **`amfi`** (AMFI
  scheme code) + `isin` per scheme. We require a version exposing `amfi`.
- Setup documented in ARCHITECTURE.md + a `scripts/requirements.txt` (`casparser>=0.x` pinned, no
  extras). A dedicated venv (`scripts/.venv`) is recommended so the app's Python dep is isolated.

---

## Architecture & data flow

```
/wealth (CasImportPanel) --multipart(PDF,password)--> POST /api/wealth/import-cas
   route (withErrorHandling):
     1. read FormData (file + password), validate (PDF mime, size cap e.g. 15MB)
     2. spawn python3 scripts/cas_parse.py  ── sidecar boundary (I/O), analogous to amfi.ts
          stdin:  "<password>\n" then raw PDF bytes      (NO temp file, NO argv/env secret)
          stdout: JSON { schemes:[{amfi,isin,rta,folio,name,units,nav,navDate,value,cost?}], statementDate }
          stderr: diagnostics (never the PDF/password/PII)
          exit:   0 ok · 2 bad-password · 3 parse-error · 4 casparser-missing · 5 python-bad
     3. Zod-validate the sidecar JSON (casParsedSchema)
     4. reconcile(existingAssets, parsed)  ── PURE fn in lib/cas/reconcile.ts (no DB, no provider)
          → { creates[], updates[], flaggedAbsent[] }
     5. apply the plan in ONE prisma.$transaction (create / update / set casStatus)
     6. return summary { created, updated, flaggedAbsent, statementDate }
```

- **Sidecar invocation:** `child_process.spawn('python3', [SCRIPT], { stdio: ['pipe','pipe','pipe'] })`
  via a venv python if present (`scripts/.venv/bin/python`), else `python3`. Apply a **kill timeout**
  (e.g. 30s, mirroring the AMFI `AbortSignal` pattern) so a hung parse can't wedge the request.
- **Why stdin bytes, not a temp file:** the PDF holds PAN + full holdings. Passing bytes on stdin
  keeps it **in-memory only** — nothing hits disk. Password is the **first stdin line**, never argv
  (visible in `ps`) and never an env var (readable via `/proc`). If `read_cas_pdf` cannot accept a
  file-like object in the pinned version, **fallback:** write a `0600` temp file, parse, and
  `unlink` it in a `finally` — surfaced as a decision below.
- **Privacy:** the route maps ONLY the MF fields it needs; it never persists the raw JSON, PAN, or
  any PII, and never `console.log`s the PDF/password/parsed contents. `withErrorHandling` already
  prevents stack/detail leakage to the client.

---

## Sidecar error handling (failure paths are first-class)

| Condition | Detection | Route result |
|-----------|-----------|--------------|
| `python3` / venv missing | spawn `ENOENT` | **501** "CAS import needs Python — see setup" (actionable, not a crash) |
| `casparser` not installed | script exit **4** (ImportError) | **501** "casparser not installed (`pip install casparser`)" |
| Wrong / missing password | script exit **2** | **400** "Password incorrect, or this isn't a recognized CAS" |
| Unparseable / not a CAS / no schemes | script exit **3** | **422** "Couldn't read this CAS PDF" |
| Sidecar timeout | killed after 30s | **504** "CAS parse timed out" |
| Sidecar JSON fails Zod | validation | **422** (generic) |

All failures change **nothing** in the DB (parse happens before the transaction). The script writes a
small structured `{"error": "...code..."}` to stdout on the handled exits so Node maps cleanly.

---

## Reconciliation rules (`lib/cas/reconcile.ts`, pure & unit-tested)

Signature (pure, no I/O — the testable heart):
```
reconcile(existing: WealthAsset[], parsed: CasParsed, nowIso): {
  creates: NewAssetInput[];          // type MUTUAL_FUND, source CAS
  updates: { id; data }[];           // matched rows
  flaggedAbsent: { id; name }[];     // CAS-managed rows not in THIS statement
}
```

**Match key (stable, for idempotency):** a per-row `importKey` =
- the **AMFI scheme code** when present (preferred), else
- `folio|schemeName` (fallback for schemes lacking an AMFI code).

**Scope:** reconciliation considers ONLY `existing` rows where `type === 'MUTUAL_FUND'`. Within those:

1. **Match** each CAS scheme to an existing MF row by `importKey`.
   - **Found → update**: `quantity` (close units), `pricePerUnit` + `priceUpdatedAt` (CAS NAV + date),
     `tickerName` (CAS scheme name), `ticker` (AMFI code), `costBasis` (if CAS provides it; else
     **leave existing untouched** — never overwrite a real basis with null), `source='CAS'`,
     `casStatus='CURRENT'`. **No duplicate** is created — this is what makes re-upload idempotent.
   - **Not found → create**: a new MF row, `source='CAS'`, `importKey` stored, all fields above.
2. **Flag absent**: any existing `source==='CAS'` MF row whose `importKey` is **not** in this CAS →
   `casStatus='ABSENT'` ("not in latest CAS"). **Never deleted.** (A row the user later re-acquires
   re-appears in a future CAS and flips back to `CURRENT`.)
3. **Never touched:** `STOCK`/`OTHER` rows, and `MANUAL` MF rows that don't match any CAS `importKey`
   (a hand-entered fund the user keeps separately stays manual and unflagged).

**Claiming a manual row (decision below):** if a CAS scheme's `importKey` matches a `source!=='CAS'`
MF row (e.g. the user hand-entered the same fund with its AMFI code as ticker), the **recommended**
behavior is to **adopt** it: update + set `source='CAS'` so it's reconciled thereafter. Alternative:
leave manual rows alone and create a CAS row (risking a visible "duplicate"). Recommending adopt.

---

## Data mapping (CAS scheme → WealthAsset)

| WealthAsset field | From CAS | Notes |
|---|---|---|
| `type` | — | always `MUTUAL_FUND` |
| `name` | scheme name | trimmed |
| `ticker` | `amfi` | **the payoff** — enables AMFI revaluation |
| `quantity` | `close` units | drives `assetValue = qty × pricePerUnit` |
| `pricePerUnit` | `valuation.nav` | so value is correct immediately, before any refresh |
| `value` | — | left `null` (qty×price drives it) |
| `priceUpdatedAt` | `valuation.date` | honest "as of the statement"; feeds the stale check |
| `priceSource` | — | **decision below**: `'CAS'` (new) vs `'API'` vs leave |
| `tickerName` | scheme name | echo so a wrong AMFI code stays visible (AMFI work) |
| `costBasis` | invested amount **if present** | else leave unset — never faked |
| `purchaseDate` | — | left `null` (a multi-buy holding has no single date) |
| `source` | — | `'CAS'` |
| `importKey` | amfi else folio\|scheme | stable match/idempotency key |
| `casStatus` | — | `'CURRENT'` on import; `'ABSENT'` when flagged |

After import, the AMFI provider overwrites `pricePerUnit`/`priceUpdatedAt`/`priceSource`/`tickerName`
with live NAVs on the next refresh — CAS seeds, AMFI maintains.

---

## Schema change (decision)

**Recommended (minimal): three nullable columns + one index** on `WealthAsset`:
- `source String?` — `'CAS' | 'MANUAL'` (null = legacy/manual). Scopes what reconciliation may touch.
- `importKey String?` — stable reconciliation key (`@@index([importKey])`). The idempotency backbone.
- `casStatus String?` — `'CURRENT' | 'ABSENT'` (the "not in latest CAS" flag), null for non-CAS.

`lib/types.ts` gets `SOURCES`/`CAS_STATUSES` consts + the three fields on `WealthAsset`; `lib/data.ts`
maps them. **Requires `db:push`** (additive, nullable, non-destructive — same migration story as
`priceStatus`/`tickerName`).

**Open sub-decisions:**
- (a) Add `'CAS'` to `PRICE_SOURCES` so the row honestly reads "Units & NAV from CAS as of <date>"
  until AMFI takes over? (recommend **yes** — small label branch in `WealthAssetRow`.)
- (b) Adopt-vs-leave for a manual row matched by `importKey` (recommend **adopt**).
- (c) Whether to also store `casFolio`/`casAsOf` separately (recommend **no** — `priceUpdatedAt`
  carries the statement date; `importKey` carries folio when needed).

---

## UI (Wealth page only)

A `CasImportPanel` (new component) on `/wealth`: file picker (`.pdf`) + password field + "Import" →
`POST /api/wealth/import-cas` → shows the summary toast ("Imported 4 new · updated 7 · 2 not in this
CAS"). Rows flagged `casStatus==='ABSENT'` get an amber **"not in latest CAS"** pill (reusing the
`--warning` token, same pattern as `NOT_FOUND`/stale). Honest copy: the password is used once,
server-side, never stored. No change to Planning.

---

## Test matrix (SAMPLE/REDACTED parsed-JSON fixture — NEVER a real CAS PDF)

**Pure `reconcile` (no Python, the core coverage):**
1. **New-holding create** — scheme not in app → `creates` has it, `source='CAS'`, ticker=amfi.
2. **Existing update by AMFI key** — units/nav updated on the matched row; no entry in `creates`.
3. **Fallback key** — scheme without `amfi` matches existing by `folio|scheme`.
4. **Absent-from-CAS flag** — a `source='CAS'` row missing from the CAS → `flaggedAbsent`, **not** deleted.
5. **Non-MF untouched** — STOCK/OTHER rows never appear in any bucket.
6. **Re-upload idempotency** — feeding the same fixture twice yields the same row set, **no dupes**.
7. **Cost basis** — set when the fixture provides it; existing basis preserved (not nulled) when absent.
8. **Manual-row adopt** (per decision b) — a manual MF matched by key is updated + `source='CAS'`.

**Route / sidecar (mock `child_process.spawn`):**
9. **Parse-failure path** — sidecar exit 3 → 422, no DB writes.
10. **Python-missing path** — spawn `ENOENT` → 501, no DB writes.
11. **Wrong-password path** — exit 2 → 400.
12. **Success path** — mocked sidecar JSON → reconcile applied in a `$transaction`, summary returned.
13. (assert privacy) temp-file fallback path unlinks the file; no PDF/password in any logged output.

A tiny fixture `lib/__tests__/fixtures/cas-sample.json` (redacted, synthetic — no real PAN/folios).

---

## Files (planned)

- **New:** `scripts/cas_parse.py` (thin casparser wrapper, stdin protocol, structured exits),
  `scripts/requirements.txt`; `lib/cas/sidecar.ts` (spawn boundary + error mapping),
  `lib/cas/reconcile.ts` (pure), `lib/cas/types.ts` + `casParsedSchema` (Zod);
  `app/api/wealth/import-cas/route.ts`; `components/wealth/CasImportPanel.tsx`;
  `lib/__tests__/cas-reconcile.test.ts`, `lib/__tests__/cas-route.test.ts`, fixture JSON.
- **Modify:** `prisma/schema.prisma` (+`source`,`importKey`,`casStatus`,index), `lib/types.ts`,
  `lib/data.ts` (map new fields), `components/wealth/WealthAssetRow.tsx` (ABSENT pill + optional CAS
  price label), `app/wealth/page.tsx` (mount panel), `docs/ARCHITECTURE.md` (Python setup + run step).
- **Unchanged:** `lib/finance.ts`, `lib/wealth.ts`, `lib/market/*`, all Planning routes.

## Verification

Isolated copy: full suite green (report new total ≈ **144 + ~13**), `npm run build` clean. Confirm:
firewall (`lib/finance.ts` imports nothing CAS/market), non-MF rows untouched, re-upload idempotency,
no PII/secret logging, manual default unaffected. List changed files.

---

## Deep-review fast-follow backlog (2026-06-09)

12-perspective review ran before commit. Fixed in this change: **P0** older-statement rewind (route
409 recency guard), **P0** folio-qualified `importKey` (two folios / shared AMFI code no longer
collide; ISIN now precedes name), **P1** `stdin` EPIPE crash guard, **P1** skip exited/zero-unit
schemes + derive NAV from value + never null an existing price/qty (parser + reconcile), **P1** cost
read from multiple casparser keys + a pure `map_cas` with `scripts/test_cas_parse.py`. Deferred (safe
behind the manual default + intact firewall) — **fold into the next branch touching `lib/cas/`:**

1. **Full subprocess-seam tests** — `cas-route.test.ts` mocks `runCasParser`, so `sidecar.ts` (stdin
   framing, exit→CasError map, BAD_OUTPUT, ENOENT, TIMEOUT+kill) has no direct coverage. Add a
   `sidecar.test.ts` driving a fake interpreter stub; assert the spec's privacy item (no PDF/password
   logged, temp file unlinked).
2. **Non-MF instrument filter** — a consolidated CAS can carry NPS/ETF/SGB; the parser currently tags
   every scheme `MUTUAL_FUND`. Gate on `amfi` present or an `INF…` ISIN.
3. **Ops signal** — broaden the Python `import casparser` catch (non-`ImportError` env breakage →
   exit 4, not a misleading 422); log `CasError.code` (PII-free) at the route so failures are
   diagnosable.
4. **Module-relative script path** — `process.cwd()`-relative `SCRIPT`/`VENV_PY` break under
   standalone/non-root cwd; resolve via `import.meta.url`. Document CAS import as Node-server-only.
5. **Result names + preview** — return the reconcile plan (created/updated/flagged *names*, old→new
   units) so the toast can name flagged funds and a future dry-run/confirm step is cheap.
6. **`ticker`-less rows never revalue / never flag stale**; **ABSENT** pill tone + still counted in
   totals + not cleared on manual edit; **`as unknown as` cast → `select` projection**; minimal
   subprocess `env`; cap stdout; `BAD_OUTPUT`→502 not 422; reconcile/`schema.prisma` comment drift
   (`priceSource` now MANUAL|API|CAS); `requirements.txt` version-comment; explicit `0600` on the
   temp file; MIT-parser runtime guard; type `CasUpdate.data`.

(Full report at commit time: `REVIEW.md` — overwritten by each `/review`, hence this backlog lives here.)

---

**Approval requested on:** (1) the **Python `casparser` sidecar** (MIT parser only, no mupdf) as the
parser, and the **stdin-bytes / password-first-line** invocation (vs temp-file fallback); (2) the
**reconciliation rules** (match by `importKey` = AMFI-else-folio\|scheme; create/update/flag-absent;
never delete; never touch non-MF); (3) the **schema**: `source` + `importKey` + `casStatus` (+ index),
and sub-decisions (a) add `'CAS'` to `PRICE_SOURCES`, (b) **adopt** a manual row matched by key,
(c) no separate `casFolio`/`casAsOf`; (4) the **test matrix** (fixture-based, no real CAS). On
approval I implement + report (suite total, build, changed files).
