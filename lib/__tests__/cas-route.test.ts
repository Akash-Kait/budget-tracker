import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    wealthAsset: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));
// Keep the real CasError (the route maps its `.code`), mock only the subprocess call.
vi.mock('@/lib/cas/sidecar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cas/sidecar')>();
  return { ...actual, runCasParser: vi.fn() };
});

import { prisma } from '@/lib/db';
import { runCasParser, CasError } from '@/lib/cas/sidecar';
import { POST as importCasPOST } from '@/app/api/wealth/import-cas/route';
import sample from '@/lib/__tests__/fixtures/cas-sample.json';

const m = prisma as unknown as Record<string, Record<string, Mock>> & { $transaction: Mock };
const run = runCasParser as unknown as Mock;

function casRequest(opts: { withFile?: boolean; password?: string } = {}) {
  const body = new FormData();
  if (opts.withFile !== false) {
    body.append('file', new File([new Uint8Array([1, 2, 3])], 'cas.pdf', { type: 'application/pdf' }));
  }
  body.append('password', opts.password ?? 'secret');
  return new Request('http://localhost/api/wealth/import-cas', { method: 'POST', body }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  m.$transaction.mockImplementation(async (cb: (tx: typeof prisma) => unknown) => cb(prisma));
});

describe('POST /api/wealth/import-cas', () => {
  it('no file → 400, parser never invoked', async () => {
    const res = await importCasPOST(casRequest({ withFile: false }));
    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it('success → reconciles into a transaction, returns a summary', async () => {
    run.mockResolvedValue(sample);
    m.wealthAsset.findMany.mockResolvedValue([]); // empty app → all schemes are new
    m.wealthAsset.create.mockResolvedValue({});
    const res = await importCasPOST(casRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ created: 3, updated: 0, flaggedAbsent: 0, statementDate: '2025-05-31' });
    expect(m.$transaction).toHaveBeenCalled();
    expect(m.wealthAsset.create).toHaveBeenCalledTimes(3);
  });

  it('rejects an older/out-of-order statement → 409, nothing written', async () => {
    run.mockResolvedValue(sample); // statementDate 2025-05-31
    m.wealthAsset.findMany.mockResolvedValue([
      {
        id: 'x', type: 'MUTUAL_FUND', name: 'Newer', source: 'CAS', importKey: 'F|1',
        casStatus: 'CURRENT', ticker: '120503', costBasis: null,
        priceUpdatedAt: new Date('2025-06-30'), // newer than the uploaded statement
      },
    ]);
    const res = await importCasPOST(casRequest());
    expect(res.status).toBe(409);
    expect(m.$transaction).not.toHaveBeenCalled();
    expect(m.wealthAsset.create).not.toHaveBeenCalled();
    expect(m.wealthAsset.update).not.toHaveBeenCalled();
  });

  it('wrong password (CasError BAD_PASSWORD) → 400, no DB writes', async () => {
    run.mockRejectedValue(new CasError('BAD_PASSWORD', 'Incorrect password'));
    const res = await importCasPOST(casRequest({ password: 'nope' }));
    expect(res.status).toBe(400);
    expect(m.wealthAsset.findMany).not.toHaveBeenCalled();
    expect(m.wealthAsset.create).not.toHaveBeenCalled();
  });

  it('parse failure (PARSE_ERROR) → 422, no DB writes', async () => {
    run.mockRejectedValue(new CasError('PARSE_ERROR', 'Could not parse'));
    const res = await importCasPOST(casRequest());
    expect(res.status).toBe(422);
    expect(m.wealthAsset.create).not.toHaveBeenCalled();
  });

  it('python missing (PYTHON_MISSING) → 501, no DB writes', async () => {
    run.mockRejectedValue(new CasError('PYTHON_MISSING', 'Python 3 is not available'));
    const res = await importCasPOST(casRequest());
    expect(res.status).toBe(501);
    expect(m.wealthAsset.create).not.toHaveBeenCalled();
  });
});
