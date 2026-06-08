# Planner Iteration 2 Implementation Plan (P0 + P1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add Edit, Complete/Archive + history, Remaining-needed, Total Future Liability, Funding Transactions, Reserve Recovery Time, and Projected Completion Date to the existing planner.

**Architecture:** Transactions-first funding — a new `FundingTransaction` table; `fundedAmount` becomes a derived sum computed in the data layer. New pure helpers in `lib/finance.ts` reuse the existing projection engine. UI rows become editable with inline forms and a funding panel.

**Tech Stack:** Next.js (App Router), TypeScript, Tailwind, Prisma/SQLite, Zod, Vitest.

---

## Task 1: Schema — FundingTransaction + drop fundedAmount

**Files:** Modify `prisma/schema.prisma`

- [ ] **Step 1:** Replace the `PlanItem.fundedAmount` line and add the relation + new model:

```prisma
model PlanItem {
  id                String    @id @default(cuid())
  type              String
  title             String
  amount            Float     @default(0)
  priority          Int       @default(3)
  dueDate           DateTime?
  status            String?
  notes             String?
  coolingPeriodDays Int       @default(30)
  dateAdded         DateTime  @default(now())
  purchased         Boolean   @default(false)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  fundings          FundingTransaction[]
}

model FundingTransaction {
  id        String   @id @default(cuid())
  itemId    String
  item      PlanItem @relation(fields: [itemId], references: [id], onDelete: Cascade)
  amount    Float
  note      String?
  date      DateTime @default(now())
  createdAt DateTime @default(now())

  @@index([itemId])
}
```

- [ ] **Step 2:** Push: `npm run db:push` → expect "in sync" and client regenerated.
- [ ] **Step 3:** Commit: `git add prisma && git commit -m "feat: add FundingTransaction, derive fundedAmount"`

---

## Task 2: Update seed to use transactions

**Files:** Modify `prisma/seed.ts`

- [ ] **Step 1:** Replace `createMany` with per-item `create` that nests an initial funding transaction. Use this full file:

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Seed = {
  type: string; title: string; amount: number; funded: number; priority: number;
  dueDate?: Date; status?: string; notes?: string; coolingPeriodDays?: number; dateAdded?: Date;
};

const items: Seed[] = [
  { type: 'COMMITMENT', title: 'Laptop', amount: 100000, funded: 60000, priority: 5, dueDate: new Date('2026-07-15'), status: 'PLANNED' },
  { type: 'COMMITMENT', title: "Friend's Wedding", amount: 40000, funded: 10000, priority: 5, dueDate: new Date('2026-08-10'), status: 'PLANNED' },
  { type: 'GOAL', title: 'Car', amount: 600000, funded: 120000, priority: 4, dueDate: new Date('2028-01-01') },
  { type: 'GOAL', title: 'Wedding Fund', amount: 800000, funded: 50000, priority: 4, dueDate: new Date('2029-03-01') },
  { type: 'EXPERIENCE', title: 'Lollapalooza', amount: 15000, funded: 0, priority: 3, dueDate: new Date('2027-01-20') },
  { type: 'EXPERIENCE', title: 'Nepal Trip', amount: 60000, funded: 5000, priority: 2, dueDate: new Date('2027-02-15') },
  { type: 'WISHLIST', title: 'Crocs', amount: 5400, funded: 0, priority: 2, notes: 'comfy', coolingPeriodDays: 30, dateAdded: new Date('2026-06-01') },
  { type: 'WISHLIST', title: 'Home Theater', amount: 50000, funded: 0, priority: 1, notes: 'nice to have', coolingPeriodDays: 30, dateAdded: new Date('2026-05-20') },
  { type: 'WISHLIST', title: 'Perfume', amount: 4000, funded: 0, priority: 1, coolingPeriodDays: 30, dateAdded: new Date('2026-06-06') },
];

async function main() {
  await prisma.fundingTransaction.deleteMany();
  await prisma.planItem.deleteMany();
  await prisma.financialProfile.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1, protectedCapital: 200000, reserveTarget: 500000, reserveCurrent: 420000,
      monthlyIncome: 150000, monthlyExpenses: 70000, monthlyInvestments: 30000,
    },
  });

  for (const it of items) {
    await prisma.planItem.create({
      data: {
        type: it.type, title: it.title, amount: it.amount, priority: it.priority,
        dueDate: it.dueDate ?? null, status: it.status ?? null, notes: it.notes ?? null,
        coolingPeriodDays: it.coolingPeriodDays ?? 30, dateAdded: it.dateAdded ?? new Date(),
        fundings: it.funded > 0
          ? { create: { amount: it.funded, note: 'Initial allocation', date: it.dateAdded ?? new Date() } }
          : undefined,
      },
    });
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
```

- [ ] **Step 2:** Run `npm run db:seed`; verify `node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();Promise.all([p.planItem.count(),p.fundingTransaction.count()]).then(([i,t])=>{console.log('items',i,'tx',t);return p.\$disconnect()})"` → `items 9 tx 6`.
- [ ] **Step 3:** Commit.

---

## Task 3: Data layer — derive fundedAmount

**Files:** Modify `lib/data.ts`; add `getFundings`

- [ ] **Step 1:** Update `getItems` to include fundings and sum them; add a `getFundings(id)` helper:

```typescript
import { prisma } from '@/lib/db';
import type { Item, Profile } from '@/lib/types';

export async function getProfile(): Promise<Profile> {
  const r = await prisma.financialProfile.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  return {
    protectedCapital: r.protectedCapital, reserveTarget: r.reserveTarget, reserveCurrent: r.reserveCurrent,
    monthlyIncome: r.monthlyIncome, monthlyExpenses: r.monthlyExpenses, monthlyInvestments: r.monthlyInvestments,
  };
}

export async function getItems(): Promise<Item[]> {
  const rows = await prisma.planItem.findMany({ orderBy: { createdAt: 'asc' }, include: { fundings: true } });
  return rows.map((r) => ({
    id: r.id, type: r.type as Item['type'], title: r.title, amount: r.amount,
    fundedAmount: r.fundings.reduce((s, f) => s + f.amount, 0),
    priority: r.priority, dueDate: r.dueDate ? r.dueDate.toISOString() : null, status: r.status as Item['status'],
    notes: r.notes, coolingPeriodDays: r.coolingPeriodDays, dateAdded: r.dateAdded.toISOString(), purchased: r.purchased,
  }));
}

export async function getFundings(itemId: string) {
  return prisma.fundingTransaction.findMany({ where: { itemId }, orderBy: { date: 'desc' } });
}
```

- [ ] **Step 2:** Commit.

---

## Task 4: Finance helpers (TDD)

**Files:** Modify `lib/finance.ts`; append to `lib/__tests__/finance.test.ts`

- [ ] **Step 1: Write failing tests** (append):

```typescript
import { remaining, isDone, isActive, totalFutureLiability, reserveRecoveryMonths, projectedCompletion } from '@/lib/finance';

describe('remaining', () => {
  it('is target minus funded, floored at 0', () => {
    expect(remaining(item({ amount: 100000, fundedAmount: 60000 }))).toBe(40000);
    expect(remaining(item({ amount: 100000, fundedAmount: 120000 }))).toBe(0);
  });
});

describe('isDone / isActive', () => {
  it('completed status is done', () => {
    expect(isDone(item({ status: 'COMPLETED' }))).toBe(true);
  });
  it('purchased wishlist is done', () => {
    expect(isDone(item({ type: 'WISHLIST', purchased: true }))).toBe(true);
  });
  it('planned item is active', () => {
    expect(isActive(item({ status: 'PLANNED' }))).toBe(true);
  });
});

describe('totalFutureLiability', () => {
  it('sums remaining for active non-wishlist items', () => {
    const items = [
      item({ title: 'Laptop', type: 'COMMITMENT', amount: 100000, fundedAmount: 60000, priority: 5, dueDate: '2026-07-01T00:00:00.000Z' }),
      item({ title: 'Car', type: 'GOAL', amount: 600000, fundedAmount: 120000, priority: 4, dueDate: '2028-01-01T00:00:00.000Z' }),
      item({ title: 'Crocs', type: 'WISHLIST', amount: 5400, fundedAmount: 0 }),
      item({ title: 'Done', type: 'GOAL', amount: 1000, fundedAmount: 0, status: 'COMPLETED' }),
    ];
    const r = totalFutureLiability(items);
    expect(r.total).toBe(40000 + 480000);
    expect(r.breakdown.map((b) => b.title)).toEqual(['Laptop', 'Car']);
  });
});

describe('reserveRecoveryMonths', () => {
  it('is deficit over surplus', () => {
    expect(reserveRecoveryMonths(profile)).toBeCloseTo(1.6, 1); // 80000/50000
  });
  it('is null when surplus is zero', () => {
    expect(reserveRecoveryMonths({ ...profile, monthlyIncome: 100000, monthlyExpenses: 100000, monthlyInvestments: 0 })).toBeNull();
  });
});

describe('projectedCompletion', () => {
  const from = '2026-06-01T00:00:00.000Z';
  it('maps month index to a future date and flags behind target', () => {
    const items = [
      item({ id: 'car', title: 'Car', type: 'GOAL', priority: 4, amount: 600000, fundedAmount: 0, dueDate: '2026-08-01T00:00:00.000Z' }),
    ];
    const r = projectedCompletion(profile, items, from);
    expect(r['car'].monthIndex).not.toBeNull();
    expect(r['car'].isoDate).not.toBeNull();
    expect(r['car'].behindMonths).toBeGreaterThan(0); // due Aug 2026 but funds take longer
  });
  it('returns null projection when surplus cannot fund', () => {
    const p = { ...profile, monthlyIncome: 100000, monthlyExpenses: 100000, monthlyInvestments: 0 };
    const items = [item({ id: 'g', type: 'GOAL', amount: 100000, fundedAmount: 0, dueDate: from })];
    const r = projectedCompletion(p, items, from);
    expect(r['g'].monthIndex).toBeNull();
    expect(r['g'].behindMonths).toBeNull();
  });
});
```

- [ ] **Step 2:** Run `npm test -- finance` → FAIL (undefined).
- [ ] **Step 3: Implement** (append to `lib/finance.ts`):

```typescript
export function remaining(item: Item): number {
  return Math.max(0, item.amount - item.fundedAmount);
}

export function isDone(item: Item): boolean {
  return item.status === 'COMPLETED' || (item.type === 'WISHLIST' && item.purchased);
}

export function isActive(item: Item): boolean {
  return !isDone(item);
}

export function totalFutureLiability(items: Item[]): {
  total: number;
  breakdown: { title: string; remaining: number }[];
} {
  const active = sortQueue(items).filter((i) => isActive(i) && remaining(i) > 0);
  const breakdown = active.map((i) => ({ title: i.title, remaining: remaining(i) }));
  const total = breakdown.reduce((s, b) => s + b.remaining, 0);
  return { total, breakdown };
}

export function reserveRecoveryMonths(p: Profile): number | null {
  const surplus = monthlySurplus(p);
  if (surplus <= 0) return null;
  return reserveDeficit(p) / surplus;
}

export interface ProjectedItem {
  monthIndex: number | null;
  isoDate: string | null;
  behindMonths: number | null;
}

function addMonths(iso: string, months: number): Date {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

export function projectedCompletion(
  p: Profile,
  items: Item[],
  fromIso: string,
): Record<string, ProjectedItem> {
  const active = items.filter(isActive);
  const proj = projectFunding(p, active, {});
  const out: Record<string, ProjectedItem> = {};
  for (const it of active) {
    const monthIndex = proj.completionMonth[it.id] ?? null;
    if (monthIndex === null) {
      out[it.id] = { monthIndex: null, isoDate: null, behindMonths: null };
      continue;
    }
    const date = addMonths(fromIso, monthIndex);
    let behindMonths: number | null = null;
    if (it.dueDate) {
      const dueMonth = new Date(Date.UTC(new Date(it.dueDate).getUTCFullYear(), new Date(it.dueDate).getUTCMonth(), 1));
      behindMonths = Math.max(0, monthsBetween(dueMonth, date));
    }
    out[it.id] = { monthIndex, isoDate: date.toISOString(), behindMonths };
  }
  return out;
}
```

- [ ] **Step 4:** Run `npm test -- finance` → PASS.
- [ ] **Step 5:** Commit.

---

## Task 5: Validation — drop fundedAmount, add funding schema

**Files:** Modify `lib/validation.ts`

- [ ] **Step 1:** Remove `fundedAmount` from `itemSchema`; add `fundingSchema`:

```typescript
export const itemSchema = z
  .object({
    type: z.enum(ITEM_TYPES),
    title: z.string().min(1),
    amount: z.number().min(0),
    priority: z.number().int().min(1).max(5),
    dueDate: z.string().datetime().nullable().optional(),
    status: z.enum(STATUSES).nullable().optional(),
    notes: z.string().nullable().optional(),
    coolingPeriodDays: z.number().int().min(0).default(30),
  })
  .refine((d) => d.type === 'WISHLIST' || !!d.dueDate, {
    message: 'dueDate is required for non-wishlist items',
    path: ['dueDate'],
  });

export const fundingSchema = z.object({
  amount: z.number().positive(),
  note: z.string().optional(),
});
```

- [ ] **Step 2:** Commit.

---

## Task 6: API — drop fundedAmount in item routes

**Files:** Modify `app/api/items/route.ts`, `app/api/items/[id]/route.ts`

- [ ] **Step 1:** In both POST (create) and PUT (update), remove the `fundedAmount: d.fundedAmount,` line from the `data` object. Everything else stays.
- [ ] **Step 2:** Verify build still type-checks later (Task 11). Commit.

---

## Task 7: API — funding endpoints

**Files:** Create `app/api/items/[id]/funding/route.ts`

- [ ] **Step 1:** Implement GET (history) + POST (add):

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { fundingSchema } from '@/lib/validation';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fundings = await prisma.fundingTransaction.findMany({ where: { itemId: id }, orderBy: { date: 'desc' } });
  return NextResponse.json(fundings);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await prisma.planItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await req.json();
  const parsed = fundingSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
  await prisma.fundingTransaction.create({
    data: { itemId: id, amount: parsed.data.amount, note: parsed.data.note ?? null },
  });
  const updated = await prisma.planItem.findUnique({ where: { id }, include: { fundings: true } });
  const fundedAmount = updated!.fundings.reduce((s, f) => s + f.amount, 0);
  return NextResponse.json({ ...updated, fundedAmount }, { status: 201 });
}
```

- [ ] **Step 2:** Commit.

---

## Task 8: API — complete / restore endpoints

**Files:** Create `app/api/items/[id]/complete/route.ts`, `app/api/items/[id]/restore/route.ts`

- [ ] **Step 1:** complete route:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await prisma.planItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const updated = await prisma.planItem.update({ where: { id }, data: { status: 'COMPLETED' } });
  return NextResponse.json(updated);
}
```

- [ ] **Step 2:** restore route (same shape, `data: { status: 'PLANNED' }`).
- [ ] **Step 3:** Commit.

---

## Task 9: UI — FundingPanel, EditableItemRow, ItemForm update

**Files:** Create `components/FundingPanel.tsx`, `components/EditableItemRow.tsx`; modify `components/ItemForm.tsx`

- [ ] **Step 1:** Remove the `fundedAmount` `<input>` and its state field from `ItemForm.tsx` (and from the submitted payload).

- [ ] **Step 2:** `FundingPanel` — add funding + history (client):

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatINR, formatMonth } from '@/lib/format';

interface Tx { id: string; amount: number; note: string | null; date: string }

export function FundingPanel({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<Tx[] | null>(null);

  async function load() {
    const res = await fetch(`/api/items/${itemId}/funding`);
    if (res.ok) setHistory(await res.json());
  }
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && history === null) await load();
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!n || n <= 0) return;
    const res = await fetch(`/api/items/${itemId}/funding`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount: n, note: note || undefined }),
    });
    if (res.ok) { setAmount(''); setNote(''); await load(); router.refresh(); }
  }

  return (
    <div className="mt-2">
      <button onClick={toggle} className="text-xs text-blue-600 hover:underline">
        {open ? 'Hide funding' : 'Add funding'}
      </button>
      {open && (
        <div className="mt-2 rounded-md bg-gray-50 p-3">
          <form onSubmit={add} className="flex flex-wrap items-center gap-2">
            <input className="w-28 rounded border border-gray-300 px-2 py-1 text-sm" type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <input className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700">Add</button>
          </form>
          {history && history.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-gray-600">
              {history.map((t) => (
                <li key={t.id}>{formatMonth(t.date)} +{formatINR(t.amount)}{t.note ? ` — ${t.note}` : ''}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3:** `EditableItemRow` — display + edit toggle + complete + delete + remaining + projection + funding panel (client):

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Money } from '@/components/Money';
import { ProgressBar } from '@/components/ProgressBar';
import { ItemForm } from '@/components/ItemForm';
import { FundingPanel } from '@/components/FundingPanel';
import { formatMonth } from '@/lib/format';
import type { Item } from '@/lib/types';

const badge: Record<string, string> = {
  COMMITMENT: 'bg-red-100 text-red-700', GOAL: 'bg-purple-100 text-purple-700',
  EXPERIENCE: 'bg-blue-100 text-blue-700', WISHLIST: 'bg-gray-100 text-gray-700',
};

interface Props {
  item: Item;
  remaining: number;
  projectedIso: string | null;
  behindMonths: number | null;
}

export function EditableItemRow({ item, remaining, projectedIso, behindMonths }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const pct = item.amount > 0 ? Math.round((item.fundedAmount / item.amount) * 100) : 0;

  async function action(path: string) {
    await fetch(`/api/items/${item.id}${path}`, { method: path === '' ? 'DELETE' : 'POST' });
    router.refresh();
  }
  async function del() {
    if (!confirm(`Delete "${item.title}"?`)) return;
    await action('');
  }

  if (editing) {
    return (
      <div className="border-b border-gray-100 py-3">
        <ItemForm initial={item} onDone={() => setEditing(false)} />
        <button onClick={() => setEditing(false)} className="mt-2 text-xs text-gray-500 hover:underline">Cancel</button>
      </div>
    );
  }

  return (
    <div className="border-b border-gray-100 py-3 last:border-0">
      <div className="flex items-center gap-4">
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge[item.type]}`}>{item.type}</span>
        <div className="w-40">
          <p className="font-medium">{item.title}</p>
          <p className="text-xs text-gray-500">P{item.priority}{item.dueDate ? ` · due ${formatMonth(item.dueDate)}` : ''}</p>
        </div>
        <div className="flex-1">
          <ProgressBar pct={pct} />
          <p className="mt-1 text-xs text-gray-500">
            <Money amount={item.fundedAmount} /> / <Money amount={item.amount} /> · Remaining <Money amount={remaining} />
          </p>
          <p className="text-xs text-gray-500">
            {projectedIso ? <>Projected: {formatMonth(projectedIso)}{behindMonths && behindMonths > 0 ? <span className="text-amber-600"> · ⚠ behind by {behindMonths} mo</span> : <span className="text-green-600"> · on track</span>}</> : <span className="text-gray-400">Projected: not on current plan</span>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs">
          <button onClick={() => setEditing(true)} className="text-blue-600 hover:underline">Edit</button>
          <button onClick={() => action('/complete')} className="text-green-600 hover:underline">Complete</button>
          <button onClick={del} className="text-red-500 hover:underline">Delete</button>
        </div>
      </div>
      <FundingPanel itemId={item.id} />
    </div>
  );
}
```

- [ ] **Step 4:** Commit.

---

## Task 10: Pages — Queue, Dashboard, History, Wishlist, nav

**Files:** Modify `app/queue/page.tsx`, `app/page.tsx`, `app/wishlist/page.tsx`, `app/timeline/page.tsx`, `components/Nav.tsx`; create `app/history/page.tsx`

- [ ] **Step 1:** Queue page — filter active, compute projections, use `EditableItemRow`:

```tsx
import { Card } from '@/components/Card';
import { EditableItemRow } from '@/components/EditableItemRow';
import { ItemForm } from '@/components/ItemForm';
import { getItems, getProfile } from '@/lib/data';
import { sortQueue, isActive, remaining, projectedCompletion } from '@/lib/finance';

export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  const [items, profile] = await Promise.all([getItems(), getProfile()]);
  const active = items.filter(isActive);
  const queue = sortQueue(active);
  const proj = projectedCompletion(profile, items, new Date().toISOString());
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Priority Queue</h1>
      <Card title="Add item"><ItemForm /></Card>
      <Card>
        {queue.length === 0 ? <p className="text-sm text-gray-500">No active items.</p> :
          queue.map((i) => (
            <EditableItemRow key={i.id} item={i} remaining={remaining(i)}
              projectedIso={proj[i.id]?.isoDate ?? null} behindMonths={proj[i.id]?.behindMonths ?? null} />
          ))}
      </Card>
    </div>
  );
}
```

- [ ] **Step 2:** Dashboard — add Reserve Recovery Time + Total Future Liability card; filter top-unfunded to active. Add imports `reserveRecoveryMonths, totalFutureLiability, isActive` and:
  - On the Opportunity Reserve card, under the deficit line, add:
    ```tsx
    {(() => { const m = reserveRecoveryMonths(profile); return (
      <p className="mt-1 text-xs text-gray-500">Recovery: {m === null ? '—' : `${m.toFixed(1)} months`}</p>
    ); })()}
    ```
  - Change `const topUnfunded = sortQueue(items)...` to `sortQueue(items.filter(isActive))`.
  - After the grid, add a liability card:
    ```tsx
    {(() => { const liab = totalFutureLiability(items); return (
      <Card title="Total Future Liability">
        <ul className="space-y-1 text-sm">
          {liab.breakdown.map((b) => (
            <li key={b.title} className="flex justify-between"><span>{b.title}</span><Money amount={b.remaining} /></li>
          ))}
        </ul>
        <p className="mt-3 flex justify-between border-t border-gray-200 pt-2 font-bold"><span>Total</span><Money amount={liab.total} /></p>
      </Card>
    ); })()}
    ```

- [ ] **Step 3:** History page:

```tsx
import { Card } from '@/components/Card';
import { Money } from '@/components/Money';
import { getItems } from '@/lib/data';
import { isDone } from '@/lib/finance';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const done = (await getItems()).filter(isDone);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Completed History</h1>
      <Card>
        {done.length === 0 ? <p className="text-sm text-gray-500">Nothing completed yet.</p> : (
          <ul className="divide-y divide-gray-100">
            {done.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium">{i.title} <span className="text-xs text-green-600">✓ {i.type === 'WISHLIST' && i.purchased ? 'purchased' : 'completed'}</span></p>
                  <p className="text-xs text-gray-500">{i.type} · P{i.priority}</p>
                </div>
                <Money amount={i.amount} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 4:** Wishlist page — filter to active (drop purchased into history): change items line to `.filter((i) => i.type === 'WISHLIST' && !i.purchased)`. Timeline page — filter active: add `&& isActive(i)` (import `isActive`). 
- [ ] **Step 5:** Nav — add `{ href: '/history', label: 'History' }` after Wishlist.
- [ ] **Step 6:** Commit.

---

## Task 11: Verify

- [ ] **Step 1:** `npm test` → all pass (old + new).
- [ ] **Step 2:** `npm run build` → no type errors, all routes present (including `/history`, `/api/items/[id]/funding`, `/complete`, `/restore`).
- [ ] **Step 3:** Smoke via dev server: add funding to Laptop (history shows tx, fundedAmount rises), edit an item, complete an item (moves to /history), confirm Dashboard shows Recovery Time + Total Future Liability, queue rows show Remaining + Projected.
- [ ] **Step 4:** Commit any fixes.

---

## Self-review notes

- **Spec coverage:** #1 Edit → Task 9 (EditableItemRow + ItemForm). #2 Complete/history → Tasks 8,10. #3 Remaining → Tasks 4,9. #4 Liability card → Tasks 4,10. #5 Transactions → Tasks 1,2,3,5,6,7,9. #6 Recovery time → Tasks 4,10. #7 Projected completion → Tasks 4,9,10.
- **Type consistency:** `remaining`, `isActive`, `isDone`, `totalFutureLiability`, `reserveRecoveryMonths`, `projectedCompletion` defined in Task 4 and consumed identically in Tasks 9–10. `fundedAmount` removed from schema (1), validation (5), API (6), form (9); derived in data (3).
- **No placeholders:** all steps show complete code or exact edits.
