import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    wealthAsset: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/ecas/sidecar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecas/sidecar')>();
  return { ...actual, runEcasUnifiedParser: vi.fn() };
});
vi.mock('@/lib/market/amfi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/market/amfi')>();
  return { ...actual, resolveAmfiCodes: vi.fn() };
});

import { prisma } from '@/lib/db';
import { runEcasUnifiedParser } from '@/lib/ecas/sidecar';
import { resolveAmfiCodes } from '@/lib/market/amfi';
import { POST } from '@/app/api/wealth/import-ecas-unified/route';

const m = prisma as unknown as Record<string, Record<string, Mock>> & { $transaction: Mock };
const run = runEcasUnifiedParser as unknown as Mock;
const amfi = resolveAmfiCodes as unknown as Mock;

// A clean, balanced, coverage-tying unified parse (so guards pass and the apply transaction runs).
const PARSED = {
  equity: {
    statementDate: '2026-05-31T00:00:00.000Z',
    equityStatedTotal: 500,
    accounts: [{ boId: 'BO1', holdings: [{ isin: 'INE001A01036', name: 'Acme Ltd # EQUITY', units: 5, price: 100, value: 500 }] }],
    unrecognized: [],
  },
  mf: {
    statementDate: '2026-05-31T00:00:00.000Z',
    grandTotalInvested: 22000,
    grandTotalValuation: 25050,
    dematStatedTotal: 2837,
    holdings: [
      { isin: 'INF001A01011', name: 'TPDG - quant ELSS - Direct Plan', section: 'folio', folio: 'F1', units: 100, nav: 250.5, amountInvested: 22000, valuation: 25050 },
      { isin: 'INF205KA1213', name: 'X#Y MF- Z FUND-DIRECT-GROWTH', section: 'demat', boId: 'BO1', units: 100, nav: 28.37, amountInvested: null, valuation: 2837 },
    ],
  },
  rowAccounting: { parsedRows: 3, equity: 1, folioMf: 1, dematMf: 1, unrecognized: 0, skipped: 0 },
};

function req(confirm: boolean) {
  const body = new FormData();
  body.append('file', new File([new Uint8Array([1, 2, 3])], 'ecas.pdf', { type: 'application/pdf' }));
  body.append('password', 'secret');
  if (confirm) body.append('confirm', 'true');
  return new Request('http://localhost/api/wealth/import-ecas-unified', { method: 'POST', body }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  m.wealthAsset.findMany.mockResolvedValue([]); // first import, no existing
  amfi.mockResolvedValue(new Map()); // feed reachable, nothing to bridge (first import)
  // Run the apply callback against the same mocked prisma — so one tx handle drives all writes.
  m.$transaction.mockImplementation(async (cb: (tx: typeof prisma) => unknown) => cb(prisma));
});

describe('POST /api/wealth/import-ecas-unified', () => {
  it('preview (no confirm) → guards run, ZERO writes', async () => {
    run.mockResolvedValue(PARSED);
    const res = await POST(req(false));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.phase).toBe('preview');
    expect(body.blocked).toBe(false);
    expect(m.$transaction).not.toHaveBeenCalled();
    expect(m.wealthAsset.create).not.toHaveBeenCalled();
  });

  it('confirm on a clean parse → ONE transaction applies stocks + MFs', async () => {
    run.mockResolvedValue(PARSED);
    m.wealthAsset.create.mockResolvedValue({});
    const res = await POST(req(true));
    expect(res.status).toBe(200);
    expect((await res.json()).phase).toBe('applied');
    expect(m.$transaction).toHaveBeenCalledTimes(1); // ONE transaction spanning both domains
    expect(m.wealthAsset.create).toHaveBeenCalledTimes(3); // 1 equity + 1 folio + 1 demat
  });

  // MUST-BREAK 2: a failure in the SECOND domain (MF) must abort the WHOLE transaction — only passes
  // if stock + MF share ONE tx handle (so a real DB rolls the stock writes back too).
  it('a MF (second-domain) write failure aborts the single transaction → 500, partial-success impossible', async () => {
    run.mockResolvedValue(PARSED);
    // Stock create(s) succeed; the MF create (INF ticker) throws — the failure is in the 2nd domain.
    m.wealthAsset.create.mockImplementation(async (arg: { data: { ticker?: string } }) => {
      if (String(arg.data.ticker).startsWith('INF')) throw new Error('SECRET db write failed');
      return {};
    });
    const res = await POST(req(true));
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain('SECRET'); // no PII/internal leak
    expect(m.$transaction).toHaveBeenCalledTimes(1); // the SAME single transaction wrapped both domains
    // The stock create was attempted inside that same tx before the MF write threw → a real DB rolls
    // it back. (Mock can't persist; the single-tx structure is what guarantees atomicity.)
    expect(m.wealthAsset.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ticker: 'INE001A01036' }) }));
  });

  it('a blocked plan (coverage shortfall) → 409, NO transaction opened (guard before tx)', async () => {
    run.mockResolvedValue({ ...PARSED, equity: { ...PARSED.equity, equityStatedTotal: 9999 } });
    const res = await POST(req(true));
    expect(res.status).toBe(409);
    expect((await res.json()).phase).toBe('blocked');
    expect(m.$transaction).not.toHaveBeenCalled(); // validation failure ≠ write failure
    expect(m.wealthAsset.create).not.toHaveBeenCalled();
  });
});
