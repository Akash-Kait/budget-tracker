import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { parseNseDate, pickLatestClose, ISIN_TO_SYMBOL, nseProvider, NseError } from '@/lib/market/nse';

// Mock the subprocess boundary so the provider's spawn/timeout/exit-code plumbing — the Python-side
// half of must-break (c) — is testable WITHOUT Python, nselib, or the network.
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: () => false })); // → always resolves the bare `python3` path

describe('parseNseDate (explicit DD-Mon-YYYY — never new Date(string))', () => {
  it('parses a real NSE date to a UTC ISO string', () => {
    expect(parseNseDate('11-Jun-2026')).toBe('2026-06-11T00:00:00.000Z');
  });
  it('rejects locale/other formats and impossible dates', () => {
    expect(parseNseDate('2026-06-11')).toBeNull();
    expect(parseNseDate('11/06/2026')).toBeNull();
    expect(parseNseDate('31-Feb-2026')).toBeNull();
    expect(parseNseDate('')).toBeNull();
  });
});

describe('pickLatestClose — the two silent-corruption must-breaks', () => {
  // MUST-BREAK (a): use ClosePrice, NEVER PrevClose. Fixture where they differ — a "close" substring
  // or a PrevClose read would silently take 940.00 (yesterday's close) instead of 944.85.
  it('uses ClosePrice, not PrevClose (off-by-one-day trap)', () => {
    const rows = [{ Date: '11-Jun-2026', PrevClose: '940.00', LastPrice: '945.10', ClosePrice: '944.85' }];
    expect(pickLatestClose(rows)).toEqual({ price: 944.85, asOf: '2026-06-11T00:00:00.000Z' });
  });

  // MUST-BREAK (b): latest row = max(Date), NOT iloc[-1]. The frame is DESCENDING (newest first), so
  // the last row is the OLDEST — taking it would price the stock at an old close.
  it('takes the max-Date row, not the last row, on a descending-sorted frame', () => {
    const rows = [
      { Date: '11-Jun-2026', PrevClose: '193.0', ClosePrice: '194.97' }, // newest (first)
      { Date: '10-Jun-2026', PrevClose: '192.0', ClosePrice: '193.00' },
      { Date: '09-Jun-2026', PrevClose: '190.0', ClosePrice: '189.26' }, // oldest (last) — must NOT win
    ];
    expect(pickLatestClose(rows)).toEqual({ price: 194.97, asOf: '2026-06-11T00:00:00.000Z' });
  });

  it('coerces comma-grouped strings and drops non-positive / unparseable rows', () => {
    expect(pickLatestClose([{ Date: '11-Jun-2026', ClosePrice: '13,312.85' }])?.price).toBe(13312.85);
    expect(pickLatestClose([{ Date: '11-Jun-2026', ClosePrice: '0' }])).toBeNull();
    expect(pickLatestClose([{ Date: 'bad', ClosePrice: '100' }])).toBeNull();
    expect(pickLatestClose([])).toBeNull();
  });

  // EXACT-key proof: a row with PrevClose/Close/LastPrice but NO ClosePrice must yield null — a
  // substring/fuzzy column matcher would wrongly return 940/941, reintroducing the off-by-one-day bug.
  it('drops a row missing the ClosePrice column (no PrevClose/Close fallback)', () => {
    expect(pickLatestClose([{ Date: '11-Jun-2026', PrevClose: '940.00', Close: '941.00', LastPrice: '942' }])).toBeNull();
  });
});

// ── The subprocess seam: runSidecar's failure paths (the untested half of must-break c) + getQuotes
// ── mapping, exercised through the public getQuotes with a faked child process. ──────────────────
type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
};

function fakeChild(): FakeChild {
  const c = new EventEmitter() as FakeChild;
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() };
  c.kill = vi.fn();
  return c;
}

describe('nseProvider.getQuotes — sidecar plumbing + ISIN→symbol mapping', () => {
  beforeEach(() => vi.mocked(spawn).mockReset());

  it('maps each requested ISIN: resolved (with name=symbol), feed-omitted, and unmapped → null', async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    // ITC is requested but omitted by the sidecar (a per-symbol miss); INE999… is not in the map.
    const p = nseProvider.getQuotes!(['INE062A01020', 'INE154A01025', 'INE999Z01010']);
    child.stdout.emit('data', JSON.stringify({ SBIN: [{ Date: '11-Jun-2026', ClosePrice: '800.00' }] }));
    child.emit('close', 0);
    const map = await p;

    // name carries the resolved symbol → route persists it as tickerName (never nulls it). (P1-1)
    expect(map.get('INE062A01020')).toEqual({ price: 800, asOf: '2026-06-11T00:00:00.000Z', name: 'SBIN' });
    expect(map.get('INE154A01025')).toBeNull(); // mapped (ITC) but feed-omitted → miss
    expect(map.get('INE999Z01010')).toBeNull(); // unmapped → NOT_FOUND
    // Only mapped, de-duplicated symbols are sent to the sidecar (unmapped ISIN filtered out).
    expect(child.stdin.write).toHaveBeenCalledWith(JSON.stringify(['SBIN', 'ITC']));
  });

  it('does not spawn at all when no requested ISIN maps to a symbol', async () => {
    const map = await nseProvider.getQuotes!(['INE999Z01010']);
    expect(map.get('INE999Z01010')).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('throws NseError on a non-zero exit (total failure → route fails SAFE, must-break c)', async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const p = nseProvider.getQuotes!(['INE062A01020']);
    child.emit('close', 3); // sidecar fetch_error
    await expect(p).rejects.toBeInstanceOf(NseError);
  });

  it('throws NseError on malformed sidecar JSON (never silently treats garbage as no quotes)', async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const p = nseProvider.getQuotes!(['INE062A01020']);
    child.stdout.emit('data', 'not json at all');
    child.emit('close', 0);
    await expect(p).rejects.toThrow(/invalid output/);
  });

  it('throws a friendly NseError when Python is unavailable (ENOENT)', async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const p = nseProvider.getQuotes!(['INE062A01020']);
    child.emit('error', Object.assign(new Error('spawn'), { code: 'ENOENT' }));
    await expect(p).rejects.toThrow(/Python 3 is not available/);
  });

  it('kills the child and throws on timeout (never hangs the refresh)', async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      vi.mocked(spawn).mockReturnValue(child as never);
      const p = nseProvider.getQuotes!(['INE062A01020']);
      const assertion = expect(p).rejects.toThrow(/timed out/);
      vi.advanceTimersByTime(30_000); // TIMEOUT_MS
      await assertion;
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ISIN→symbol map (the 12 validated holdings)', () => {
  it('keys on ISIN and maps to the validated NSE symbols', () => {
    expect(ISIN_TO_SYMBOL['INE062A01020']).toBe('SBIN');
    expect(ISIN_TO_SYMBOL['INE917I01010']).toBe('BAJAJ-AUTO');
    expect(Object.keys(ISIN_TO_SYMBOL)).toHaveLength(12);
    expect(ISIN_TO_SYMBOL['INE999Z01010']).toBeUndefined(); // unknown ISIN → not mapped → NOT_FOUND
  });
});
