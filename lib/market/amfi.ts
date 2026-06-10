// AMFI mutual-fund NAV provider. Backs the PriceProvider seam with AMFI's published
// end-of-day NAV dump (https://www.amfiindia.com/spages/NAVAll.txt). NAV is END-OF-DAY, once
// per business day — never real-time; the UI surfaces "NAV as of <date> · end of day".
// Selected only when MARKET_DATA_PROVIDER=amfi; otherwise the manual provider stays default.
import type { PriceProvider, Quote } from './provider';

// Canonical endpoint. The legacy `www.amfiindia.com/spages/NAVAll.txt` now 302-redirects here; a
// source that has begun redirecting is migrating, so we point directly at the resolved target rather
// than rely on the old redirect persisting (it's a retirement candidate). Confirmed final URL.
export const AMFI_NAV_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt';
// NOTE: AMFI has documented intermittent multi-day outages, so the fail-safe (throw → route 500, NO
// write → keep last good price at its honest "as of" date, flagged stale after N business days)
// fires in practice. Downtime is handled by failing safe + visible staleness, never a silent freeze.

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/**
 * Parse AMFI's `DD-Mon-YYYY` date (e.g. "14-May-2025") EXPLICITLY to an ISO string.
 * Never via `new Date(string)` — parsing of this format is engine-dependent and would silently
 * corrupt the stale check (our one guard against showing an old NAV as current). Returns null
 * for anything that doesn't match, so a bad date drops the row rather than guessing.
 */
export function parseAmfiDate(s: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const mon = MONTHS[m[2][0].toUpperCase() + m[2].slice(1).toLowerCase()];
  const year = Number(m[3]);
  if (mon === undefined || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, mon, day));
  // Reject impossible dates that JS would silently roll over (e.g. 31-Feb -> 3-Mar, which would
  // produce a future asOf that reads "fresh" forever). The contract is DROP, not guess.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== mon || d.getUTCDate() !== day) return null;
  return d.toISOString();
}

/**
 * Parse the full NAVAll dump into `Map<schemeCode, Quote>`. Pure (no I/O), exported for tests.
 * A scheme line is `Scheme Code;ISIN1;ISIN2;Scheme Name;NAV;Date`. Skips headers, fund-house
 * section titles, blank lines, rows with a non-positive/non-numeric NAV ("N.A.", "", 0), and rows
 * with an unparseable date. NAV and date are read from the RIGHT, and the name is everything
 * between the ISINs and the NAV — so a ';' inside a scheme name can't shift the columns.
 */
export function parseNavAll(text: string): Map<string, Quote> {
  const out = new Map<string, Quote>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || !line.includes(';')) continue;
    const f = line.split(';');
    if (f.length < 6) continue;
    const code = f[0].trim();
    if (!/^\d+$/.test(code)) continue; // scheme code is numeric — drops header/section lines
    const navStr = f[f.length - 2].trim();
    // Drop empty / non-positive / non-numeric NAV. CRITICAL: Number("") === 0 is finite, so without
    // the `<= 0` guard an empty NAV field would be written as 0 and silently ZERO the holding's
    // value in totalWealth. Dropping the row makes it a "not-found" → last good price is kept.
    if (navStr === '') continue;
    const price = Number(navStr);
    if (!Number.isFinite(price) || price <= 0) continue;
    const asOf = parseAmfiDate(f[f.length - 1]);
    if (!asOf) continue;
    const name = f.slice(3, f.length - 2).join(';').trim() || undefined;
    out.set(code, { price, asOf, name });
  }
  return out;
}

/**
 * Index `ISIN → scheme code` from the feed's two ISIN columns (`f[1]`, `f[2]`). Pure, exported for
 * tests. Lets a holding identified only by ISIN (eCAS folio MF rows) resolve to its AMFI scheme code
 * — for both NAV refresh and the CAS→eCAS migration bridge — straight from live data, no static map.
 */
export function parseNavIsinIndex(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || !line.includes(';')) continue;
    const f = line.split(';');
    if (f.length < 6) continue;
    const code = f[0].trim();
    if (!/^\d+$/.test(code)) continue;
    for (const isin of [f[1], f[2]]) {
      const v = (isin ?? '').trim().toUpperCase();
      if (/^IN[A-Z0-9]{10}$/.test(v)) out.set(v, code);
    }
  }
  return out;
}

// One parse per refresh; cache it ~30 min across refreshes (NAV changes at most once/day) to avoid
// re-downloading several MB on repeated clicks. Single-instance MVP — each process caches its own.
const TTL_MS = 30 * 60 * 1000;
let cache: { at: number; byCode: Map<string, Quote>; isinToCode: Map<string, string> } | null = null;

/** For tests only — drop the cached parse. */
export function __clearAmfiCache(): void {
  cache = null;
}

async function loadNav(): Promise<{ byCode: Map<string, Quote>; isinToCode: Map<string, string> }> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  // Throws on network failure (rejected fetch), timeout, HTTP error, or an empty/garbage parse. The
  // route calls this BEFORE any DB write, so a throw leaves every price + totalWealth untouched.
  // The timeout matters: AMFI's documented outages include STALLED connections (accept, never
  // respond), which without an AbortSignal would hang the request forever and bypass the fail-safe.
  const res = await fetch(AMFI_NAV_URL, {
    headers: { accept: 'text/plain' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`AMFI feed HTTP ${res.status}`);
  const text = await res.text();
  const byCode = parseNavAll(text);
  if (byCode.size === 0) throw new Error('AMFI feed parsed to zero schemes');
  cache = { at: Date.now(), byCode, isinToCode: parseNavIsinIndex(text) };
  return cache;
}

/**
 * Resolve ISINs → AMFI scheme codes from the live feed (null when the feed doesn't carry the ISIN —
 * e.g. a brand-new fund). Used by the eCAS-MF migration bridge; a null is surfaced, never guessed.
 */
export async function resolveAmfiCodes(isins: string[]): Promise<Map<string, string | null>> {
  const { isinToCode } = await loadNav();
  const out = new Map<string, string | null>();
  for (const isin of isins) out.set(isin, isinToCode.get(isin.trim().toUpperCase()) ?? null);
  return out;
}

export const amfiProvider: PriceProvider = {
  name: 'amfi',
  // Batch: fetch + parse ONCE, then resolve each id by scheme code OR ISIN (eCAS MF rows key on ISIN).
  async getQuotes(tickers: string[]): Promise<Map<string, Quote | null>> {
    const { byCode, isinToCode } = await loadNav();
    const out = new Map<string, Quote | null>();
    for (const t of tickers) {
      const id = t.trim();
      const code = byCode.has(id) ? id : isinToCode.get(id.toUpperCase()) ?? '';
      out.set(t, byCode.get(code) ?? null);
    }
    return out;
  },
  async getQuote(ticker: string): Promise<Quote | null> {
    return (await amfiProvider.getQuotes!([ticker])).get(ticker) ?? null;
  },
};
