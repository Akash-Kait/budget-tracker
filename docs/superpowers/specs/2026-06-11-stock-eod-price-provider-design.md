# Stock EOD price provider (nselib) — Design Spec

**Date:** 2026-06-11
**Status:** AWAITING APPROVAL — spec only, no code.
**Branch:** `feat/stock-eod-nse` (off `main` @ `b0775f6`).

---

## 1. Goal

Refresh **STOCK** prices to **end-of-day close** from NSE via **nselib**, behind the existing
`PriceProvider` seam, env-gated like AMFI. Today the refresh updates mutual funds only (AMFI = NAVs);
stocks hold at their eCAS statement-date price. This adds the equity source the earlier phase deferred.

POC outcome: live-quote sources are blocked (yfinance cert errors, Yahoo crumb/429, NSE live
`JSONDecodeError`), but **nselib's EOD/bhavcopy path works 12/12, free, no credential, next-day-fresh**
(latest close = previous trading day). EOD is the right granularity — value-framed dashboard, daily
refresh, honest "as of `<date>` · close" (exactly the AMFI-NAV model). No live/intraday.

## 2. What exists (reuse, don't reinvent)

- `lib/market/provider.ts` — `PriceProvider` seam; `getPriceProvider()` returns `amfi` (MF NAVs) or
  `manual` based on `MARKET_DATA_PROVIDER`. `Quote = { price, asOf(ISO), name? }`.
- `lib/market/amfi.ts` — the honesty template: fetch once, explicit `DD-Mon-YYYY`→ISO date parse,
  throw on feed failure (caller fails safe), `null` per-ticker miss, stale via `isStale`.
- `lib/ecas/sidecar.ts` — the Python-sidecar spawn pattern (stdin in, JSON out, timeout-kill, stderr
  swallowed, structured errors). `scripts/requirements.txt` — pinned MIT-only deps.
- `app/api/wealth/refresh-prices/route.ts` — refreshes `type: 'MUTUAL_FUND'` via `getPriceProvider`;
  feed failure → 500 no-write; per-ticker miss → keep price + `priceStatus=NOT_FOUND`; stale flagged.

## 3. Architecture

```
refresh-prices route ──┬─ MF rows  → getPriceProvider()        → amfi (HTTP NAVAll)
                       └─ STOCK rows → getEquityPriceProvider() → nse (sidecar)
                                                                    │
                            lib/market/nse.ts  (ISIN→symbol map, Date parse, ClosePrice extract)
                                                                    │  spawn, symbols via stdin
                            scripts/nse_quote.py → nselib.capital_market.price_volume_data per symbol
                                                  → { SYMBOL: { close, date } | null } JSON
```

- **New equity seam:** `getEquityPriceProvider()` resolves `EQUITY_DATA_PROVIDER`: `nse` → the nselib
  provider; absent/anything → `manualProvider` (no-op; no behavior change for existing installs). MF
  stays on `getPriceProvider()`/`MARKET_DATA_PROVIDER` — the two seams are independent.
- **`lib/market/nse.ts`** (`nseProvider: PriceProvider`): `getQuotes(isins)` maps each ISIN→NSE symbol
  via a static map, spawns the sidecar with the symbol list, parses its JSON, and returns
  `Map<ISIN, Quote|null>` (ISIN not in map, or symbol returned no data → `null`). It owns the
  ClosePrice/latest-row/Date-parse rules (§4) so they're unit-testable without the network.
- **`scripts/nse_quote.py`** (sidecar, mirrors the eCAS pattern): reads a JSON symbol list on stdin,
  calls `nselib.capital_market.price_volume_data(symbol, period/from-to)` per symbol, emits
  `{ "SYMBOL": { "close": <ClosePrice>, "date": "<DD-Mon-YYYY>" } }` (or omits a symbol that errored /
  returned empty). Structured exit codes (ok / nselib-missing / fetch-error). In-memory; no PII.
- **Refresh route fan-out:** query MF rows AND STOCK rows; resolve MF via the MF provider and STOCK via
  the equity provider; apply both in the existing per-asset transaction. Each provider fails safe
  independently (one source down doesn't block the other). Stocks update **value only** (no cost
  basis → still no gain/loss — consistent with the hide-gain/loss decision).

## 4. CRITICAL data-mapping rules (silent-corruption traps the POC exposed)

These are the named deep-review must-breaks — each is silent-wrong-but-plausible if mis-done.

1. **Use `ClosePrice`, NEVER `PrevClose`.** The nselib frame has `PrevClose`, `LastPrice`,
   `ClosePrice`. A substring/"close" match grabs `PrevClose` = the PREVIOUS day's close → every stock
   silently off by one day, looking entirely normal. Read **`ClosePrice`** by exact column name.
   *(Decision: use `ClosePrice` — the official daily close, the right EOD value. `LastPrice` ≈ same at
   EOD but is "last traded"; we standardize on `ClosePrice` and document it. NEVER `PrevClose`.)*
2. **Latest row = `max(Date)`, NOT `iloc[-1]`.** The frame is sorted DESCENDING (newest first), so
   `iloc[-1]` is the OLDEST row. Select by parsing every row's Date and taking the **max** — never by
   position. (Defensive against a future sort-order change too.)
3. **Explicit Date parse.** Parse the row Date (`"11-Jun-2026"` style) via an explicit month-map to
   ISO (the AMFI/eCAS lesson — never a locale parser; reuse/clone `parseAmfiDate`-style logic). That
   ISO date is the honest "as of `<date>` · close" label and the stale-check input.

## 5. Provider requirements (mirror AMFI honesty discipline)

- **ISIN→symbol:** a static map keyed by ISIN for the 12 validated stocks — `ADANIENSOL, ADANIPORTS,
  ADANIPOWER, BAJAJ-AUTO, BHARTIARTL, CUB, DLF, ICICIBANK, ICICIGI, ITC, MARUTI, SBIN`. ISIN not in
  the map → `null` → the route sets a **visible `NOT_FOUND`** (never guessed/skipped). A 13th stock
  won't refresh until its ISIN→symbol is added — surfaced via NOT_FOUND, not silent. *(Flag: static
  map is the MVP; a dynamic ISIN→symbol lookup is a later option.)*
- **Failure = LOUD, never stale-as-current.** nselib throws / NSE blocks / empty frame / a symbol
  returns no rows → the provider `getQuotes` throws (whole-batch failure → route 500, no write, all
  prices untouched) OR returns `null` for that symbol (per-symbol miss → keep last price + real as-of
  date, set `NOT_FOUND`). Never zero a price; never present a stale price as current. Same fail-safe
  the AMFI path already has + tests.
- **Stale detection:** reuse the `isStale` (> N business days) pill. The wealth row's as-of label must
  read **"as of `<date>` · close"** for a stock (NOT "NAV as of"). *(Decision to confirm in §8.)*
- **Sidecar isolation:** nselib runs only in the Python sidecar; a crash/timeout is a **visible**
  failure (structured error → 500 / NOT_FOUND), never a silent freeze. Timeout-kill like the eCAS
  sidecar. In-memory; symbols aren't PII; stderr swallowed; **firewall intact** (`lib/finance.ts`
  imports nothing market; `lib/market/nse.ts` imports no finance).
- **Value only:** refreshed stock price updates `pricePerUnit`/`lastPrice`/`priceUpdatedAt`; stocks
  have no cost basis → no gain/loss shown (unchanged). Confirm the refreshed value flows to the
  treemap + totals (they read `assetValue` = qty×price).

## 6. Deep-review named must-breaks
1. **`ClosePrice` vs `PrevClose`** — the off-by-one-day silent corruption. Regression test: a fixture
   frame where `PrevClose != ClosePrice`, assert `ClosePrice` is taken.
2. **Latest row by `max(Date)`, not `iloc[-1]`** — a descending-sorted fixture; assert the newest
   date's price is used (not the oldest).

## 7. Tests
- `ClosePrice` (not `PrevClose`) is the price used (fixture: PrevClose ≠ ClosePrice).
- latest row = max(Date) on a descending fixture (not iloc[-1]).
- ISIN→symbol not in map → visible `NOT_FOUND`.
- sidecar failure / empty frame → throws (route 500, nothing written) or per-symbol NOT_FOUND; value
  never zeroed; never stale-as-current.
- Date parse `DD-Mon-YYYY`→ISO explicit (bad/locale formats rejected).
- firewall: no finance import; refresh route fan-out applies both providers in one pass.
- (Pure tests on `lib/market/nse.ts` parse/map logic via fixture frames — no network, mirroring
  `amfi.test.ts`. Python sidecar's pure mapping unit-tested without nselib where feasible.)

## 8. Decisions — LOCKED
1. **`ClosePrice`** read by EXACT column name (never `PrevClose`, never a substring match). It is the
   official settled close; chosen over `LastPrice`.
2. **Separate `EQUITY_DATA_PROVIDER=nse` seam** + refresh fan-out by type (MF→AMFI, STOCK→NSE), each
   failing independently. Not a composite.
3. **Add a real `priceSource: 'NSE'`** (additive enum value, like `'ECAS'` was), set on refresh. The
   as-of label derives from `priceSource`, NOT asset type — a stock's price has two provenances:
   `'ECAS'` (statement-date import price, pre-refresh) → "as of `<date>` · eCAS", and `'NSE'`
   (refreshed close) → "as of `<date>` · NSE close". Type can't distinguish them; `priceSource` can.
   `isStale` applies to `'NSE'` rows too.
4. **nselib `2.5.1`, Apache-2.0** (permissive — fine to bundle). Pin in `scripts/requirements.txt`.
   Pulls in pandas/scipy/pandas-market-calendars (heavier sidecar — fine). Use **`period='1M'`** (not
   from/to) to sidestep the date-window entirely; take the **max-Date** row from the returned frame.

All ClosePrice/latest-row/Date-parse logic lives in `lib/market/nse.ts` (pure, unit-tested via fixture
frames); `scripts/nse_quote.py` is a thin nselib→records JSON bridge.

## 9. Live-verify acceptance
With `EQUITY_DATA_PROVIDER=nse`: refresh updates all 12 stocks to the latest close, each labelled
"as of `<date>` · close"; values flow to treemap + totals; an induced sidecar failure shows
visible-stale / NOT_FOUND (never a silent freeze, never zeroed). Then deep review (the two must-breaks)
→ commit.
