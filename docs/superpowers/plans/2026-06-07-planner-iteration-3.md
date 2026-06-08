# Planner Iteration 3 Implementation Plan (P2)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Add a drag-and-drop Priority Ranking view, wishlist aging, and wishlist→goal conversion.

**Architecture:** Add an integer `rank` to `PlanItem` used as a within-priority tiebreaker in `sortQueue` (so it flows into the projection engine for free). Native HTML5 drag persists order via a reorder endpoint. Conversion flips a wishlist record to a GOAL in place, preserving id and funding history.

**Tech Stack:** Next.js (App Router), TypeScript, Tailwind, Prisma/SQLite, Zod, Vitest.

---

## Task 1: Schema — add rank

**Files:** Modify `prisma/schema.prisma`

- [ ] **Step 1:** Add to `PlanItem` (after `purchased`):
```prisma
  rank Int @default(0)
```
- [ ] **Step 2:** `npm run db:push --` (it will warn; no data loss for an added column). Expect "in sync" + client regenerated. If it prompts for data loss, it is safe to accept.
- [ ] **Step 3:** Commit: `git add prisma && git commit -m "feat: add rank column to PlanItem"`

---

## Task 2: Types + seed ranks

**Files:** Modify `lib/types.ts`, `prisma/seed.ts`

- [ ] **Step 1:** In `lib/types.ts` `Item`, add `rank: number;` (after `priority`).
- [ ] **Step 2:** In `prisma/seed.ts`, give each created item a rank by array index. Change the loop to use the index:
```typescript
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    await prisma.planItem.create({
      data: {
        type: it.type, title: it.title, amount: it.amount, priority: it.priority,
        rank: idx,
        dueDate: it.dueDate ?? null, status: it.status ?? null, notes: it.notes ?? null,
        coolingPeriodDays: it.coolingPeriodDays ?? 30, dateAdded: it.dateAdded ?? new Date(),
        fundings: it.funded > 0
          ? { create: { amount: it.funded, note: 'Initial allocation', date: it.dateAdded ?? new Date() } }
          : undefined,
      },
    });
  }
```
- [ ] **Step 3:** `npm run db:seed`; verify `node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.planItem.findMany({orderBy:{rank:'asc'},select:{title:true,rank:true}}).then(r=>{console.log(r);return p.\$disconnect()})"` shows ranks 0..8.
- [ ] **Step 4:** Commit.

---

## Task 3: Data layer — expose rank

**Files:** Modify `lib/data.ts`

- [ ] **Step 1:** In `getItems`, add `rank: r.rank,` to the mapped object (after `priority`).
- [ ] **Step 2:** Commit.

---

## Task 4: format.daysSince (TDD)

**Files:** Modify `lib/format.ts`; `lib/__tests__/format.test.ts`

- [ ] **Step 1: Failing test** (append to format.test.ts):
```typescript
import { daysSince } from '@/lib/format';

describe('daysSince', () => {
  it('counts whole days elapsed', () => {
    expect(daysSince('2026-06-01T00:00:00.000Z', '2026-06-07T00:00:00.000Z')).toBe(6);
  });
  it('is 0 for same day', () => {
    expect(daysSince('2026-06-07T00:00:00.000Z', '2026-06-07T00:00:00.000Z')).toBe(0);
  });
  it('clamps future dates to 0', () => {
    expect(daysSince('2026-06-10T00:00:00.000Z', '2026-06-07T00:00:00.000Z')).toBe(0);
  });
});
```
- [ ] **Step 2:** `npm test -- format` → FAIL.
- [ ] **Step 3: Implement** (append to format.ts):
```typescript
export function daysSince(iso: string, fromIso: string): number {
  const ms = new Date(fromIso).getTime() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}
```
- [ ] **Step 4:** `npm test -- format` → PASS.
- [ ] **Step 5:** Commit.

---

## Task 5: sortQueue rank tiebreak (TDD)

**Files:** Modify `lib/finance.ts`; `lib/__tests__/finance.test.ts`

- [ ] **Step 1:** The shared `item()` factory in finance.test.ts must supply `rank`. Add `rank: 0,` to its defaults (after `priority: 3,`).
- [ ] **Step 2: Failing test** (append):
```typescript
describe('sortQueue rank tiebreak', () => {
  it('orders by rank within the same priority', () => {
    const items = [
      item({ title: 'B', priority: 5, rank: 2, type: 'COMMITMENT', dueDate: '2026-07-01T00:00:00.000Z' }),
      item({ title: 'A', priority: 5, rank: 1, type: 'COMMITMENT', dueDate: '2026-09-01T00:00:00.000Z' }),
      item({ title: 'C', priority: 4, rank: 0, type: 'GOAL', dueDate: '2026-06-01T00:00:00.000Z' }),
    ];
    // priority 5 group ordered by rank (A before B) despite A's later dueDate; then priority 4.
    expect(sortQueue(items).map((i) => i.title)).toEqual(['A', 'B', 'C']);
  });
});
```
- [ ] **Step 3:** `npm test -- finance` → FAIL (current sort uses dueDate before rank → returns B, A, C).
- [ ] **Step 4: Implement** — update `sortQueue` comparator:
```typescript
export function sortQueue(items: Item[]): Item[] {
  return items
    .filter((i) => i.type !== 'WISHLIST')
    .slice()
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.rank !== b.rank) return a.rank - b.rank;
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      return a.title.localeCompare(b.title);
    });
}
```
- [ ] **Step 5:** `npm test` → all pass. (Existing sortQueue test uses default rank 0 for all, so dueDate still breaks ties there — unaffected.)
- [ ] **Step 6:** Commit.

---

## Task 6: Validation — reorder + convert schemas

**Files:** Modify `lib/validation.ts`

- [ ] **Step 1:** Append:
```typescript
export const reorderSchema = z.object({
  ids: z.array(z.string()).min(1),
});

export const convertSchema = z.object({
  amount: z.number().min(0),
  dueDate: z.string().datetime(),
  priority: z.number().int().min(1).max(5),
});
```
- [ ] **Step 2:** Commit.

---

## Task 7: API — set rank on create

**Files:** Modify `app/api/items/route.ts`

- [ ] **Step 1:** In `POST`, before `prisma.planItem.create`, compute the next rank:
```typescript
  const max = await prisma.planItem.aggregate({ _max: { rank: true } });
  const nextRank = (max._max.rank ?? -1) + 1;
```
and add `rank: nextRank,` to the `data` object.
- [ ] **Step 2:** Commit.

---

## Task 8: API — reorder + convert

**Files:** Create `app/api/items/reorder/route.ts`, `app/api/items/[id]/convert/route.ts`

- [ ] **Step 1:** reorder route:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { reorderSchema } from '@/lib/validation';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
  await prisma.$transaction(
    parsed.data.ids.map((id, index) =>
      prisma.planItem.updateMany({ where: { id }, data: { rank: index } }),
    ),
  );
  return NextResponse.json({ ok: true });
}
```
(`updateMany` is used so a stale/non-existent id is a no-op rather than throwing.)

- [ ] **Step 2:** convert route:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { convertSchema } from '@/lib/validation';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await prisma.planItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (item.type !== 'WISHLIST') return NextResponse.json({ error: 'Only wishlist items can be converted' }, { status: 400 });
  const body = await req.json();
  const parsed = convertSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
  const updated = await prisma.planItem.update({
    where: { id },
    data: {
      type: 'GOAL',
      amount: parsed.data.amount,
      dueDate: new Date(parsed.data.dueDate),
      priority: parsed.data.priority,
      purchased: false,
      status: null,
    },
  });
  return NextResponse.json(updated);
}
```
- [ ] **Step 3:** Commit.

---

## Task 9: Ranking view + drag

**Files:** Create `components/RankingList.tsx`, `app/ranking/page.tsx`; modify `components/Nav.tsx`

- [ ] **Step 1:** `RankingList` (client, native HTML5 drag):
```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Item } from '@/lib/types';

const badge: Record<string, string> = {
  COMMITMENT: 'bg-red-100 text-red-700', GOAL: 'bg-purple-100 text-purple-700',
  EXPERIENCE: 'bg-blue-100 text-blue-700', WISHLIST: 'bg-gray-100 text-gray-700',
};

export function RankingList({ initial }: { initial: Item[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);

  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const next = [...items];
    const from = next.findIndex((i) => i.id === dragId);
    const to = next.findIndex((i) => i.id === targetId);
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
    setDragId(null);
    fetch('/api/items/reorder', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: next.map((i) => i.id) }),
    }).then(() => router.refresh());
  }

  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li
          key={i.id}
          draggable
          onDragStart={() => setDragId(i.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => onDrop(i.id)}
          className={`flex cursor-move items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 ${dragId === i.id ? 'opacity-50' : ''}`}
        >
          <span className="text-gray-400">⠿</span>
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge[i.type]}`}>{i.type}</span>
          <span className="font-medium">{i.title}</span>
          <span className="ml-auto text-xs text-gray-500">P{i.priority}</span>
        </li>
      ))}
    </ul>
  );
}
```
- [ ] **Step 2:** `app/ranking/page.tsx`:
```tsx
import { Card } from '@/components/Card';
import { RankingList } from '@/components/RankingList';
import { getItems } from '@/lib/data';
import { sortQueue, isActive } from '@/lib/finance';

export const dynamic = 'force-dynamic';

export default async function RankingPage() {
  const items = sortQueue((await getItems()).filter(isActive));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Priority Ranking</h1>
      <p className="text-sm text-gray-500">
        Drag to reorder. Ranking sets the order <em>within</em> a priority level — higher-priority
        items always stay on top. This order drives the queue and the simulator&apos;s projections.
      </p>
      <Card>
        {items.length === 0 ? <p className="text-sm text-gray-500">No active items.</p> : <RankingList initial={items} />}
      </Card>
    </div>
  );
}
```
- [ ] **Step 3:** Nav — add `{ href: '/ranking', label: 'Ranking' }` after Priority Queue.
- [ ] **Step 4:** Verify build; commit.

---

## Task 10: Wishlist aging + convert UI

**Files:** Create `components/ConvertForm.tsx`; modify `components/WishlistRow.tsx`, `app/wishlist/page.tsx`

- [ ] **Step 1:** `ConvertForm` (client):
```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ConvertForm({ itemId, defaultAmount }: { itemId: string; defaultAmount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(defaultAmount));
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState(3);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!dueDate) { setError('Pick a target date.'); return; }
    const res = await fetch(`/api/items/${itemId}/convert`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount: Number(amount), dueDate: new Date(dueDate).toISOString(), priority: Number(priority) }),
    });
    if (!res.ok) { setError('Conversion failed.'); return; }
    router.refresh();
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} className="text-xs text-purple-600 hover:underline">Convert to Goal</button>;
  }
  const input = 'rounded border border-gray-300 px-2 py-1 text-sm';
  return (
    <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2">
      <input className={input} type="number" placeholder="Target amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <input className={input} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      <select className={input} value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
        {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>P{p}</option>)}
      </select>
      <button className="rounded bg-purple-600 px-3 py-1 text-sm font-medium text-white hover:bg-purple-700">Convert</button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:underline">Cancel</button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  );
}
```
- [ ] **Step 2:** `WishlistRow` — add aging line + ConvertForm. Add prop `daysOld: number`. Import `ConvertForm`. Under the existing `<Money>/P{priority}` line add:
```tsx
        <p className="text-xs text-gray-400">Added: {daysOld} day{daysOld === 1 ? '' : 's'} ago</p>
```
and in the left `<div>`, after the messages, add `{!item.purchased && <ConvertForm itemId={item.id} defaultAmount={item.amount} />}`.
- [ ] **Step 3:** `app/wishlist/page.tsx` — compute `daysOld` with `daysSince(i.dateAdded, now)` and pass to `WishlistRow`. Import `daysSince`. Change the mapped object to include `daysOld: daysSince(i.dateAdded, now)` and pass `daysOld={daysOld}`.
- [ ] **Step 4:** Verify; commit.

---

## Task 11: Verify

- [ ] **Step 1:** `npm test` → all pass.
- [ ] **Step 2:** `npm run build` → clean; routes include `/ranking`, `/api/items/reorder`, `/api/items/[id]/convert`.
- [ ] **Step 3:** Smoke (dev server): reorder two same-priority items on `/ranking` → order persists after refresh and queue reflects it; wishlist shows "Added: N days ago"; convert a wishlist item → it becomes a GOAL (appears in queue/timeline, leaves wishlist, keeps any funding).
- [ ] **Step 4:** Commit fixes; update README (add Ranking view, aging, conversion; link iteration-3 docs).

---

## Self-review notes

- **Spec coverage:** #8 → Tasks 1,2,3,5,7,8,9. #9 → Tasks 4,10. #10 → Tasks 6,8,10.
- **Type consistency:** `rank` added to schema (1), Item type (2), data layer (3), seed (2), create API (7); `sortQueue`/projection consume it (5). `reorderSchema`/`convertSchema` (6) used by routes (8). `daysSince` defined (4), used in wishlist (10).
- **No placeholders:** all steps contain concrete code/edits.
