// NSE end-of-day equity price provider. Backs the PriceProvider seam for STOCKS via nselib's
// EOD price/volume path (scripts/nse_quote.py sidecar). EOD, once per trading day — never live; the
// UI surfaces "as of <date> · NSE close". Selected only when EQUITY_DATA_PROVIDER=nse.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { PriceProvider, Quote } from './provider';

const SCRIPT = path.join(process.cwd(), 'scripts', 'nse_quote.py');
const VENV_PY = path.join(process.cwd(), 'scripts', '.venv', 'bin', 'python');
const TIMEOUT_MS = 30_000;

// Static ISIN → NSE symbol map (the 12 holdings validated in the POC). An ISIN NOT here resolves to a
// null quote → the route surfaces a visible NOT_FOUND; it is never guessed or silently skipped.
export const ISIN_TO_SYMBOL: Record<string, string> = {
  INE931S01010: 'ADANIENSOL',
  INE742F01042: 'ADANIPORTS',
  INE814H01029: 'ADANIPOWER',
  INE917I01010: 'BAJAJ-AUTO',
  INE397D01024: 'BHARTIARTL',
  INE491A01021: 'CUB',
  INE271C01023: 'DLF',
  INE090A01021: 'ICICIBANK',
  INE765G01017: 'ICICIGI',
  INE154A01025: 'ITC',
  INE585B01010: 'MARUTI',
  INE062A01020: 'SBIN',
};

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/**
 * Parse nselib's `DD-Mon-YYYY` date (e.g. "11-Jun-2026") EXPLICITLY to an ISO string — never via
 * `new Date(string)` (engine-dependent; would corrupt the stale check). Returns null for anything that
 * doesn't match, so a bad date drops the row. (The AMFI/eCAS lesson.)
 */
export function parseNseDate(s: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec((s ?? '').trim());
  if (!m) return null;
  const day = Number(m[1]);
  const mon = MONTHS[m[2][0].toUpperCase() + m[2].slice(1).toLowerCase()];
  const year = Number(m[3]);
  if (mon === undefined || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, mon, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== mon || d.getUTCDate() !== day) return null;
  return d.toISOString();
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

type Row = Record<string, unknown>;

/**
 * From one symbol's nselib frame rows, pick the Quote. PURE, exported for tests — this is where the two
 * silent-corruption traps live:
 *  - reads `ClosePrice` by EXACT key (NOT PrevClose / a "close" substring → off-by-one-day);
 *  - picks the row with the MAX Date (the frame is sorted DESCENDING, so iloc[-1]/last is the OLDEST).
 * Returns null if no row has both a parseable Date and a positive ClosePrice.
 */
export function pickLatestClose(rows: Row[]): Quote | null {
  let best: { price: number; asOf: string } | null = null;
  for (const r of rows ?? []) {
    const asOf = parseNseDate(String(r['Date'] ?? ''));
    const price = toNumber(r['ClosePrice']); // EXACT column — never PrevClose
    if (!asOf || price === null || price <= 0) continue;
    if (best === null || asOf > best.asOf) best = { price, asOf }; // MAX Date, not position
  }
  return best ? { price: best.price, asOf: best.asOf } : null;
}

export class NseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NseError';
  }
}

// Spawn the sidecar with the symbol list (stdin JSON); return { SYMBOL: rows[] }. Throws on a total
// failure (nselib missing / NSE unreachable / non-zero exit) so the route fails SAFE for stocks
// (keeps last prices); a per-symbol miss is simply an absent key (→ null quote downstream).
function runSidecar(symbols: string[]): Promise<Record<string, Row[]>> {
  const py = existsSync(VENV_PY) ? VENV_PY : 'python3';
  return new Promise((resolve, reject) => {
    const child = spawn(py, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => done(() => {
      child.kill('SIGKILL');
      reject(new NseError('NSE quote sidecar timed out'));
    }), TIMEOUT_MS);
    child.on('error', (e: NodeJS.ErrnoException) =>
      done(() => reject(new NseError(e.code === 'ENOENT' ? 'Python 3 is not available' : 'Failed to start the NSE sidecar'))),
    );
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', () => {}); // swallow — never logged
    child.on('close', (code) => done(() => {
      if (code !== 0) return reject(new NseError(`NSE quote sidecar exited with code ${code}`));
      try {
        resolve(JSON.parse(out) as Record<string, Row[]>);
      } catch {
        reject(new NseError('NSE quote sidecar returned invalid output'));
      }
    }));
    child.stdin.on('error', () => {});
    child.stdin.write(JSON.stringify(symbols));
    child.stdin.end();
  });
}

export const nseProvider: PriceProvider = {
  name: 'nse',
  // Batch: map ISINs → symbols, fetch all in one sidecar run, resolve each ISIN's latest close.
  async getQuotes(isins: string[]): Promise<Map<string, Quote | null>> {
    const symbols = [...new Set(isins.map((i) => ISIN_TO_SYMBOL[i.trim()]).filter(Boolean))];
    const frames = symbols.length ? await runSidecar(symbols) : {};
    const out = new Map<string, Quote | null>();
    for (const isin of isins) {
      const sym = ISIN_TO_SYMBOL[isin.trim()];
      const q = sym ? pickLatestClose(frames[sym] ?? []) : null; // not in map → null (NOT_FOUND)
      // Carry the resolved NSE symbol as the quote name → the route persists it as tickerName and the
      // UI echoes it, confirming the ISIN→symbol mapping resolved (mirrors AMFI echoing the scheme name).
      out.set(isin, q ? { ...q, name: sym } : null);
    }
    return out;
  },
  async getQuote(isin: string): Promise<Quote | null> {
    return (await nseProvider.getQuotes!([isin])).get(isin) ?? null;
  },
};
