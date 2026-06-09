# AMFI Mutual-Fund Price Provider — Design Spec

**Date:** 2026-06-08 (refinements approved 2026-06-09)
**Status:** APPROVED — implementing. Points 1, 2, 4, 5 as specced; refinements (a)(b) and point-3 change folded in below.
**Goal:** A real `PriceProvider` for **mutual funds** backed by AMFI's published end-of-day NAV feed,
dropped in behind the existing interface, **env-gated** (`MARKET_DATA_PROVIDER=amfi`); `manualProvider`
stays the default. Stocks/"other" remain manual.

## Hard firewall (unchanged)

`lib/finance.ts` must **never** import `lib/market/`. The provider lives only in the market boundary;
the **seam** is: **API route → provider**. `lib/wealth.ts` (pure value math) imports neither the
provider nor anything that fetches — it keeps consuming `pricePerUnit` only. (Verified by grep in the
test/verify step.) A small **pure** staleness helper lives in `lib/market/staleness.ts` and is used by
the route + the wealth page/UI — never by `lib/finance.ts` or `lib/wealth.ts`.

## Data reality (baked in, not papered over)

- AMFI NAV is **end-of-day, once per business day — NOT real-time.** The UI says **"NAV as of
  <date> · end of day"** and never "Live". (Current `WealthAssetRow` shows "Live · …" for API prices —
  **this is fixed** as part of this work.)
- The feed (`https://www.amfiindia.com/spages/NAVAll.txt`) is a large `;`-delimited text dump of all
  schemes keyed by **AMFI scheme code**. For a mutual-fund asset, **`ticker` holds the AMFI scheme
  code** — the asset form gains help text saying so.

## Feed: fetch, parse, cache

- **Fetch once per refresh.** New `lib/market/amfi.ts` implements `getQuotes(tickers)`: **one**
  `fetch(AMFI_NAV_URL)`, parse the whole dump into `Map<schemeCode, Quote>`, then resolve the
  requested tickers. `getQuote(ticker)` exists for interface compliance and delegates to `getQuotes`.
- **Parse** (`parseNavAll(text)`, pure, exported for tests): split lines; a scheme line is
  `Scheme Code;ISIN1;ISIN2;Scheme Name;NAV;Date`. Keep lines where field[0] is a numeric scheme code
  and field[4] parses to a finite number; map → `{ price: Number(field[4]), asOf: parseAmfiDate(field[5]) }`.
  Skip headers / fund-house section lines / blanks / rows with non-numeric NAV (e.g. "N.A.").
- **Date — `DD-Mon-YYYY` (e.g. `14-May-2025`), parsed EXPLICITLY (refinement a).** `parseAmfiDate`
  regex-matches `DD-Mon-YYYY`, maps the 3-letter month name → index, builds `Date.UTC(y, m, d)` → ISO.
  **Never `new Date("14-May-2025")`** — that format's parsing is engine-dependent and would silently
  corrupt the stale check, which is the one signal protecting us from showing an old NAV as current.
  A row whose date doesn't match the pattern is skipped (not guessed). Staleness math also works off
  explicit UTC day components, never locale parsing. Test asserts a real `DD-Mon-YYYY` date classifies
  fresh/stale correctly end-to-end.
- **Cache:** module-level in-memory cache of the parsed map with a **30-minute TTL** (NAV changes at
  most once/day, so repeated refreshes within a window reuse the parse; avoids re-downloading several
  MB per click). Cache only **successful** parses; on fetch/parse failure, cache nothing (so the next
  refresh retries). Single-instance MVP — each process caches independently; noted, acceptable.

## Provider interface (backward-compatible extension)

```ts
export interface PriceProvider {
  readonly name: string;
  getQuote(ticker: string): Promise<Quote | null>;          // unchanged
  getQuotes?(tickers: string[]): Promise<Map<string, Quote | null>>; // NEW, optional (batch / fetch-once)
}
```
- `manualProvider`: `getQuote → null` (no `getQuotes`).
- `amfiProvider`: implements both; `getQuotes` **throws** on network/HTTP/parse failure (drives
  fail-safe), returns `Quote` for found scheme codes and `null` for not-found ones.
- `getPriceProvider()`: `process.env.MARKET_DATA_PROVIDER === 'amfi'` → `amfiProvider`; **absent or
  anything else → `manualProvider`** (the default).

## State machine (the failure paths are the point)

`POST /api/wealth/refresh-prices` (rewritten), wrapped by `withErrorHandling`:

1. Resolve provider. Load assets to refresh: **`type === 'MUTUAL_FUND'` and `ticker != null`** (AMFI is
   MF-only; stocks/other are never touched here).
2. **Fetch once, up front:** `quotes = provider.getQuotes(tickers)` (or, for `manualProvider`, an
   all-null map). This happens **before any DB write**.
3. Per asset:
   - **Found** → update `pricePerUnit = lastPrice = quote.price`, `priceUpdatedAt = quote.asOf`,
     `priceSource = 'API'`. If `isStale(quote.asOf)` → also add to `stale[]`.
   - **Not found** (`null`) → **do not touch the asset** (keep existing `pricePerUnit`/`value`); add to
     `notFound[]`.
4. Return `{ provider, checked, updated, stale: string[], notFound: string[] }` (names).

| Failure | Behavior |
|---------|----------|
| **Feed unreachable / HTTP error / parse failure** | `getQuotes` **throws** in step 2 → `withErrorHandling` → **500**, **zero DB writes** (we threw before the loop). Existing prices + `totalWealth` **unchanged**. **(refinement b)** AMFI has documented intermittent multi-day outages, so this path **will** fire in practice — kept exactly as specced (keep last good price). `NAV0.txt` on the portal subdomain is a known alternate source; **noted, not wired now** (no fallback implemented). |
| **Scheme code not in feed** | asset **not updated** (old price kept, never zeroed); listed in `notFound[]`; surfaced per-asset (below). |
| **Stale NAV** (asOf older than **N business days**, default **3**) | price **is** updated to the NAV, but flagged `stale`; UI shows a stale badge — never presents an old NAV as current. |
| **Any failure** | falls back to the **last good `pricePerUnit`**; **never** zero, **never** breaks `totalWealth`. |

`isStale(asOfIso, nowIso, n=3)` in `lib/market/staleness.ts`: counts **business days** (skips Sat/Sun;
holidays ignored for MVP — noted) between `asOf` and now; `> n` ⇒ stale. Pure, unit-tested.

## How "stale" and "couldn't update" surface (UI + totalWealth)

- **`totalWealth` / `assetValue`:** untouched by any failure — they read `pricePerUnit`, which we only
  ever overwrite with a real number on success. No failure path writes 0/null. (No `lib/wealth.ts`
  change.)
- **Stale (persistent, derived):** the wealth **page** computes `stale = priceSource==='API' &&
  isStale(priceUpdatedAt)` per asset and passes a `stale` flag to `WealthAssetRow`. The row shows an
  **amber "stale" pill** next to **"NAV as of <date> · end of day"**. Persistent because it's derived
  from the stored `priceUpdatedAt` — a scheme that stops updating naturally ages into "stale".
- **Couldn't update (persistent — point-3 change, approved):** a new nullable **`priceStatus`** column
  (`'OK' | 'NOT_FOUND' | null`) on `WealthAsset`. A scheme code that doesn't resolve is a **data-entry
  error the user must fix** — a transient toast vanishes on reload and the asset then silently never
  updates. So we persist it: refresh sets `priceStatus = 'NOT_FOUND'` on the asset (price untouched,
  never zeroed), `'OK'` on a successful price. The **row** shows an amber *"scheme code didn't
  resolve"* pill next to the ticker until fixed. Cleared to `null` on any manual save (POST/PUT) — the
  user editing the asset is the fix action. The refresh **response** still carries `notFound[]` so the
  button can name which assets failed **this** run; the persistent column is the durable signal.
  → adds a column + `db:push`; `PRICE_STATUSES` const in `lib/types.ts`.
- **Honesty:** API prices always render **"NAV as of <date> · end of day"** (the "Live" label is
  removed); manual prices render "Manual · <date>" as today.

## Asset form

`WealthAssetForm`: add help text under the Ticker field — *"For mutual funds, enter the AMFI scheme
code (used to fetch daily NAV)."* (Presentation only; one field, all types.)

## Env flag

`MARKET_DATA_PROVIDER=amfi` selects AMFI. Absent / any other value → `manualProvider`. Add
`MARKET_DATA_PROVIDER` to `.env`/docs as commented/off by default (so existing installs keep
`manualProvider` with no behavior change).

## Files

- **New:** `lib/market/amfi.ts` (`amfiProvider`, `parseNavAll`, `parseAmfiDate`, `AMFI_NAV_URL`, cache),
  `lib/market/staleness.ts` (`isStale`, `businessDaysBetween`).
- **Modify:** `lib/market/provider.ts` (add optional `getQuotes`, env-gate `getPriceProvider`),
  `app/api/wealth/refresh-prices/route.ts` (fetch-once, state machine, richer response, MF-only),
  `app/wealth/page.tsx` (compute + pass `stale`), `components/wealth/WealthAssetRow.tsx` ("NAV as of …
  · end of day" + stale pill, stop saying "Live"), `components/wealth/RefreshPricesButton.tsx` (summary
  incl. stale/not-found), `components/wealth/WealthAssetForm.tsx` (AMFI scheme-code hint).
- **Modify (point-3 change):** `prisma/schema.prisma` (+`priceStatus String?`), `lib/types.ts`
  (`PRICE_STATUSES`, `priceStatus` on `WealthAsset`), `lib/data.ts` (map `priceStatus`),
  `app/api/wealth/route.ts` + `app/api/wealth/[id]/route.ts` (clear `priceStatus` on manual save),
  `lib/format.ts` (`formatDay` for honest NAV date).
- **Unchanged:** `lib/finance.ts`, `lib/wealth.ts`, `lib/dashboard.ts`, all Planning routes.

## Test matrix (mock the feed; NO live network)

`lib/__tests__/market.test.ts` (extend) / new `lib/__tests__/amfi.test.ts`:
- **parse** a representative `NAVAll.txt` sample (header + 2 fund-house sections + a `N.A.` row) →
  correct `Map` (scheme→{price, asOf ISO}); junk/header/`N.A.` lines skipped.
- **scheme-found happy path:** `getQuotes(['<known>'])` with `fetch` stubbed to the sample → `Quote`
  with right price + ISO asOf.
- **scheme-not-found:** `getQuotes(['999999'])` → `null` for that key (asset would be left untouched).
- **network-error fail-safe:** `fetch` rejects / `{ok:false}` → `getQuotes` **throws** (asserted).
- **stale-NAV:** `isStale` — asOf 5 business days ago → true; today/1 business day → false; weekend math.
- **env gating:** `getPriceProvider()` → `amfi` when `MARKET_DATA_PROVIDER=amfi`, else `manual`
  (stub `process.env`).
- **route state machine** (extend `routes-unit.test.ts`, mock `getPriceProvider`): provider throwing →
  500 + **no `prisma.wealthAsset.update`** called; provider returning mixed found/not-found map →
  `update` only for found, response lists `notFound`/`stale`.
- Mocking: `vi.stubGlobal('fetch', …)` with a `text()`-bearing Response stub; no real network.

## Verification

Isolated copy: full suite green (report new total ≈ **115 + ~10**), `npm run build` clean. Confirm:
`getPriceProvider()` is `manualProvider` when `MARKET_DATA_PROVIDER` is absent (default unchanged);
firewall grep (`lib/finance.ts` imports no `market`; `lib/wealth.ts` imports no provider); list changed
files.

---

**Approval requested on:** (1) the **fetch-once `getQuotes` extension** + 30-min cache; (2) the
**state machine** (throw-before-write fail-safe, not-found leaves asset untouched, stale-but-updated);
(3) **stale = derived/persistent, "couldn't update" = transient summary (no schema column)** — vs.
adding a persistent `priceStatus` field; (4) **N = 3 business days** for stale; (5) removing the "Live"
label in favor of "NAV as of <date> · end of day". On approval I implement + report.
