import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    wealthAsset: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/ecas/sidecar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecas/sidecar')>();
  return { ...actual, runEcasParser: vi.fn() };
});

import { prisma } from '@/lib/db';
import { runEcasParser, EcasError } from '@/lib/ecas/sidecar';
import { POST as importEcasPOST } from '@/app/api/wealth/import-ecas/route';
import sample from '@/lib/__tests__/fixtures/ecas-sample.json';

const m = prisma as unknown as Record<string, Record<string, Mock>> & { $transaction: Mock };
const run = runEcasParser as unknown as Mock;

function ecasReq(opts: { withFile?: boolean; password?: string } = {}) {
  const body = new FormData();
  if (opts.withFile !== false) {
    body.append('file', new File([new Uint8Array([1, 2, 3])], 'ecas.pdf', { type: 'application/pdf' }));
  }
  body.append('password', opts.password ?? 'secret');
  return new Request('http://localhost/api/wealth/import-ecas', { method: 'POST', body }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  m.$transaction.mockImplementation(async (cb: (tx: typeof prisma) => unknown) => cb(prisma));
});

describe('POST /api/wealth/import-ecas', () => {
  it('no file → 400, parser never called', async () => {
    const res = await importEcasPOST(ecasReq({ withFile: false }));
    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it('success → reconciles in a transaction; surfaces unrecognized; summary', async () => {
    run.mockResolvedValue(sample);
    m.wealthAsset.findMany.mockResolvedValue([]);
    m.wealthAsset.create.mockResolvedValue({});
    const res = await importEcasPOST(ecasReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ created: 3, updated: 0, flaggedAbsent: 0, statementDate: '2026-05-31T00:00:00.000Z' });
    expect(body.unrecognized).toEqual([{ isin: 'IN0020230011', name: 'Synthetic Govt Security' }]);
    expect(m.$transaction).toHaveBeenCalled();
    expect(m.wealthAsset.create).toHaveBeenCalledTimes(3); // 3 equity rows; the unrecognized one is NOT created
    // imported equity value (25050 + 48000 + 15030) matches the stated 88080 → complete
    expect(body.coverage).toEqual({ statedEquityTotal: 88080, importedEquityValue: 88080, complete: true });
  });

  it('surfaces a coverage shortfall when imported equity < the statement total (silent-drop guard)', async () => {
    run.mockResolvedValue({ ...sample, equityStatedTotal: 126421.5 }); // statement says more than we imported
    m.wealthAsset.findMany.mockResolvedValue([]);
    m.wealthAsset.create.mockResolvedValue({});
    const body = await (await importEcasPOST(ecasReq())).json();
    expect(body.coverage.complete).toBe(false); // 88080 imported vs 126421.50 stated → incomplete, surfaced
    expect(body.coverage.importedEquityValue).toBe(88080);
  });

  it('rejects an older/out-of-order statement → 409, nothing written', async () => {
    run.mockResolvedValue(sample); // 2026-05-31
    m.wealthAsset.findMany.mockResolvedValue([
      { id: 'x', type: 'STOCK', name: 'Newer', source: 'ECAS', importKey: 'BO-A|INE001A01036',
        casStatus: 'CURRENT', ticker: 'INE001A01036', costBasis: null, priceUpdatedAt: new Date('2026-06-30') },
    ]);
    const res = await importEcasPOST(ecasReq());
    expect(res.status).toBe(409);
    expect(m.$transaction).not.toHaveBeenCalled();
    expect(m.wealthAsset.create).not.toHaveBeenCalled();
  });

  it('rejects an undateable statement → 422, nothing written (no silent guard bypass)', async () => {
    run.mockResolvedValue({ ...sample, statementDate: null });
    m.wealthAsset.findMany.mockResolvedValue([]);
    const res = await importEcasPOST(ecasReq());
    expect(res.status).toBe(422);
    expect(m.$transaction).not.toHaveBeenCalled();
    expect(m.wealthAsset.create).not.toHaveBeenCalled();
  });

  it('does not count incomplete holdings toward created/updated; surfaces them separately', async () => {
    run.mockResolvedValue({
      statementDate: '2026-05-31',
      accounts: [{ boId: 'BO-A', holdings: [{ isin: 'INE001A01036', name: 'Acme', units: null, price: 250, value: null }] }],
      unrecognized: [],
    });
    m.wealthAsset.findMany.mockResolvedValue([]);
    const body = await (await importEcasPOST(ecasReq())).json();
    expect(body).toMatchObject({ created: 0, updated: 0 });
    expect(body.incomplete).toEqual([{ isin: 'INE001A01036', name: 'Acme' }]);
    expect(m.wealthAsset.create).not.toHaveBeenCalled();
  });

  it('bad password → 400, no DB writes', async () => {
    run.mockRejectedValue(new EcasError('BAD_PASSWORD', 'Incorrect password'));
    const res = await importEcasPOST(ecasReq({ password: 'nope' }));
    expect(res.status).toBe(400);
    expect(m.wealthAsset.findMany).not.toHaveBeenCalled();
  });

  it('pdfplumber missing → 501', async () => {
    run.mockRejectedValue(new EcasError('PDFPLUMBER_MISSING', 'pdfplumber is not installed'));
    expect((await importEcasPOST(ecasReq())).status).toBe(501);
  });

  it('parse error → 422', async () => {
    run.mockRejectedValue(new EcasError('PARSE_ERROR', 'Could not parse the eCAS PDF (CASParseError)'));
    expect((await importEcasPOST(ecasReq())).status).toBe(422);
  });
});
