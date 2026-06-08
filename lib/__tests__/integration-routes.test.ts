// Real route handlers against a throwaway temp SQLite DB (never dev.db). Catches the bug class mocks
// can't: a query that's invalid against the actual schema (e.g. the new costBasis/purchaseDate columns).
// DATABASE_URL is pointed at a temp file and the schema is pushed BEFORE @/lib/db is imported, so the
// Prisma singleton binds to the temp DB. Handlers are imported dynamically for the same reason.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { jsonReq, params } from '@/lib/__tests__/helpers/req';

const dbFile = path.join(os.tmpdir(), `bt-int-${process.pid}.db`);

/* eslint-disable @typescript-eslint/no-explicit-any */
let prisma: any;
let items: any, itemId: any, funding: any, wealth: any, wealthId: any, profile: any;

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${dbFile}`;
  // Call the local prisma binary directly (npx resolution adds tens of seconds).
  const prismaBin = path.resolve(process.cwd(), 'node_modules/.bin/prisma');
  execSync(`${prismaBin} db push --skip-generate --accept-data-loss`, {
    env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
    stdio: 'ignore',
  });
  prisma = (await import('@/lib/db')).prisma;
  items = await import('@/app/api/items/route');
  itemId = await import('@/app/api/items/[id]/route');
  funding = await import('@/app/api/items/[id]/funding/route');
  wealth = await import('@/app/api/wealth/route');
  wealthId = await import('@/app/api/wealth/[id]/route');
  profile = await import('@/app/api/profile/route');
}, 120000);

afterAll(async () => {
  await prisma?.$disconnect();
  for (const f of [dbFile, `${dbFile}-journal`]) fs.rmSync(f, { force: true });
});

describe('integration (temp SQLite, real queries)', () => {
  it('profile PUT then GET round-trips', async () => {
    const put = await profile.PUT(
      jsonReq('PUT', { reserveTarget: 5, reserveCurrent: 4, monthlyIncome: 3, monthlyExpenses: 2, monthlyInvestments: 1 }),
    );
    expect(put.status).toBe(200);
    const got = await (await profile.GET()).json();
    expect(got.reserveTarget).toBe(5);
  });

  it('items POST creates and GET lists it (derived fundedAmount = 0)', async () => {
    const post = await items.POST(
      jsonReq('POST', { type: 'GOAL', title: 'Car', amount: 1000, priority: 4, dueDate: '2028-01-01T00:00:00.000Z' }),
    );
    expect(post.status).toBe(201);
    const created = await post.json();
    expect(created.id).toBeTruthy();
    const list = await (await items.GET(jsonReq('GET', undefined, 'http://localhost/api/items'))).json();
    const found = list.find((x: any) => x.id === created.id);
    expect(found).toBeTruthy();
    expect(found.fundedAmount).toBe(0);
  });

  it('funding POST persists and recomputes via a real $transaction', async () => {
    const created = await (
      await items.POST(
        jsonReq('POST', { type: 'COMMITMENT', title: 'Laptop', amount: 100000, priority: 5, dueDate: '2026-07-15T00:00:00.000Z' }),
      )
    ).json();
    const res = await funding.POST(jsonReq('POST', { amount: 60000, note: 'seed' }), { params: params({ id: created.id }) });
    expect(res.status).toBe(201);
    expect((await res.json()).fundedAmount).toBe(60000);
  });

  it('items DELETE of a non-existent id → 404 (real Prisma P2025 → withErrorHandling)', async () => {
    const res = await itemId.DELETE(jsonReq('DELETE'), { params: params({ id: 'does-not-exist' }) });
    expect(res.status).toBe(404);
  });

  it('wealth POST persists costBasis + purchaseDate against the real schema', async () => {
    const post = await wealth.POST(
      jsonReq('POST', {
        type: 'STOCK', name: 'Infy', ticker: 'INFY', quantity: 10, pricePerUnit: 1500,
        costBasis: 100000, purchaseDate: '2024-04-01T00:00:00.000Z',
      }),
    );
    expect(post.status).toBe(201);
    const list = await (await wealth.GET()).json();
    const a = list.find((x: any) => x.name === 'Infy');
    expect(a.costBasis).toBe(100000);
    expect(a.purchaseDate).toBeTruthy();
    expect(a.priceSource).toBe('MANUAL');
  });

  it('wealth DELETE of a non-existent id → 404', async () => {
    const res = await wealthId.DELETE(jsonReq('DELETE'), { params: params({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });
});
