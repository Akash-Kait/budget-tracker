import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Prisma } from '@prisma/client';
import { jsonReq, badJsonReq, params } from '@/lib/__tests__/helpers/req';
import { simulatePurchase } from '@/lib/finance';
import type { Item, Profile } from '@/lib/types';

vi.mock('@/lib/db', () => ({
  prisma: {
    financialProfile: { upsert: vi.fn() },
    planItem: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn(),
    },
    fundingTransaction: { create: vi.fn(), findMany: vi.fn() },
    wealthAsset: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/data', () => ({
  getProfile: vi.fn(),
  getItems: vi.fn(),
  getWealthAssets: vi.fn(),
  getFundings: vi.fn(),
}));
// Mock the provider seam so refresh tests drive the state machine without any network/feed.
vi.mock('@/lib/market/provider', () => ({ getPriceProvider: vi.fn() }));

import { prisma } from '@/lib/db';
import { getProfile, getItems } from '@/lib/data';
import { GET as profileGET, PUT as profilePUT } from '@/app/api/profile/route';
import { POST as simulatePOST } from '@/app/api/simulate/route';
import { GET as itemsGET, POST as itemsPOST } from '@/app/api/items/route';
import { GET as itemGET, PUT as itemPUT, DELETE as itemDELETE } from '@/app/api/items/[id]/route';
import { POST as fundingPOST } from '@/app/api/items/[id]/funding/route';
import { GET as wealthGET, POST as wealthPOST } from '@/app/api/wealth/route';
import { PUT as wealthPUT, DELETE as wealthDELETE } from '@/app/api/wealth/[id]/route';
import { POST as refreshPOST } from '@/app/api/wealth/refresh-prices/route';
import { getPriceProvider } from '@/lib/market/provider';

const m = prisma as unknown as Record<string, Record<string, Mock>> & { $transaction: Mock };
const knownErr = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('db', { code, clientVersion: '6' });
const ctx = (id: string) => ({ params: params({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// Shared assertion for the 500 contract: status 500 + generic body + no leaked message.
async function expect500NoLeak(res: Response) {
  expect(res.status).toBe(500);
  const body = await res.json();
  expect(body).toEqual({ error: 'Internal server error' });
  expect(JSON.stringify(body)).not.toContain('SECRET');
}

describe('profile route', () => {
  it('GET → 200', async () => {
    m.financialProfile.upsert.mockResolvedValue({ id: 1, reserveCurrent: 1 });
    const res = await profileGET();
    expect(res.status).toBe(200);
  });
  it('GET → 500 with no stack leak', async () => {
    m.financialProfile.upsert.mockRejectedValue(new Error('SECRET'));
    await expect500NoLeak(await profileGET());
  });
  it('PUT bad JSON → 400', async () => {
    expect((await profilePUT(badJsonReq('PUT'))).status).toBe(400);
  });
  it('PUT invalid body (negative) → 400', async () => {
    const res = await profilePUT(
      jsonReq('PUT', { reserveTarget: -1, reserveCurrent: 0, monthlyIncome: 0, monthlyExpenses: 0, monthlyInvestments: 0 }),
    );
    expect(res.status).toBe(400);
  });
  it('PUT valid → 200', async () => {
    m.financialProfile.upsert.mockResolvedValue({ id: 1 });
    const res = await profilePUT(
      jsonReq('PUT', { reserveTarget: 1, reserveCurrent: 1, monthlyIncome: 1, monthlyExpenses: 1, monthlyInvestments: 1 }),
    );
    expect(res.status).toBe(200);
  });
});

describe('simulate route', () => {
  const profile: Profile = {
    reserveTarget: 500000, reserveCurrent: 420000, monthlyIncome: 150000, monthlyExpenses: 70000, monthlyInvestments: 30000,
  };
  const items: Item[] = [];
  it('bad JSON → 400', async () => {
    expect((await simulatePOST(badJsonReq('POST'))).status).toBe(400);
  });
  it('cost ≤ 0 → 400', async () => {
    expect((await simulatePOST(jsonReq('POST', { cost: 0 }))).status).toBe(400);
  });
  it('valid → 200 and body is exactly {name, ...simulatePurchase()} (server parity)', async () => {
    (getProfile as Mock).mockResolvedValue(profile);
    (getItems as Mock).mockResolvedValue(items);
    const res = await simulatePOST(jsonReq('POST', { name: 'TV', cost: 200000 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'TV', ...simulatePurchase(profile, items, 200000) });
  });
  it('data-layer throw → 500 no leak', async () => {
    (getProfile as Mock).mockRejectedValue(new Error('SECRET'));
    await expect500NoLeak(await simulatePOST(jsonReq('POST', { cost: 5 })));
  });
});

describe('items collection route', () => {
  it('GET → 200 with derived fundedAmount', async () => {
    m.planItem.findMany.mockResolvedValue([
      { id: 'a', type: 'GOAL', title: 'x', amount: 100, priority: 3, dueDate: null, status: null, notes: null, coolingPeriodDays: 30, dateAdded: new Date(), purchased: false, rank: 0, fundings: [{ amount: 60 }, { amount: 5 }] },
    ]);
    const res = await itemsGET(jsonReq('GET', undefined, 'http://localhost/api/items'));
    expect(res.status).toBe(200);
    expect((await res.json())[0].fundedAmount).toBe(65);
  });
  it('GET → 500 no leak', async () => {
    m.planItem.findMany.mockRejectedValue(new Error('SECRET'));
    await expect500NoLeak(await itemsGET(jsonReq('GET', undefined, 'http://localhost/api/items')));
  });
  it('POST bad JSON → 400', async () => {
    expect((await itemsPOST(badJsonReq('POST'))).status).toBe(400);
  });
  it('POST invalid (missing title) → 400', async () => {
    const res = await itemsPOST(jsonReq('POST', { type: 'GOAL', amount: 1, priority: 3, dueDate: '2026-07-01T00:00:00.000Z' }));
    expect(res.status).toBe(400);
  });
  it('POST valid → 201', async () => {
    m.planItem.aggregate.mockResolvedValue({ _max: { rank: 2 } });
    m.planItem.create.mockResolvedValue({ id: 'new' });
    const res = await itemsPOST(jsonReq('POST', { type: 'GOAL', title: 'Car', amount: 1000, priority: 4, dueDate: '2028-01-01T00:00:00.000Z' }));
    expect(res.status).toBe(201);
  });
  it('POST create throws P2002 → 409 (mapping)', async () => {
    m.planItem.aggregate.mockResolvedValue({ _max: { rank: 0 } });
    m.planItem.create.mockRejectedValue(knownErr('P2002'));
    const res = await itemsPOST(jsonReq('POST', { type: 'GOAL', title: 'Car', amount: 1, priority: 4, dueDate: '2028-01-01T00:00:00.000Z' }));
    expect(res.status).toBe(409);
  });
});

describe('items [id] route', () => {
  it('GET found → 200 with derived fundedAmount', async () => {
    m.planItem.findUnique.mockResolvedValue({ id: 'a', fundings: [{ amount: 10 }] });
    const res = await itemGET(jsonReq('GET'), ctx('a'));
    expect(res.status).toBe(200);
    expect((await res.json()).fundedAmount).toBe(10);
  });
  it('GET missing (null) → 404', async () => {
    m.planItem.findUnique.mockResolvedValue(null);
    expect((await itemGET(jsonReq('GET'), ctx('nope'))).status).toBe(404);
  });
  it('PUT invalid → 400', async () => {
    expect((await itemPUT(jsonReq('PUT', { type: 'GOAL', amount: 1, priority: 3 }), ctx('a'))).status).toBe(400);
  });
  it('PUT valid → 200', async () => {
    m.planItem.update.mockResolvedValue({ id: 'a' });
    const res = await itemPUT(jsonReq('PUT', { type: 'GOAL', title: 'x', amount: 1, priority: 3, dueDate: '2028-01-01T00:00:00.000Z' }), ctx('a'));
    expect(res.status).toBe(200);
  });
  it('PUT update throws P2025 → 404 (mapping)', async () => {
    m.planItem.update.mockRejectedValue(knownErr('P2025'));
    const res = await itemPUT(jsonReq('PUT', { type: 'GOAL', title: 'x', amount: 1, priority: 3, dueDate: '2028-01-01T00:00:00.000Z' }), ctx('gone'));
    expect(res.status).toBe(404);
  });
  it('DELETE valid → 200', async () => {
    m.planItem.delete.mockResolvedValue({ id: 'a' });
    expect((await itemDELETE(jsonReq('DELETE'), ctx('a'))).status).toBe(200);
  });
  it('DELETE missing throws P2025 → 404', async () => {
    m.planItem.delete.mockRejectedValue(knownErr('P2025'));
    expect((await itemDELETE(jsonReq('DELETE'), ctx('gone'))).status).toBe(404);
  });
});

describe('items [id] funding route', () => {
  it('bad JSON → 400', async () => {
    m.planItem.findUnique.mockResolvedValue({ id: 'a' });
    expect((await fundingPOST(badJsonReq('POST'), ctx('a'))).status).toBe(400);
  });
  it('item missing (null) → 404', async () => {
    m.planItem.findUnique.mockResolvedValue(null);
    expect((await fundingPOST(jsonReq('POST', { amount: 100 }), ctx('nope'))).status).toBe(404);
  });
  it('amount ≤ 0 → 400', async () => {
    m.planItem.findUnique.mockResolvedValue({ id: 'a' });
    expect((await fundingPOST(jsonReq('POST', { amount: 0 }), ctx('a'))).status).toBe(400);
  });
  it('valid → 201 with recomputed fundedAmount', async () => {
    m.planItem.findUnique
      .mockResolvedValueOnce({ id: 'a' }) // existence check
      .mockResolvedValueOnce({ id: 'a', fundings: [{ amount: 100 }, { amount: 25 }] }); // inside tx
    m.$transaction.mockImplementation(async (cb: (tx: typeof prisma) => unknown) => cb(prisma));
    m.fundingTransaction.create.mockResolvedValue({ id: 'f' });
    const res = await fundingPOST(jsonReq('POST', { amount: 25, note: 'x' }), ctx('a'));
    expect(res.status).toBe(201);
    expect((await res.json()).fundedAmount).toBe(125);
  });
  it('throw → 500 no leak', async () => {
    m.planItem.findUnique.mockRejectedValue(new Error('SECRET'));
    await expect500NoLeak(await fundingPOST(jsonReq('POST', { amount: 1 }), ctx('a')));
  });
});

describe('wealth collection route', () => {
  it('GET → 200', async () => {
    m.wealthAsset.findMany.mockResolvedValue([]);
    expect((await wealthGET()).status).toBe(200);
  });
  it('POST bad JSON → 400', async () => {
    expect((await wealthPOST(badJsonReq('POST'))).status).toBe(400);
  });
  it('POST refine fail (no qty+price and no value) → 400', async () => {
    expect((await wealthPOST(jsonReq('POST', { type: 'STOCK', name: 'X' }))).status).toBe(400);
  });
  it('POST valid → 201 and forwards costBasis/purchaseDate + stamps MANUAL price source', async () => {
    m.wealthAsset.create.mockResolvedValue({ id: 'w' });
    const res = await wealthPOST(
      jsonReq('POST', {
        type: 'STOCK', name: 'Infy', ticker: 'INFY', quantity: 10, pricePerUnit: 1500,
        costBasis: 100000, purchaseDate: '2024-04-01T00:00:00.000Z',
      }),
    );
    expect(res.status).toBe(201);
    expect(m.wealthAsset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        costBasis: 100000,
        priceSource: 'MANUAL',
        purchaseDate: expect.any(Date),
      }),
    });
  });
  it('POST throw → 500 no leak', async () => {
    m.wealthAsset.create.mockRejectedValue(new Error('SECRET'));
    await expect500NoLeak(
      await wealthPOST(jsonReq('POST', { type: 'STOCK', name: 'X', value: 1 })),
    );
  });
});

describe('wealth [id] route', () => {
  it('PUT valid → 200 and forwards cost-basis fields', async () => {
    m.wealthAsset.update.mockResolvedValue({ id: 'w' });
    const res = await wealthPUT(
      jsonReq('PUT', { type: 'MUTUAL_FUND', name: 'Fund', value: 50000, costBasis: 40000 }),
      ctx('w'),
    );
    expect(res.status).toBe(200);
    expect(m.wealthAsset.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ costBasis: 40000 }) }),
    );
  });
  it('PUT update throws P2025 → 404', async () => {
    m.wealthAsset.update.mockRejectedValue(knownErr('P2025'));
    expect(
      (await wealthPUT(jsonReq('PUT', { type: 'STOCK', name: 'X', value: 1 }), ctx('gone'))).status,
    ).toBe(404);
  });
  it('DELETE valid → 200', async () => {
    m.wealthAsset.delete.mockResolvedValue({ id: 'w' });
    expect((await wealthDELETE(jsonReq('DELETE'), ctx('w'))).status).toBe(200);
  });
  it('DELETE missing throws P2025 → 404', async () => {
    m.wealthAsset.delete.mockRejectedValue(knownErr('P2025'));
    expect((await wealthDELETE(jsonReq('DELETE'), ctx('gone'))).status).toBe(404);
  });
});

describe('wealth refresh-prices route (state machine)', () => {
  const provider = getPriceProvider as Mock;

  // The route wraps all per-asset writes in prisma.$transaction(cb); run the callback with the
  // mocked prisma so tx.wealthAsset.update routes to the same mock.
  beforeEach(() => {
    m.$transaction.mockImplementation(async (cb: (tx: typeof prisma) => unknown) => cb(prisma));
  });

  it('feed unreachable (getQuotes throws) → 500 and NO price write (fail safe)', async () => {
    m.wealthAsset.findMany.mockResolvedValue([
      { id: '1', name: 'Fund A', type: 'MUTUAL_FUND', ticker: '100001', priceStatus: null },
    ]);
    provider.mockReturnValue({
      name: 'amfi',
      getQuote: vi.fn(),
      getQuotes: vi.fn().mockRejectedValue(new Error('SECRET feed down')),
    });
    await expect500NoLeak(await refreshPOST());
    expect(m.wealthAsset.update).not.toHaveBeenCalled();
  });

  it('mixed: found → priced; not-found → untouched price + persisted NOT_FOUND; stale flagged', async () => {
    const old = '2025-05-14T00:00:00.000Z'; // far in the past → stale
    m.wealthAsset.findMany.mockResolvedValue([
      { id: '1', name: 'Found Fresh', type: 'MUTUAL_FUND', ticker: '100001', priceStatus: null },
      { id: '2', name: 'Missing', type: 'MUTUAL_FUND', ticker: '999999', priceStatus: null },
      { id: '3', name: 'Found Stale', type: 'MUTUAL_FUND', ticker: '100002', priceStatus: null },
    ]);
    provider.mockReturnValue({
      name: 'amfi',
      getQuote: vi.fn(),
      getQuotes: vi.fn().mockResolvedValue(
        new Map<string, { price: number; asOf: string; name?: string } | null>([
          ['100001', { price: 123.45, asOf: new Date().toISOString(), name: 'HDFC Flexi Cap' }],
          ['999999', null],
          ['100002', { price: 50, asOf: old }],
        ]),
      ),
    });
    m.wealthAsset.update.mockResolvedValue({});

    const res = await refreshPOST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(2);
    expect(body.notFound).toEqual(['Missing']);
    expect(body.stale).toEqual(['Found Stale']);

    // Found asset: full price write incl. priceSource API + priceStatus OK + resolved tickerName;
    // never zeroed.
    expect(m.wealthAsset.update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: expect.objectContaining({
        pricePerUnit: 123.45,
        priceSource: 'API',
        priceStatus: 'OK',
        tickerName: 'HDFC Flexi Cap',
      }),
    });
    // Not-found asset: ONLY priceStatus is written — price left untouched.
    expect(m.wealthAsset.update).toHaveBeenCalledWith({
      where: { id: '2' },
      data: { priceStatus: 'NOT_FOUND' },
    });
  });

  it('manual provider (no getQuotes) → true no-op: nothing checked, marked, or written', async () => {
    provider.mockReturnValue({ name: 'manual', getQuote: vi.fn().mockResolvedValue(null) });
    const res = await refreshPOST();
    const body = await res.json();
    expect(body).toEqual({ provider: 'manual', checked: 0, updated: 0, stale: [], notFound: [] });
    expect(m.wealthAsset.findMany).not.toHaveBeenCalled();
    expect(m.wealthAsset.update).not.toHaveBeenCalled();
  });

  it('no mutual funds with a ticker → checked 0, no provider fetch', async () => {
    m.wealthAsset.findMany.mockResolvedValue([]);
    const getQuotes = vi.fn();
    provider.mockReturnValue({ name: 'amfi', getQuote: vi.fn(), getQuotes });
    const res = await refreshPOST();
    expect((await res.json()).checked).toBe(0);
    expect(getQuotes).not.toHaveBeenCalled();
  });

  it('mid-loop update failure → 500 inside a transaction (so "nothing changed" is true)', async () => {
    m.wealthAsset.findMany.mockResolvedValue([
      { id: '1', name: 'A', type: 'MUTUAL_FUND', ticker: '100001', priceStatus: null },
      { id: '2', name: 'B', type: 'MUTUAL_FUND', ticker: '100002', priceStatus: null },
    ]);
    provider.mockReturnValue({
      name: 'amfi',
      getQuote: vi.fn(),
      getQuotes: vi.fn().mockResolvedValue(
        new Map<string, { price: number; asOf: string } | null>([
          ['100001', { price: 10, asOf: new Date().toISOString() }],
          ['100002', { price: 20, asOf: new Date().toISOString() }],
        ]),
      ),
    });
    // First asset writes fine; the second rejects mid-loop.
    m.wealthAsset.update
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('SECRET db locked'));

    await expect500NoLeak(await refreshPOST());
    // The writes were wrapped in $transaction, so on a real DB the first write rolls back too.
    expect(m.$transaction).toHaveBeenCalled();
  });
});
