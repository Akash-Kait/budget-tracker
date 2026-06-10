import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseAmfiDate,
  parseNavAll,
  parseNavIsinIndex,
  resolveAmfiCodes,
  amfiProvider,
  __clearAmfiCache,
  AMFI_NAV_URL,
} from '@/lib/market/amfi';
import { isStale } from '@/lib/market/staleness';

// A representative slice of NAVAll.txt: a header row, two fund-house sections, an "N.A." row,
// and a junk line. Schemes use the real DD-Mon-YYYY date format.
const SAMPLE = `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date

Open Ended Schemes ( Equity Scheme - Flexi Cap Fund )

Acme Mutual Fund

100001;INF111A01011;INF111A01029;Acme Flexi Cap Fund - Growth;123.4567;14-May-2025
100002;INF111A01037;;Acme Flexi Cap Fund - IDCW;45.6;14-May-2025

Beta Mutual Fund

200001;INF222B01011;;Beta Liquid Fund - Growth;N.A.;14-May-2025
200002;INF222B01029;;Beta Index Fund - Growth;1000.00;13-May-2025
300001;INF333C01011;;Empty NAV Fund - Growth;;14-May-2025
300002;INF333C01029;;Zero NAV Fund - Growth;0;14-May-2025
400001;INF444D01011;;Gamma Fund (Growth; Direct Plan);200.5;14-May-2025
this is not a scheme line at all
`;

afterEach(() => {
  __clearAmfiCache();
  vi.unstubAllGlobals();
});

function stubFetch(impl: () => Promise<{ ok: boolean; status?: number; text: () => Promise<string> }>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

describe('parseAmfiDate (explicit DD-Mon-YYYY — never new Date(string))', () => {
  it('parses a real DD-Mon-YYYY date to a UTC ISO string', () => {
    expect(parseAmfiDate('14-May-2025')).toBe('2025-05-14T00:00:00.000Z');
  });
  it('is case-insensitive on the month', () => {
    expect(parseAmfiDate('01-jan-2026')).toBe('2026-01-01T00:00:00.000Z');
  });
  it('returns null for formats it does not recognise (rather than guessing)', () => {
    expect(parseAmfiDate('2025-05-14')).toBeNull();
    expect(parseAmfiDate('14/05/2025')).toBeNull();
    expect(parseAmfiDate('14-Foo-2025')).toBeNull();
    expect(parseAmfiDate('')).toBeNull();
  });
  it('returns null for impossible dates instead of silently rolling them over', () => {
    // Date.UTC(2025,1,31) would roll to 3-Mar — a future date that reads "fresh" forever. Drop it.
    expect(parseAmfiDate('31-Feb-2025')).toBeNull();
    expect(parseAmfiDate('31-Apr-2025')).toBeNull();
    expect(parseAmfiDate('00-Jan-2025')).toBeNull();
  });
});

describe('parseNavAll', () => {
  const map = parseNavAll(SAMPLE);
  it('keeps valid scheme rows keyed by scheme code with price, ISO asOf, and resolved name', () => {
    expect(map.get('100001')).toEqual({
      price: 123.4567,
      asOf: '2025-05-14T00:00:00.000Z',
      name: 'Acme Flexi Cap Fund - Growth',
    });
    expect(map.get('200002')).toEqual({
      price: 1000,
      asOf: '2025-05-13T00:00:00.000Z',
      name: 'Beta Index Fund - Growth',
    });
  });
  it('skips headers, section titles, junk lines, and N.A. NAVs', () => {
    expect(map.has('200001')).toBe(false); // N.A.
  });
  it('drops empty and non-positive NAVs (must never write 0 into a holding)', () => {
    expect(map.has('300001')).toBe(false); // empty NAV field -> Number("")===0, must be dropped
    expect(map.has('300002')).toBe(false); // explicit 0
  });
  it('parses NAV/date from the right so a ; inside the scheme name does not shift columns', () => {
    expect(map.get('400001')).toEqual({
      price: 200.5,
      asOf: '2025-05-14T00:00:00.000Z',
      name: 'Gamma Fund (Growth; Direct Plan)',
    });
  });
  it('keeps only the genuinely valid rows', () => {
    expect(map.size).toBe(4); // 100001, 100002, 200002, 400001
  });
});

describe('amfiProvider.getQuotes (fetch once, then resolve many)', () => {
  it('fetches the feed once for a batch and returns quotes (with name) for found codes', async () => {
    stubFetch(async () => ({ ok: true, text: async () => SAMPLE }));
    const quotes = await amfiProvider.getQuotes!(['100001', '100002']);
    expect(quotes.get('100001')).toEqual({
      price: 123.4567,
      asOf: '2025-05-14T00:00:00.000Z',
      name: 'Acme Flexi Cap Fund - Growth',
    });
    expect(quotes.get('100002')?.price).toBe(45.6);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(AMFI_NAV_URL, expect.anything());
  });

  it('passes an abort signal so a hung connection times out (does not hang the request)', async () => {
    stubFetch(async () => ({ ok: true, text: async () => SAMPLE }));
    await amfiProvider.getQuotes!(['100001']);
    expect(fetch).toHaveBeenCalledWith(
      AMFI_NAV_URL,
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('returns null for a scheme code not in the feed (caller leaves the asset untouched)', async () => {
    stubFetch(async () => ({ ok: true, text: async () => SAMPLE }));
    const quotes = await amfiProvider.getQuotes!(['999999']);
    expect(quotes.get('999999')).toBeNull();
  });

  it('THROWS on a rejected fetch (network) so the route can fail safe', async () => {
    stubFetch(async () => {
      throw new Error('ENOTFOUND amfiindia.com');
    });
    await expect(amfiProvider.getQuotes!(['100001'])).rejects.toThrow();
  });

  it('THROWS on a non-OK HTTP status', async () => {
    stubFetch(async () => ({ ok: false, status: 503, text: async () => 'down' }));
    await expect(amfiProvider.getQuotes!(['100001'])).rejects.toThrow(/503/);
  });

  it('caches across calls within the TTL (only one network fetch)', async () => {
    stubFetch(async () => ({ ok: true, text: async () => SAMPLE }));
    await amfiProvider.getQuotes!(['100001']);
    await amfiProvider.getQuote('100002');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('stale classification on a real DD-Mon-YYYY NAV (end-to-end)', () => {
  it('an old parsed NAV is stale; a same-day one is fresh', () => {
    const old = parseNavAll(SAMPLE).get('100001')!.asOf; // 2025-05-14
    expect(isStale(old, '2025-05-26T10:00:00.000Z')).toBe(true); // ~8 business days later
    expect(isStale(old, '2025-05-14T18:00:00.000Z')).toBe(false); // same UTC day
  });
});

describe('ISIN→code index (feed-derived; for eCAS-MF refresh + migration bridge)', () => {
  it('parseNavIsinIndex maps both ISIN columns to the scheme code', () => {
    const idx = parseNavIsinIndex(SAMPLE);
    expect(idx.get('INF111A01011')).toBe('100001'); // ISIN-Growth column
    expect(idx.get('INF111A01029')).toBe('100001'); // ISIN-Reinvest column
    expect(idx.get('INF222B01029')).toBe('200002');
  });

  it('getQuotes resolves a holding identified by ISIN (not just by scheme code)', async () => {
    stubFetch(async () => ({ ok: true, text: async () => SAMPLE }));
    const quotes = await amfiProvider.getQuotes!(['INF111A01011']);
    expect(quotes.get('INF111A01011')).toMatchObject({ price: 123.4567 });
  });

  it('resolveAmfiCodes returns the code for a known ISIN and null for an unknown one', async () => {
    stubFetch(async () => ({ ok: true, text: async () => SAMPLE }));
    const m = await resolveAmfiCodes(['INF111A01011', 'INF999Z01099']);
    expect(m.get('INF111A01011')).toBe('100001');
    expect(m.get('INF999Z01099')).toBeNull();
  });
});
