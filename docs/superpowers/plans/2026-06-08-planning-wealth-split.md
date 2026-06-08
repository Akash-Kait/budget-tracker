# Planning / Wealth Split Implementation Plan (Iteration 5)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Remove "Protected Capital" everywhere and add an independent Wealth module (manual investment assets) with its own page, API, and pure logic — without letting any Wealth value touch Planning calculations.

**Architecture:** Planning stays in `lib/finance.ts` (only `Profile` drops `protectedCapital`). Wealth gets a new `lib/wealth.ts`, a `WealthAsset` Prisma model, `/api/wealth` routes, a `/wealth` page, and a passive Total Wealth card on the dashboard.

**Tech Stack:** Next.js 16, TS, Tailwind, Prisma/SQLite, Zod, Vitest. No new deps.

---

## Task 1: Schema — drop protectedCapital, add WealthAsset

**Files:** `prisma/schema.prisma`

- [ ] **Step 1:** Remove `protectedCapital Float @default(0)` from `FinancialProfile`. Add:
```prisma
model WealthAsset {
  id           String   @id @default(cuid())
  name         String
  type         String // MUTUAL_FUND | STOCK | OTHER
  ticker       String?
  quantity     Float?
  pricePerUnit Float?
  value        Float? // manual fallback when units/price don't apply
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```
- [ ] **Step 2:** `npx prisma db push --accept-data-loss` → "in sync" + client regenerated.
- [ ] **Step 3:** Commit.

---

## Task 2: Types + validation

**Files:** `lib/types.ts`, `lib/validation.ts`

- [ ] **Step 1:** In `lib/types.ts` remove `protectedCapital` from `Profile`. Add:
```typescript
export const ASSET_TYPES = ['MUTUAL_FUND', 'STOCK', 'OTHER'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  MUTUAL_FUND: 'Mutual Funds',
  STOCK: 'Stocks',
  OTHER: 'Other',
};

export interface WealthAsset {
  id: string;
  name: string;
  type: AssetType;
  ticker: string | null;
  quantity: number | null;
  pricePerUnit: number | null;
  value: number | null; // manual fallback
}
```
- [ ] **Step 2:** In `lib/validation.ts` remove `protectedCapital` from `profileSchema`. Add:
```typescript
import { ASSET_TYPES } from '@/lib/types';

export const wealthAssetSchema = z
  .object({
    name: z.string().min(1).max(200),
    type: z.enum(ASSET_TYPES),
    ticker: z.string().max(20).nullable().optional(),
    quantity: z.number().min(0).nullable().optional(),
    pricePerUnit: z.number().min(0).nullable().optional(),
    value: z.number().min(0).nullable().optional(),
  })
  .refine(
    (d) => (d.quantity != null && d.pricePerUnit != null) || d.value != null,
    { message: 'Provide either quantity + price, or a manual value', path: ['value'] },
  );
```
- [ ] **Step 3:** Commit.

---

## Task 3: Wealth domain logic (TDD)

**Files:** Create `lib/wealth.ts`, `lib/__tests__/wealth.test.ts`

- [ ] **Step 1: Failing tests:**
```typescript
import { describe, it, expect } from 'vitest';
import { assetValue, totalWealth, groupByType } from '@/lib/wealth';
import type { WealthAsset } from '@/lib/types';

function asset(p: Partial<WealthAsset>): WealthAsset {
  return { id: Math.random().toString(36).slice(2), name: 'a', type: 'STOCK', ticker: null, quantity: null, pricePerUnit: null, value: null, ...p };
}

describe('assetValue', () => {
  it('is quantity * price when both present', () => {
    expect(assetValue(asset({ quantity: 10, pricePerUnit: 150.5 }))).toBe(1505);
  });
  it('falls back to manual value', () => {
    expect(assetValue(asset({ value: 5000 }))).toBe(5000);
  });
  it('prefers units*price over manual value', () => {
    expect(assetValue(asset({ quantity: 2, pricePerUnit: 100, value: 999 }))).toBe(200);
  });
  it('is 0 when nothing is set', () => {
    expect(assetValue(asset({}))).toBe(0);
  });
});

describe('totalWealth', () => {
  it('sums asset values', () => {
    expect(totalWealth([asset({ value: 1000 }), asset({ quantity: 5, pricePerUnit: 200 })])).toBe(2000);
  });
  it('is 0 for empty', () => {
    expect(totalWealth([])).toBe(0);
  });
});

describe('groupByType', () => {
  it('groups in fixed order, omits empty, subtotals', () => {
    const g = groupByType([
      asset({ type: 'STOCK', value: 100 }),
      asset({ type: 'MUTUAL_FUND', value: 300 }),
      asset({ type: 'STOCK', value: 50 }),
    ]);
    expect(g.map((x) => x.type)).toEqual(['MUTUAL_FUND', 'STOCK']);
    expect(g[0].subtotal).toBe(300);
    expect(g[1].subtotal).toBe(150);
  });
});
```
- [ ] **Step 2:** Run `npm test -- wealth` → FAIL.
- [ ] **Step 3: Implement `lib/wealth.ts`:**
```typescript
import type { WealthAsset, AssetType } from '@/lib/types';
import { ASSET_TYPES, ASSET_TYPE_LABELS } from '@/lib/types';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function assetValue(a: WealthAsset): number {
  if (a.quantity != null && a.pricePerUnit != null) return round2(a.quantity * a.pricePerUnit);
  return round2(a.value ?? 0);
}

export function totalWealth(assets: WealthAsset[]): number {
  return round2(assets.reduce((s, a) => s + assetValue(a), 0));
}

export interface WealthGroup {
  type: AssetType;
  label: string;
  assets: WealthAsset[];
  subtotal: number;
}

export function groupByType(assets: WealthAsset[]): WealthGroup[] {
  return ASSET_TYPES.map((type) => {
    const inType = assets.filter((a) => a.type === type);
    return {
      type,
      label: ASSET_TYPE_LABELS[type],
      assets: inType,
      subtotal: totalWealth(inType),
    };
  }).filter((g) => g.assets.length > 0);
}
```
- [ ] **Step 4:** `npm test -- wealth` → PASS.
- [ ] **Step 5:** Commit.

---

## Task 4: Data layer + remove protectedCapital from getProfile

**Files:** `lib/data.ts`

- [ ] **Step 1:** Remove `protectedCapital: r.protectedCapital,` from `getProfile`'s return. Add:
```typescript
import type { Item, Profile, WealthAsset } from '@/lib/types';

export async function getWealthAssets(): Promise<WealthAsset[]> {
  const rows = await prisma.wealthAsset.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type as WealthAsset['type'],
    ticker: r.ticker,
    quantity: r.quantity,
    pricePerUnit: r.pricePerUnit,
    value: r.value,
  }));
}
```
- [ ] **Step 2:** Commit.

---

## Task 5: API routes

**Files:** Create `app/api/wealth/route.ts`, `app/api/wealth/[id]/route.ts`

- [ ] **Step 1:** Collection route:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { wealthAssetSchema } from '@/lib/validation';
import { withErrorHandling } from '@/lib/handler';

export const GET = withErrorHandling(async () => {
  const assets = await prisma.wealthAsset.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json(assets);
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json();
  const parsed = wealthAssetSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;
  const created = await prisma.wealthAsset.create({
    data: {
      name: d.name, type: d.type, ticker: d.ticker ?? null,
      quantity: d.quantity ?? null, pricePerUnit: d.pricePerUnit ?? null, value: d.value ?? null,
    },
  });
  return NextResponse.json(created, { status: 201 });
});
```
- [ ] **Step 2:** Item route (`[id]`):
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { wealthAssetSchema } from '@/lib/validation';
import { withErrorHandling } from '@/lib/handler';

export const PUT = withErrorHandling(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = wealthAssetSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
    const d = parsed.data;
    const updated = await prisma.wealthAsset.update({
      where: { id },
      data: {
        name: d.name, type: d.type, ticker: d.ticker ?? null,
        quantity: d.quantity ?? null, pricePerUnit: d.pricePerUnit ?? null, value: d.value ?? null,
      },
    });
    return NextResponse.json(updated);
  },
);

export const DELETE = withErrorHandling(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await prisma.wealthAsset.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  },
);
```
- [ ] **Step 3:** Commit.

---

## Task 6: Wealth UI

**Files:** Create `components/wealth/WealthAssetForm.tsx`, `components/wealth/WealthAssetRow.tsx`, `app/wealth/page.tsx`; modify `components/Nav.tsx`

- [ ] **Step 1:** `WealthAssetForm` (client) — fields: type (select MUTUAL_FUND/STOCK/OTHER via ASSET_TYPE_LABELS), name, ticker, quantity, pricePerUnit, value. POST `/api/wealth` (or PUT `/api/wealth/:id` when `initial`). Client-side guard: require (quantity && price) || value, else show error. `router.refresh()` + reset on success.
- [ ] **Step 2:** `WealthAssetRow` (client) — shows name, ticker, `qty × price` or "manual", computed `assetValue` via `<Money>`, Edit (swaps to `WealthAssetForm initial=asset`) + Delete (`DELETE /api/wealth/:id`).
- [ ] **Step 3:** `app/wealth/page.tsx` (server, `force-dynamic`):
```tsx
import { Card } from '@/components/Card';
import { Money } from '@/components/Money';
import { WealthAssetForm } from '@/components/wealth/WealthAssetForm';
import { WealthAssetRow } from '@/components/wealth/WealthAssetRow';
import { getWealthAssets } from '@/lib/data';
import { groupByType, totalWealth } from '@/lib/wealth';

export const dynamic = 'force-dynamic';

export default async function WealthPage() {
  const assets = await getWealthAssets();
  const groups = groupByType(assets);
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Wealth</h1>
        <p className="text-sm text-gray-500">Total: <span className="text-lg font-bold text-gray-900"><Money amount={totalWealth(assets)} /></span></p>
      </div>
      <p className="text-sm text-gray-500">Investment assets, entered manually for now. These are tracked separately and never affect your planning reserve, projections, or the purchase simulator.</p>
      <Card title="Add asset"><WealthAssetForm /></Card>
      {groups.length === 0 ? (
        <Card><p className="text-sm text-gray-500">No assets yet.</p></Card>
      ) : (
        groups.map((g) => (
          <Card key={g.type} title={`${g.label} · ${'₹'}${g.subtotal.toLocaleString('en-IN')}`}>
            {g.assets.map((a) => <WealthAssetRow key={a.id} asset={a} />)}
          </Card>
        ))
      )}
    </div>
  );
}
```
- [ ] **Step 4:** Nav — add `{ href: '/wealth', label: 'Wealth' }` after History.
- [ ] **Step 5:** Build; commit.

---

## Task 7: Passive Total Wealth on the Planning dashboard

**Files:** `app/page.tsx`, `components/dashboard/Dashboard.tsx`

- [ ] **Step 1:** `app/page.tsx` — also load wealth total and pass it:
```tsx
import { getProfile, getItems, getWealthAssets } from '@/lib/data';
import { totalWealth } from '@/lib/wealth';
...
const [profile, items, assets] = await Promise.all([getProfile(), getItems(), getWealthAssets()]);
return <Dashboard profile={profile} items={items} totalWealth={totalWealth(assets)} />;
```
- [ ] **Step 2:** `Dashboard.tsx` — add `totalWealth: number` prop. Render a small read-only card (e.g., below the KPI row or beside the heading) with the value and a `next/link` to `/wealth`, labeled "Total Wealth (tracked separately)". Do NOT use it in any calculation.
- [ ] **Step 3:** Build; commit.

---

## Task 8: Settings + seed + verify

**Files:** `components/ProfileForm.tsx`, `prisma/seed.ts`

- [ ] **Step 1:** `ProfileForm.tsx` — remove the `protectedCapital` entry from the `fields` array.
- [ ] **Step 2:** `prisma/seed.ts` — remove `protectedCapital` from the profile object; after items, seed wealth assets:
```typescript
await prisma.wealthAsset.deleteMany();
await prisma.wealthAsset.createMany({
  data: [
    { type: 'MUTUAL_FUND', name: 'Nifty 50 Index Fund', ticker: 'NIFTY50', quantity: 1200, pricePerUnit: 95.4 },
    { type: 'MUTUAL_FUND', name: 'Flexi Cap Fund', quantity: 800, pricePerUnit: 62.1 },
    { type: 'STOCK', name: 'Infosys', ticker: 'INFY', quantity: 50, pricePerUnit: 1480 },
    { type: 'STOCK', name: 'HDFC Bank', ticker: 'HDFCBANK', quantity: 30, pricePerUnit: 1650 },
    { type: 'OTHER', name: 'Sovereign Gold Bond', value: 150000 },
  ],
});
```
- [ ] **Step 3:** `npm run db:seed`; verify counts.
- [ ] **Step 4:** `npm test` (finance fixture updated to drop protectedCapital — see Task 2 fallout) and `npm run build` → clean; routes include `/wealth`, `/api/wealth`, `/api/wealth/[id]`.
- [ ] **Step 5:** Smoke (dev): `/wealth` shows grouped assets + total; add/edit/delete works; dashboard shows passive Total Wealth linking to `/wealth`; Settings has no Protected Capital; simulator/projection unchanged. Update README (Wealth page; remove Protected Capital mention). Commit.

---

## Self-review notes

- **Spec coverage:** remove Protected Capital → Tasks 1,2,4,8. Wealth model → 1,2. Wealth logic → 3. API → 5. Wealth page → 6. Passive dashboard stat → 7. Seed/demo → 8. Independence: `lib/wealth.ts` never imports `lib/finance.ts`; the dashboard stat is display-only.
- **Type consistency:** `WealthAsset`/`AssetType`/`ASSET_TYPES`/`ASSET_TYPE_LABELS` defined in `lib/types.ts` (Task 2), consumed by wealth logic (3), data (4), API (5), UI (6). `assetValue`/`totalWealth`/`groupByType` defined in Task 3, used in 6,7.
- **No placeholders;** no new dependencies; Planning math untouched.
