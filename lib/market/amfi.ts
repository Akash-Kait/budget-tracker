// AMFI mutual-fund NAV provider. Backs the PriceProvider seam with AMFI's published
// end-of-day NAV dump (https://www.amfiindia.com/spages/NAVAll.txt). NAV is END-OF-DAY, once
// per business day — never real-time; the UI surfaces "NAV as of <date> · end of day".
// Selected only when MARKET_DATA_PROVIDER=amfi; otherwise the manual provider stays default.
import type { PriceProvider, Quote } from './provider';

export const AMFI_NAV_URL = 'https://www.amfiindia.com/spages/NAVAll.txt';
// NOTE: AMFI has documented intermittent multi-day outages, so the fail-safe (throw → route 500,
// keep last good price) fires in practice. NAV0.txt on the portal subdomain is a known alternate
// source — intentionally NOT wired here; downtime is handled by failing safe, not by a fallback.

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

// One parse per refresh; cache it ~30 min across refreshes (NAV changes at most once/day) to avoid
// re-downloading several MB on repeated clicks. Single-instance MVP — each process caches its own.
const TTL_MS = 30 * 60 * 1000;
let cache: { at: number; map: Map<string, Quote> } | null = null;

/** For tests only — drop the cached parse. */
export function __clearAmfiCache(): void {
  cache = null;
}

async function loadNavMap(): Promise<Map<string, Quote>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  // Throws on network failure (rejected fetch), timeout, HTTP error, or an empty/garbage parse. The
  // route calls this BEFORE any DB write, so a throw leaves every price + totalWealth untouched.
  // The timeout matters: AMFI's documented outages include STALLED connections (accept, never
  // respond), which without an AbortSignal would hang the request forever and bypass the fail-safe.
  const res = await fetch(AMFI_NAV_URL, {
    headers: { accept: 'text/plain' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`AMFI feed HTTP ${res.status}`);
  const map = parseNavAll(await res.text());
  if (map.size === 0) throw new Error('AMFI feed parsed to zero schemes');
  cache = { at: Date.now(), map };
  return map;
}

export const amfiProvider: PriceProvider = {
  name: 'amfi',
  // Batch: fetch + parse ONCE, then resolve every requested scheme code.
  async getQuotes(tickers: string[]): Promise<Map<string, Quote | null>> {
    const map = await loadNavMap();
    const out = new Map<string, Quote | null>();
    for (const t of tickers) out.set(t, map.get(t.trim()) ?? null);
    return out;
  },
  async getQuote(ticker: string): Promise<Quote | null> {
    return (await amfiProvider.getQuotes!([ticker])).get(ticker) ?? null;
  },
};
