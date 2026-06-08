# Financial Priority Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-user Next.js web app that surfaces all future financial claims (commitments, goals, experiences, wishes) and simulates whether a purchase is safe today.

**Architecture:** Next.js App Router with API route handlers over a Prisma/SQLite store. All money math lives in pure, unit-tested functions in `lib/finance.ts`. A unified `PlanItem` table plus a singleton `FinancialProfile` keep queue/projection logic to a single sort + loop.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS, Prisma + SQLite, Zod (validation), Vitest (unit tests).

---

## File structure

```
budget-tracker/
├── package.json, tsconfig.json, next.config.ts, tailwind/postcss config
├── prisma/schema.prisma          FinancialProfile + PlanItem + enums
├── prisma/seed.ts                demo data
├── lib/
│   ├── types.ts                  ItemType/Status enums, shared interfaces
│   ├── format.ts                 ₹ INR formatting, month/date helpers
│   ├── finance.ts                pure domain logic (surplus, deficit, progress, sort, projection, simulate)
│   ├── db.ts                     Prisma client singleton
│   └── validation.ts             Zod schemas for profile/item/simulate
├── lib/__tests__/finance.test.ts, format.test.ts
├── app/
│   ├── layout.tsx, globals.css, page.tsx (Dashboard)
│   ├── queue/page.tsx, timeline/page.tsx, wishlist/page.tsx, simulator/page.tsx
│   └── api/
│       ├── profile/route.ts
│       ├── items/route.ts
│       ├── items/[id]/route.ts
│       ├── items/[id]/purchase/route.ts
│       └── simulate/route.ts
└── components/
    ├── Nav.tsx, Card.tsx, ProgressBar.tsx, Money.tsx
    ├── ItemForm.tsx, ItemRow.tsx
    └── RecommendationBanner.tsx
```

---

## Task 1: Scaffold Next.js + Tailwind + tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `app/globals.css`, `app/layout.tsx`, `app/page.tsx`

- [ ] **Step 1: Create the project non-interactively**

Run from the repo root (`/workspaces/repos/personalProjects/budget-tracker`):
```bash
npx --yes create-next-app@latest . \
  --ts --tailwind --eslint --app --no-src-dir \
  --import-alias "@/*" --use-npm --skip-install --yes
```
If `create-next-app` refuses because the dir is non-empty, scaffold into a temp dir and copy files in (preserve `docs/`, `.git/`, `.gitignore`).

- [ ] **Step 2: Install dependencies**

```bash
npm install
npm install prisma @prisma/client zod
npm install -D vitest @vitejs/plugin-react vitest-environment-jsdom tsx
```

- [ ] **Step 3: Add scripts to package.json**

Ensure `package.json` "scripts" contains:
```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest run",
  "db:push": "prisma db push",
  "db:seed": "tsx prisma/seed.ts"
}
```
And add: `"prisma": { "seed": "tsx prisma/seed.ts" }` at top level.

- [ ] **Step 4: Verify dev server boots**

Run: `npm run build`
Expected: build completes without type errors (default starter page).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js + Tailwind + Prisma/Zod/Vitest deps"
```

---

## Task 2: Configure Vitest

**Files:**
- Create: `vitest.config.ts`

- [ ] **Step 1: Write the config**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'node', globals: true },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
});
```

- [ ] **Step 2: Add a smoke test**

```typescript
// lib/__tests__/smoke.test.ts
import { describe, it, expect } from 'vitest';
describe('smoke', () => { it('runs', () => { expect(1 + 1).toBe(2); }); });
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 1 passing test.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test: configure vitest with @ alias"
```

---

## Task 3: Prisma schema + client

**Files:**
- Create: `prisma/schema.prisma`, `lib/db.ts`
- Create: `.env`

- [ ] **Step 1: Write `.env`**

```
DATABASE_URL="file:./dev.db"
```

- [ ] **Step 2: Write the schema**

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model FinancialProfile {
  id                 Int   @id @default(1)
  protectedCapital   Float @default(0)
  reserveTarget      Float @default(0)
  reserveCurrent     Float @default(0)
  monthlyIncome      Float @default(0)
  monthlyExpenses    Float @default(0)
  monthlyInvestments Float @default(0)
  updatedAt          DateTime @updatedAt
}

model PlanItem {
  id                String   @id @default(cuid())
  type              String   // COMMITMENT | GOAL | EXPERIENCE | WISHLIST
  title             String
  amount            Float    @default(0)
  fundedAmount      Float    @default(0)
  priority          Int      @default(3)
  dueDate           DateTime?
  status            String?  // PLANNED | FUNDED | COMPLETED (commitments)
  notes             String?
  coolingPeriodDays Int      @default(30)
  dateAdded         DateTime @default(now())
  purchased         Boolean  @default(false)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

(SQLite has no native enums; we store enum values as validated strings — Zod enforces them.)

- [ ] **Step 3: Push schema to DB**

Run: `npm run db:push`
Expected: "Your database is now in sync with your Prisma schema." and `prisma/dev.db` created.

- [ ] **Step 4: Write the Prisma client singleton**

```typescript
// lib/db.ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add Prisma schema (FinancialProfile, PlanItem) and client"
```

---

## Task 4: Shared types

**Files:**
- Create: `lib/types.ts`

- [ ] **Step 1: Write the types**

```typescript
// lib/types.ts
export const ITEM_TYPES = ['COMMITMENT', 'GOAL', 'EXPERIENCE', 'WISHLIST'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const STATUSES = ['PLANNED', 'FUNDED', 'COMPLETED'] as const;
export type Status = (typeof STATUSES)[number];

export interface Profile {
  protectedCapital: number;
  reserveTarget: number;
  reserveCurrent: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyInvestments: number;
}

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  amount: number;
  fundedAmount: number;
  priority: number;
  dueDate: string | null; // ISO
  status: Status | null;
  notes: string | null;
  coolingPeriodDays: number;
  dateAdded: string; // ISO
  purchased: boolean;
}

export type Recommendation = 'SAFE' | 'CAUTION' | 'WAIT';
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat: add shared domain types"
```

---

## Task 5: Formatting helpers (TDD)

**Files:**
- Create: `lib/format.ts`
- Test: `lib/__tests__/format.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/__tests__/format.test.ts
import { describe, it, expect } from 'vitest';
import { formatINR, formatMonth, daysUntil } from '@/lib/format';

describe('formatINR', () => {
  it('uses Indian digit grouping with ₹', () => {
    expect(formatINR(420000)).toBe('₹4,20,000');
    expect(formatINR(5400)).toBe('₹5,400');
    expect(formatINR(0)).toBe('₹0');
  });
  it('rounds to whole rupees', () => {
    expect(formatINR(5400.6)).toBe('₹5,401');
  });
});

describe('formatMonth', () => {
  it('formats ISO date as "Mon YYYY"', () => {
    expect(formatMonth('2026-07-15T00:00:00.000Z')).toBe('Jul 2026');
  });
});

describe('daysUntil', () => {
  it('returns whole days from a reference date to a future date', () => {
    expect(daysUntil('2026-06-10T00:00:00.000Z', '2026-06-07T00:00:00.000Z')).toBe(3);
  });
  it('clamps negatives to 0', () => {
    expect(daysUntil('2026-06-01T00:00:00.000Z', '2026-06-07T00:00:00.000Z')).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- format`
Expected: FAIL — module not found / functions undefined.

- [ ] **Step 3: Implement**

```typescript
// lib/format.ts
export function formatINR(amount: number): string {
  const rounded = Math.round(amount);
  const formatted = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(rounded);
  return `₹${formatted}`;
}

export function formatMonth(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function daysUntil(targetIso: string, fromIso: string): number {
  const ms = new Date(targetIso).getTime() - new Date(fromIso).getTime();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  return Math.max(0, days);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- format`
Expected: PASS (all format tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add INR/date formatting helpers with tests"
```

---

## Task 6: Core finance math — surplus, deficit, progress, sort (TDD)

**Files:**
- Create: `lib/finance.ts`
- Test: `lib/__tests__/finance.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/__tests__/finance.test.ts
import { describe, it, expect } from 'vitest';
import { monthlySurplus, reserveDeficit, fundingProgress, sortQueue } from '@/lib/finance';
import type { Item, Profile } from '@/lib/types';

const profile: Profile = {
  protectedCapital: 200000, reserveTarget: 500000, reserveCurrent: 420000,
  monthlyIncome: 150000, monthlyExpenses: 70000, monthlyInvestments: 30000,
};

function item(p: Partial<Item>): Item {
  return {
    id: Math.random().toString(36).slice(2), type: 'GOAL', title: 't', amount: 100000,
    fundedAmount: 0, priority: 3, dueDate: null, status: null, notes: null,
    coolingPeriodDays: 30, dateAdded: '2026-06-07T00:00:00.000Z', purchased: false, ...p,
  };
}

describe('monthlySurplus', () => {
  it('is income - expenses - investments', () => {
    expect(monthlySurplus(profile)).toBe(50000);
  });
});

describe('reserveDeficit', () => {
  it('is positive target minus current', () => {
    expect(reserveDeficit(profile)).toBe(80000);
  });
  it('is 0 when current exceeds target', () => {
    expect(reserveDeficit({ ...profile, reserveCurrent: 600000 })).toBe(0);
  });
});

describe('fundingProgress', () => {
  it('computes percentage', () => {
    expect(fundingProgress(item({ amount: 100000, fundedAmount: 60000 }))).toEqual({
      funded: 60000, target: 100000, pct: 60,
    });
  });
  it('returns 0 pct when target is 0', () => {
    expect(fundingProgress(item({ amount: 0, fundedAmount: 0 })).pct).toBe(0);
  });
});

describe('sortQueue', () => {
  it('sorts priority desc then due date asc, excludes wishlist', () => {
    const items = [
      item({ title: 'Car', priority: 4, dueDate: '2027-01-01T00:00:00.000Z' }),
      item({ title: 'Laptop', priority: 5, dueDate: '2026-07-01T00:00:00.000Z', type: 'COMMITMENT' }),
      item({ title: 'Wedding', priority: 5, dueDate: '2026-08-01T00:00:00.000Z', type: 'COMMITMENT' }),
      item({ title: 'Crocs', priority: 5, type: 'WISHLIST' }),
    ];
    expect(sortQueue(items).map((i) => i.title)).toEqual(['Laptop', 'Wedding', 'Car']);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- finance`
Expected: FAIL — functions undefined.

- [ ] **Step 3: Implement**

```typescript
// lib/finance.ts
import type { Item, Profile } from '@/lib/types';

export function monthlySurplus(p: Profile): number {
  return p.monthlyIncome - p.monthlyExpenses - p.monthlyInvestments;
}

export function reserveDeficit(p: Profile): number {
  return Math.max(0, p.reserveTarget - p.reserveCurrent);
}

export function fundingProgress(item: Item): { funded: number; target: number; pct: number } {
  const pct = item.amount > 0 ? Math.round((item.fundedAmount / item.amount) * 100) : 0;
  return { funded: item.fundedAmount, target: item.amount, pct };
}

/** Queue: non-wishlist items, priority desc, then dueDate asc (nulls last), then title. */
export function sortQueue(items: Item[]): Item[] {
  return items
    .filter((i) => i.type !== 'WISHLIST')
    .slice()
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      return a.title.localeCompare(b.title);
    });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- finance`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add core finance math (surplus, deficit, progress, sort)"
```

---

## Task 7: Projection engine (TDD)

**Files:**
- Modify: `lib/finance.ts`
- Test: `lib/__tests__/finance.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```typescript
// append to lib/__tests__/finance.test.ts
import { projectFunding } from '@/lib/finance';

describe('projectFunding', () => {
  it('refills reserve first, then funds items by priority', () => {
    // surplus 50k/mo. reserve deficit 80k => months 1,2 refill reserve (50k,30k).
    // month 2 leaves 20k for items; month 3 onward full 50k.
    const p = { ...profile };
    const items = [
      item({ id: 'a', title: 'Laptop', type: 'COMMITMENT', priority: 5, amount: 100000, fundedAmount: 0 }),
    ];
    const res = projectFunding(p, items, {});
    // Laptop needs 100k. Available for items: m2=20k(total20k), m3=50k(70k), m4=50k(120k>=100k) => month 4.
    expect(res.completionMonth['a']).toBe(4);
  });

  it('honors startReserve override (purchase scenario lowers reserve)', () => {
    const p = { ...profile };
    const items = [item({ id: 'a', title: 'Laptop', type: 'COMMITMENT', priority: 5, amount: 100000 })];
    // startReserve far below target => more months spent refilling => later completion.
    const res = projectFunding(p, items, { startReserve: 300000 });
    expect(res.completionMonth['a']).toBeGreaterThan(4);
  });

  it('never funds wishlist items', () => {
    const items = [item({ id: 'w', type: 'WISHLIST', amount: 5000, priority: 5 })];
    const res = projectFunding({ ...profile }, items, {});
    expect(res.completionMonth['w']).toBeUndefined();
  });

  it('caps at the horizon when surplus cannot fund an item', () => {
    const p = { ...profile, monthlyIncome: 100000, monthlyExpenses: 100000, monthlyInvestments: 0 }; // surplus 0
    const items = [item({ id: 'a', type: 'GOAL', amount: 100000, fundedAmount: 0 })];
    const res = projectFunding(p, items, {});
    expect(res.completionMonth['a']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- finance`
Expected: FAIL — `projectFunding` undefined.

- [ ] **Step 3: Implement**

```typescript
// append to lib/finance.ts

export interface ProjectionResult {
  /** item id -> month index (1-based) at which it reaches its amount */
  completionMonth: Record<string, number>;
}

export interface ProjectOpts {
  startReserve?: number;
  horizon?: number; // default 120
}

/**
 * Month-by-month allocation of monthly surplus.
 * Each month: add surplus to pool, refill Opportunity Reserve to target first,
 * then fund queue items (priority desc, due asc), skipping wishlist/completed/purchased.
 */
export function projectFunding(p: Profile, items: Item[], opts: ProjectOpts): ProjectionResult {
  const surplus = Math.max(0, monthlySurplus(p));
  const horizon = opts.horizon ?? 120;
  let reserve = opts.startReserve ?? p.reserveCurrent;

  const fundable = sortQueue(items).filter(
    (i) => i.status !== 'COMPLETED' && !i.purchased,
  );
  const funded: Record<string, number> = {};
  fundable.forEach((i) => (funded[i.id] = i.fundedAmount));

  const completionMonth: Record<string, number> = {};
  // already-complete items complete at month 0
  fundable.forEach((i) => {
    if (funded[i.id] >= i.amount && i.amount > 0) completionMonth[i.id] = 0;
  });

  for (let month = 1; month <= horizon; month++) {
    let pool = surplus;
    if (pool <= 0) break;

    // 1. refill reserve to target
    if (reserve < p.reserveTarget) {
      const need = p.reserveTarget - reserve;
      const add = Math.min(need, pool);
      reserve += add;
      pool -= add;
    }

    // 2. fund items in priority order
    for (const it of fundable) {
      if (pool <= 0) break;
      if (completionMonth[it.id] !== undefined) continue;
      const need = it.amount - funded[it.id];
      if (need <= 0) { completionMonth[it.id] = month; continue; }
      const add = Math.min(need, pool);
      funded[it.id] += add;
      pool -= add;
      if (funded[it.id] >= it.amount) completionMonth[it.id] = month;
    }

    if (fundable.every((i) => completionMonth[i.id] !== undefined)) break;
  }

  return { completionMonth };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- finance`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add month-by-month projection engine"
```

---

## Task 8: Purchase impact simulator (TDD)

**Files:**
- Modify: `lib/finance.ts`
- Test: `lib/__tests__/finance.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```typescript
// append to lib/__tests__/finance.test.ts
import { simulatePurchase } from '@/lib/finance';

describe('simulatePurchase', () => {
  const goals: Item[] = [
    item({ id: 'car', title: 'Car', type: 'GOAL', priority: 4, amount: 600000, fundedAmount: 0, dueDate: '2028-01-01T00:00:00.000Z' }),
  ];

  it('small purchase is SAFE with no goal impact', () => {
    const r = simulatePurchase({ ...profile }, goals, 5400);
    expect(r.reserveBefore).toBe(420000);
    expect(r.reserveAfter).toBe(414600);
    expect(r.recommendation).toBe('SAFE');
    expect(r.goalImpacts.every((g) => g.delayMonths === 0)).toBe(true);
  });

  it('large purchase that delays a goal recommends WAIT', () => {
    const r = simulatePurchase({ ...profile }, goals, 200000);
    expect(r.reserveAfter).toBe(220000);
    const car = r.goalImpacts.find((g) => g.title === 'Car');
    expect(car!.delayMonths).toBeGreaterThan(0);
    expect(r.recommendation).toBe('WAIT');
  });

  it('purchase larger than reserve recommends WAIT and flags negative', () => {
    const r = simulatePurchase({ ...profile }, goals, 500000);
    expect(r.reserveAfter).toBeLessThan(0);
    expect(r.recommendation).toBe('WAIT');
  });

  it('reports reductionPct', () => {
    const r = simulatePurchase({ ...profile }, goals, 42000);
    expect(Math.round(r.reductionPct * 10) / 10).toBe(10);
  });

  it('zero surplus yields null monthsToRestore', () => {
    const p = { ...profile, monthlyIncome: 100000, monthlyExpenses: 100000, monthlyInvestments: 0 };
    const r = simulatePurchase(p, goals, 50000);
    expect(r.monthsToRestore).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- finance`
Expected: FAIL — `simulatePurchase` undefined.

- [ ] **Step 3: Implement**

```typescript
// append to lib/finance.ts
import type { Recommendation } from '@/lib/types';

export interface GoalImpact {
  title: string;
  baselineMonth: number | null;
  newMonth: number | null;
  delayMonths: number;
}

export interface SimulationResult {
  cost: number;
  reserveBefore: number;
  reserveAfter: number;
  reductionPct: number;
  monthsToRestore: number | null;
  goalImpacts: GoalImpact[];
  underfunded: string[];
  recommendation: Recommendation;
  message: string;
}

export function simulatePurchase(p: Profile, items: Item[], cost: number): SimulationResult {
  const surplus = monthlySurplus(p);
  const reserveBefore = p.reserveCurrent;
  const reserveAfter = reserveBefore - cost;
  const reductionPct = reserveBefore > 0 ? (cost / reserveBefore) * 100 : 100;

  // months to restore reserve to target from the post-purchase level
  let monthsToRestore: number | null = null;
  if (surplus > 0) {
    const deficitAfter = Math.max(0, p.reserveTarget - reserveAfter);
    monthsToRestore = deficitAfter === 0 ? 0 : Math.ceil(deficitAfter / surplus);
  }

  // baseline vs post-purchase projection
  const baseline = projectFunding(p, items, {});
  const after = projectFunding(p, items, { startReserve: reserveAfter });

  const goalImpacts: GoalImpact[] = items
    .filter((i) => i.type === 'GOAL')
    .map((g) => {
      const b = baseline.completionMonth[g.id] ?? null;
      const n = after.completionMonth[g.id] ?? null;
      const delay = b !== null && n !== null ? Math.max(0, n - b) : b === null && n === null ? 0 : 999;
      return { title: g.title, baselineMonth: b, newMonth: n, delayMonths: delay };
    });

  // commitments/experiences projected past their due date
  const underfunded: string[] = [];
  for (const it of items) {
    if (it.type === 'WISHLIST' || !it.dueDate) continue;
    const completeMonth = after.completionMonth[it.id];
    if (completeMonth === undefined) { underfunded.push(it.title); continue; }
  }

  let recommendation: Recommendation = 'SAFE';
  if (reserveAfter < 0 || goalImpacts.some((g) => g.delayMonths > 0)) {
    recommendation = 'WAIT';
  } else if (reductionPct > 10) {
    recommendation = 'CAUTION';
  }

  const message = buildMessage(cost, reductionPct, goalImpacts, recommendation, reserveAfter);
  return { cost, reserveBefore, reserveAfter, reductionPct, monthsToRestore, goalImpacts, underfunded, recommendation, message };
}

function buildMessage(
  cost: number, reductionPct: number, goalImpacts: GoalImpact[],
  rec: Recommendation, reserveAfter: number,
): string {
  if (reserveAfter < 0) {
    return `This purchase exceeds your Opportunity Reserve. Recommendation: Wait.`;
  }
  const delayed = goalImpacts.filter((g) => g.delayMonths > 0);
  if (delayed.length > 0) {
    const parts = delayed.map((g) => `${g.title} by ${g.delayMonths} month${g.delayMonths > 1 ? 's' : ''}`);
    return `This delays ${parts.join(', ')}. Recommendation: Wait.`;
  }
  if (rec === 'CAUTION') {
    return `This reduces your reserve by ${reductionPct.toFixed(1)}%. No goal impact, but it's a sizable draw. Recommendation: Proceed with caution.`;
  }
  return `This reduces your reserve by ${reductionPct.toFixed(1)}%. No impact on funded commitments. Recommendation: Safe to buy.`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- finance`
Expected: PASS (all finance tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add purchase impact simulator with recommendations"
```

---

## Task 9: Zod validation schemas

**Files:**
- Create: `lib/validation.ts`

- [ ] **Step 1: Implement schemas**

```typescript
// lib/validation.ts
import { z } from 'zod';
import { ITEM_TYPES, STATUSES } from '@/lib/types';

export const profileSchema = z.object({
  protectedCapital: z.number().min(0),
  reserveTarget: z.number().min(0),
  reserveCurrent: z.number().min(0),
  monthlyIncome: z.number().min(0),
  monthlyExpenses: z.number().min(0),
  monthlyInvestments: z.number().min(0),
});

export const itemSchema = z
  .object({
    type: z.enum(ITEM_TYPES),
    title: z.string().min(1),
    amount: z.number().min(0),
    fundedAmount: z.number().min(0).default(0),
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

export const simulateSchema = z.object({
  name: z.string().optional(),
  cost: z.number().positive(),
});
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat: add zod validation schemas"
```

---

## Task 10: Seed data

**Files:**
- Create: `prisma/seed.ts`

- [ ] **Step 1: Write the seed script**

```typescript
// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.planItem.deleteMany();
  await prisma.financialProfile.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      protectedCapital: 200000,
      reserveTarget: 500000,
      reserveCurrent: 420000,
      monthlyIncome: 150000,
      monthlyExpenses: 70000,
      monthlyInvestments: 30000,
    },
  });

  await prisma.planItem.createMany({
    data: [
      { type: 'COMMITMENT', title: 'Laptop', amount: 100000, fundedAmount: 60000, priority: 5, dueDate: new Date('2026-07-15'), status: 'PLANNED' },
      { type: 'COMMITMENT', title: "Friend's Wedding", amount: 40000, fundedAmount: 10000, priority: 5, dueDate: new Date('2026-08-10'), status: 'PLANNED' },
      { type: 'GOAL', title: 'Car', amount: 600000, fundedAmount: 120000, priority: 4, dueDate: new Date('2028-01-01') },
      { type: 'GOAL', title: 'Wedding Fund', amount: 800000, fundedAmount: 50000, priority: 4, dueDate: new Date('2029-03-01') },
      { type: 'EXPERIENCE', title: 'Lollapalooza', amount: 15000, fundedAmount: 0, priority: 3, dueDate: new Date('2027-01-20') },
      { type: 'EXPERIENCE', title: 'Nepal Trip', amount: 60000, fundedAmount: 5000, priority: 2, dueDate: new Date('2027-02-15') },
      { type: 'WISHLIST', title: 'Crocs', amount: 5400, priority: 2, notes: 'comfy', coolingPeriodDays: 30, dateAdded: new Date('2026-06-01') },
      { type: 'WISHLIST', title: 'Home Theater', amount: 50000, priority: 1, notes: 'nice to have', coolingPeriodDays: 30, dateAdded: new Date('2026-05-20') },
      { type: 'WISHLIST', title: 'Perfume', amount: 4000, priority: 1, coolingPeriodDays: 30, dateAdded: new Date('2026-06-06') },
    ],
  });
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
```

- [ ] **Step 2: Run the seed**

Run: `npm run db:seed`
Expected: completes without error.

- [ ] **Step 3: Verify rows exist**

Run: `npx prisma studio` is interactive — instead verify via a quick script:
```bash
node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.planItem.count().then(c=>{console.log('items',c);return p.\$disconnect();})"
```
Expected: `items 9`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add seed data for all item types"
```

---

## Task 11: API — profile route

**Files:**
- Create: `app/api/profile/route.ts`

- [ ] **Step 1: Implement**

```typescript
// app/api/profile/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { profileSchema } from '@/lib/validation';

export async function GET() {
  const profile = await prisma.financialProfile.upsert({
    where: { id: 1 }, update: {}, create: { id: 1 },
  });
  return NextResponse.json(profile);
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
  const updated = await prisma.financialProfile.update({ where: { id: 1 }, data: parsed.data });
  return NextResponse.json(updated);
}
```

- [ ] **Step 2: Manually verify**

Run dev server (`npm run dev`) in a background shell, then:
```bash
curl -s localhost:3000/api/profile | head -c 200
```
Expected: JSON with the seeded profile values.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add /api/profile route"
```

---

## Task 12: API — items collection + item routes

**Files:**
- Create: `app/api/items/route.ts`, `app/api/items/[id]/route.ts`

- [ ] **Step 1: Implement collection route**

```typescript
// app/api/items/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { itemSchema } from '@/lib/validation';

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type');
  const where = type ? { type } : {};
  const items = await prisma.planItem.findMany({ where, orderBy: { createdAt: 'asc' } });
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = itemSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;
  const created = await prisma.planItem.create({
    data: {
      type: d.type, title: d.title, amount: d.amount, fundedAmount: d.fundedAmount,
      priority: d.priority, dueDate: d.dueDate ? new Date(d.dueDate) : null,
      status: d.status ?? null, notes: d.notes ?? null, coolingPeriodDays: d.coolingPeriodDays,
    },
  });
  return NextResponse.json(created, { status: 201 });
}
```

- [ ] **Step 2: Implement single-item route**

```typescript
// app/api/items/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { itemSchema } from '@/lib/validation';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await prisma.planItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(item);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = itemSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;
  const updated = await prisma.planItem.update({
    where: { id },
    data: {
      type: d.type, title: d.title, amount: d.amount, fundedAmount: d.fundedAmount,
      priority: d.priority, dueDate: d.dueDate ? new Date(d.dueDate) : null,
      status: d.status ?? null, notes: d.notes ?? null, coolingPeriodDays: d.coolingPeriodDays,
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.planItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Manually verify**

```bash
curl -s localhost:3000/api/items | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).length,'items'))"
```
Expected: `9 items`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add /api/items collection and item routes"
```

---

## Task 13: API — wishlist purchase + simulate routes

**Files:**
- Create: `app/api/items/[id]/purchase/route.ts`, `app/api/simulate/route.ts`

- [ ] **Step 1: Implement purchase route (re-validates cooling period)**

```typescript
// app/api/items/[id]/purchase/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { daysUntil } from '@/lib/format';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await prisma.planItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (item.type !== 'WISHLIST') return NextResponse.json({ error: 'Not a wishlist item' }, { status: 400 });

  const expiry = new Date(item.dateAdded);
  expiry.setDate(expiry.getDate() + item.coolingPeriodDays);
  const now = new Date();
  const remaining = daysUntil(expiry.toISOString(), now.toISOString());
  if (remaining > 0) {
    return NextResponse.json({ error: 'Cooling period not expired', daysRemaining: remaining }, { status: 422 });
  }
  const updated = await prisma.planItem.update({ where: { id }, data: { purchased: true } });
  return NextResponse.json(updated);
}
```

- [ ] **Step 2: Implement simulate route**

```typescript
// app/api/simulate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { simulateSchema } from '@/lib/validation';
import { simulatePurchase } from '@/lib/finance';
import type { Item, Profile } from '@/lib/types';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = simulateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });

  const profileRow = await prisma.financialProfile.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const itemRows = await prisma.planItem.findMany();

  const profile: Profile = {
    protectedCapital: profileRow.protectedCapital, reserveTarget: profileRow.reserveTarget,
    reserveCurrent: profileRow.reserveCurrent, monthlyIncome: profileRow.monthlyIncome,
    monthlyExpenses: profileRow.monthlyExpenses, monthlyInvestments: profileRow.monthlyInvestments,
  };
  const items: Item[] = itemRows.map((r) => ({
    id: r.id, type: r.type as Item['type'], title: r.title, amount: r.amount,
    fundedAmount: r.fundedAmount, priority: r.priority,
    dueDate: r.dueDate ? r.dueDate.toISOString() : null, status: r.status as Item['status'],
    notes: r.notes, coolingPeriodDays: r.coolingPeriodDays, dateAdded: r.dateAdded.toISOString(),
    purchased: r.purchased,
  }));

  const result = simulatePurchase(profile, items, parsed.data.cost);
  return NextResponse.json({ name: parsed.data.name ?? null, ...result });
}
```

- [ ] **Step 3: Manually verify**

```bash
curl -s -X POST localhost:3000/api/simulate -H 'content-type: application/json' -d '{"cost":5400}' | head -c 300
```
Expected: JSON with `reserveBefore`, `reserveAfter`, `recommendation`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add wishlist purchase and simulate API routes"
```

---

## Task 14: Shared UI primitives

**Files:**
- Create: `components/Money.tsx`, `components/Card.tsx`, `components/ProgressBar.tsx`, `components/Nav.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Money + Card + ProgressBar**

```tsx
// components/Money.tsx
import { formatINR } from '@/lib/format';
export function Money({ amount }: { amount: number }) {
  return <span>{formatINR(amount)}</span>;
}
```

```tsx
// components/Card.tsx
export function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      {title && <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>}
      {children}
    </div>
  );
}
```

```tsx
// components/ProgressBar.tsx
export function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const color = clamped >= 100 ? 'bg-green-500' : clamped >= 50 ? 'bg-blue-500' : 'bg-amber-500';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
      <div className={`h-full ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}
```

- [ ] **Step 2: Nav**

```tsx
// components/Nav.tsx
import Link from 'next/link';
const links = [
  { href: '/', label: 'Dashboard' },
  { href: '/queue', label: 'Priority Queue' },
  { href: '/timeline', label: 'Timeline' },
  { href: '/wishlist', label: 'Wishlist' },
  { href: '/simulator', label: 'Simulator' },
];
export function Nav() {
  return (
    <nav className="flex gap-1 border-b border-gray-200 bg-white px-6 py-3">
      <span className="mr-4 font-bold text-gray-900">₹ Priority Planner</span>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Wire layout**

```tsx
// app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/Nav';

export const metadata: Metadata = { title: 'Priority Planner', description: 'Should I buy this today?' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <Nav />
        <main className="mx-auto max-w-5xl p-6">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: compiles without type errors.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add shared UI primitives and app layout"
```

---

## Task 15: Data-access helper (server)

**Files:**
- Create: `lib/data.ts`

- [ ] **Step 1: Implement server data loaders that return plain `Item`/`Profile`**

```typescript
// lib/data.ts
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
  const rows = await prisma.planItem.findMany({ orderBy: { createdAt: 'asc' } });
  return rows.map((r) => ({
    id: r.id, type: r.type as Item['type'], title: r.title, amount: r.amount, fundedAmount: r.fundedAmount,
    priority: r.priority, dueDate: r.dueDate ? r.dueDate.toISOString() : null, status: r.status as Item['status'],
    notes: r.notes, coolingPeriodDays: r.coolingPeriodDays, dateAdded: r.dateAdded.toISOString(), purchased: r.purchased,
  }));
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat: add server data-access helpers"
```

---

## Task 16: Dashboard page

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Implement (server component)**

```tsx
// app/page.tsx
import { Card } from '@/components/Card';
import { Money } from '@/components/Money';
import { ProgressBar } from '@/components/ProgressBar';
import { getProfile, getItems } from '@/lib/data';
import { monthlySurplus, reserveDeficit, sortQueue, fundingProgress } from '@/lib/finance';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const profile = await getProfile();
  const items = await getItems();
  const surplus = monthlySurplus(profile);
  const deficit = reserveDeficit(profile);
  const reservePct = profile.reserveTarget > 0 ? Math.round((profile.reserveCurrent / profile.reserveTarget) * 100) : 0;

  const topUnfunded = sortQueue(items).find((i) => fundingProgress(i).pct < 100);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="Protected Capital">
          <p className="text-2xl font-bold"><Money amount={profile.protectedCapital} /></p>
          <p className="mt-1 text-xs text-gray-500">Do not spend</p>
        </Card>
        <Card title="Opportunity Reserve">
          <p className="text-2xl font-bold"><Money amount={profile.reserveCurrent} /></p>
          <p className="mt-1 text-xs text-gray-500">of <Money amount={profile.reserveTarget} /> target</p>
          <div className="mt-2"><ProgressBar pct={reservePct} /></div>
          {deficit > 0 && <p className="mt-1 text-xs text-amber-600">Deficit: <Money amount={deficit} /></p>}
        </Card>
        <Card title="Monthly Surplus">
          <p className={`text-2xl font-bold ${surplus < 0 ? 'text-red-600' : ''}`}><Money amount={surplus} /></p>
          <p className="mt-1 text-xs text-gray-500">
            <Money amount={profile.monthlyIncome} /> − <Money amount={profile.monthlyExpenses} /> − <Money amount={profile.monthlyInvestments} />
          </p>
        </Card>
      </div>
      {topUnfunded && (
        <Card title="Highest-priority unfunded item">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">{topUnfunded.title}</p>
              <p className="text-xs text-gray-500">Priority {topUnfunded.priority} · {topUnfunded.type}</p>
            </div>
            <p className="text-sm"><Money amount={topUnfunded.fundedAmount} /> / <Money amount={topUnfunded.amount} /> ({fundingProgress(topUnfunded).pct}%)</p>
          </div>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run build` then `npm run dev`; load `http://localhost:3000`.
Expected: three cards with seeded values; reserve shows ₹4,20,000 / ₹5,00,000, deficit ₹80,000; surplus ₹50,000; top unfunded = Laptop.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add Dashboard page"
```

---

## Task 17: Priority Queue page + item row/form

**Files:**
- Create: `components/ItemRow.tsx`, `components/ItemForm.tsx`, `app/queue/page.tsx`

- [ ] **Step 1: ItemForm (client) — create/edit**

```tsx
// components/ItemForm.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ITEM_TYPES } from '@/lib/types';
import type { Item } from '@/lib/types';

type Props = { initial?: Item; onDone?: () => void };

export function ItemForm({ initial, onDone }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    type: initial?.type ?? 'COMMITMENT',
    title: initial?.title ?? '',
    amount: initial?.amount ?? 0,
    fundedAmount: initial?.fundedAmount ?? 0,
    priority: initial?.priority ?? 3,
    dueDate: initial?.dueDate ? initial.dueDate.slice(0, 10) : '',
    status: initial?.status ?? 'PLANNED',
    notes: initial?.notes ?? '',
    coolingPeriodDays: initial?.coolingPeriodDays ?? 30,
  });
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      type: form.type, title: form.title, amount: Number(form.amount),
      fundedAmount: Number(form.fundedAmount), priority: Number(form.priority),
      dueDate: form.type !== 'WISHLIST' && form.dueDate ? new Date(form.dueDate).toISOString() : null,
      status: form.type === 'COMMITMENT' ? form.status : null,
      notes: form.notes || null, coolingPeriodDays: Number(form.coolingPeriodDays),
    };
    const url = initial ? `/api/items/${initial.id}` : '/api/items';
    const res = await fetch(url, { method: initial ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) { setError('Could not save. Check required fields.'); return; }
    onDone?.();
    router.refresh();
  }

  const input = 'rounded-md border border-gray-300 px-2 py-1 text-sm';
  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <select className={input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Item['type'] })}>
        {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <input className={input} placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <input className={input} type="number" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
      <input className={input} type="number" placeholder="Funded" value={form.fundedAmount} onChange={(e) => setForm({ ...form, fundedAmount: Number(e.target.value) })} />
      <select className={input} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}>
        {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>P{p}</option>)}
      </select>
      {form.type !== 'WISHLIST' && (
        <input className={input} type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
      )}
      {form.type === 'WISHLIST' && (
        <input className={input} type="number" placeholder="Cooling days" value={form.coolingPeriodDays} onChange={(e) => setForm({ ...form, coolingPeriodDays: Number(e.target.value) })} />
      )}
      <button type="submit" className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700">
        {initial ? 'Save' : 'Add'}
      </button>
      {error && <p className="col-span-full text-xs text-red-600">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 2: ItemRow (client) — display + delete**

```tsx
// components/ItemRow.tsx
'use client';
import { useRouter } from 'next/navigation';
import { Money } from '@/components/Money';
import { ProgressBar } from '@/components/ProgressBar';
import { formatMonth } from '@/lib/format';
import type { Item } from '@/lib/types';

const badge: Record<string, string> = {
  COMMITMENT: 'bg-red-100 text-red-700', GOAL: 'bg-purple-100 text-purple-700',
  EXPERIENCE: 'bg-blue-100 text-blue-700', WISHLIST: 'bg-gray-100 text-gray-700',
};

export function ItemRow({ item }: { item: Item }) {
  const router = useRouter();
  const pct = item.amount > 0 ? Math.round((item.fundedAmount / item.amount) * 100) : 0;
  async function del() {
    if (!confirm(`Delete "${item.title}"?`)) return;
    await fetch(`/api/items/${item.id}`, { method: 'DELETE' });
    router.refresh();
  }
  return (
    <div className="flex items-center gap-4 border-b border-gray-100 py-3">
      <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge[item.type]}`}>{item.type}</span>
      <div className="w-40">
        <p className="font-medium">{item.title}</p>
        <p className="text-xs text-gray-500">P{item.priority}{item.dueDate ? ` · ${formatMonth(item.dueDate)}` : ''}</p>
      </div>
      <div className="flex-1">
        <ProgressBar pct={pct} />
        <p className="mt-1 text-xs text-gray-500"><Money amount={item.fundedAmount} /> / <Money amount={item.amount} /> · {pct}%</p>
      </div>
      <button onClick={del} className="text-xs text-red-500 hover:underline">Delete</button>
    </div>
  );
}
```

- [ ] **Step 3: Queue page (server)**

```tsx
// app/queue/page.tsx
import { Card } from '@/components/Card';
import { ItemRow } from '@/components/ItemRow';
import { ItemForm } from '@/components/ItemForm';
import { getItems } from '@/lib/data';
import { sortQueue } from '@/lib/finance';

export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  const items = await getItems();
  const queue = sortQueue(items);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Priority Queue</h1>
      <Card title="Add item"><ItemForm /></Card>
      <Card>
        {queue.length === 0 ? <p className="text-sm text-gray-500">No items yet.</p> :
          queue.map((i) => <ItemRow key={i.id} item={i} />)}
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Load `/queue`: items appear sorted Laptop, Wedding (both P5, by due date), then Car, Wedding Fund (P4), then experiences. Add a new item; it appears. Delete it; it disappears.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add Priority Queue page with create/edit/delete"
```

---

## Task 18: Timeline page

**Files:**
- Create: `app/timeline/page.tsx`

- [ ] **Step 1: Implement**

```tsx
// app/timeline/page.tsx
import { Card } from '@/components/Card';
import { Money } from '@/components/Money';
import { formatMonth } from '@/lib/format';
import { getItems } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function TimelinePage() {
  const items = (await getItems())
    .filter((i) => i.type !== 'WISHLIST' && i.dueDate)
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Future Timeline</h1>
      <Card>
        {items.length === 0 ? <p className="text-sm text-gray-500">Nothing scheduled.</p> : (
          <ol className="relative border-l border-gray-200 pl-6">
            {items.map((i) => (
              <li key={i.id} className="mb-6">
                <span className="absolute -left-1.5 h-3 w-3 rounded-full bg-blue-500" />
                <p className="text-xs font-semibold text-gray-500">{formatMonth(i.dueDate!)}</p>
                <p className="font-medium">{i.title} <span className="text-xs text-gray-400">({i.type})</span></p>
                <p className="text-xs text-gray-500"><Money amount={i.amount} /></p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Load `/timeline`: chronological list starting Jul 2026 — Laptop, Aug 2026 — Friend's Wedding, etc.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add Timeline page"
```

---

## Task 19: Wishlist page with cooling period

**Files:**
- Create: `components/WishlistRow.tsx`, `app/wishlist/page.tsx`

- [ ] **Step 1: WishlistRow (client)**

```tsx
// components/WishlistRow.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Money } from '@/components/Money';
import type { Item } from '@/lib/types';

export function WishlistRow({ item, daysRemaining }: { item: Item; daysRemaining: number }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const locked = daysRemaining > 0 && !item.purchased;

  async function purchase() {
    const res = await fetch(`/api/items/${item.id}/purchase`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json();
      setMsg(data.daysRemaining ? `${data.daysRemaining} days remaining` : 'Could not mark purchased');
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center justify-between border-b border-gray-100 py-3">
      <div>
        <p className="font-medium">{item.title} {item.purchased && <span className="text-xs text-green-600">✓ purchased</span>}</p>
        <p className="text-xs text-gray-500"><Money amount={item.amount} /> · P{item.priority}{item.notes ? ` · ${item.notes}` : ''}</p>
        {locked && <p className="text-xs text-amber-600">Cooling period: {daysRemaining} day{daysRemaining > 1 ? 's' : ''} remaining</p>}
        {msg && <p className="text-xs text-red-600">{msg}</p>}
      </div>
      {!item.purchased && (
        <button onClick={purchase} disabled={locked}
          className={`rounded-md px-3 py-1 text-sm font-medium ${locked ? 'cursor-not-allowed bg-gray-100 text-gray-400' : 'bg-green-600 text-white hover:bg-green-700'}`}>
          Mark purchased
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wishlist page (server, computes days remaining)**

```tsx
// app/wishlist/page.tsx
import { Card } from '@/components/Card';
import { WishlistRow } from '@/components/WishlistRow';
import { ItemForm } from '@/components/ItemForm';
import { getItems } from '@/lib/data';
import { daysUntil } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function WishlistPage() {
  const items = (await getItems()).filter((i) => i.type === 'WISHLIST');
  const now = new Date().toISOString();
  const withDays = items.map((i) => {
    const expiry = new Date(i.dateAdded);
    expiry.setDate(expiry.getDate() + i.coolingPeriodDays);
    return { item: i, daysRemaining: daysUntil(expiry.toISOString(), now) };
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Wishlist</h1>
      <p className="text-sm text-gray-500">Items can't be marked purchased until their cooling period expires — a guard against impulse buys.</p>
      <Card title="Add wish"><ItemForm initial={undefined} /></Card>
      <Card>
        {withDays.length === 0 ? <p className="text-sm text-gray-500">No wishes yet.</p> :
          withDays.map(({ item, daysRemaining }) => <WishlistRow key={item.id} item={item} daysRemaining={daysRemaining} />)}
      </Card>
    </div>
  );
}
```

(Note: the Add-wish form defaults to COMMITMENT type; the user selects WISHLIST. Acceptable for MVP.)

- [ ] **Step 3: Verify**

Load `/wishlist`: Crocs (added 2026-06-01, +30d = expires ~Jul 1) shows days remaining and a disabled button as of 2026-06-07. Home Theater (added 2026-05-20, +30d = ~Jun 19) still locked. Confirm button disabled state.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add Wishlist page with cooling-period guard"
```

---

## Task 20: Purchase Impact Simulator page

**Files:**
- Create: `components/RecommendationBanner.tsx`, `app/simulator/page.tsx`

- [ ] **Step 1: RecommendationBanner**

```tsx
// components/RecommendationBanner.tsx
import type { Recommendation } from '@/lib/types';

const styles: Record<Recommendation, string> = {
  SAFE: 'bg-green-50 border-green-300 text-green-800',
  CAUTION: 'bg-amber-50 border-amber-300 text-amber-800',
  WAIT: 'bg-red-50 border-red-300 text-red-800',
};

export function RecommendationBanner({ rec, message }: { rec: Recommendation; message: string }) {
  return (
    <div className={`rounded-lg border p-4 ${styles[rec]}`}>
      <p className="text-sm font-bold uppercase tracking-wide">{rec}</p>
      <p className="mt-1 text-sm">{message}</p>
    </div>
  );
}
```

- [ ] **Step 2: Simulator page (client)**

```tsx
// app/simulator/page.tsx
'use client';
import { useState } from 'react';
import { Card } from '@/components/Card';
import { Money } from '@/components/Money';
import { RecommendationBanner } from '@/components/RecommendationBanner';
import type { Recommendation } from '@/lib/types';

interface SimResult {
  name: string | null; cost: number; reserveBefore: number; reserveAfter: number;
  reductionPct: number; monthsToRestore: number | null;
  goalImpacts: { title: string; delayMonths: number }[];
  recommendation: Recommendation; message: string;
}

export default function SimulatorPage() {
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setResult(null);
    const n = Number(cost);
    if (!n || n <= 0) { setError('Enter a positive cost.'); return; }
    const res = await fetch('/api/simulate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, cost: n }) });
    if (!res.ok) { setError('Simulation failed.'); return; }
    setResult(await res.json());
  }

  const input = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm';
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Purchase Impact Simulator</h1>
      <Card title="Should I buy this?">
        <form onSubmit={run} className="space-y-3">
          <input className={input} placeholder="Item name (e.g. Home Theater)" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={input} type="number" placeholder="Cost (₹)" value={cost} onChange={(e) => setCost(e.target.value)} />
          <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Simulate</button>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </form>
      </Card>

      {result && (
        <div className="space-y-4">
          <RecommendationBanner rec={result.recommendation} message={result.message} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Card title="Reserve Before"><p className="text-xl font-bold"><Money amount={result.reserveBefore} /></p></Card>
            <Card title="Reserve After"><p className={`text-xl font-bold ${result.reserveAfter < 0 ? 'text-red-600' : ''}`}><Money amount={result.reserveAfter} /></p></Card>
            <Card title="Reduction"><p className="text-xl font-bold">{result.reductionPct.toFixed(1)}%</p></Card>
          </div>
          <Card title="Months to restore reserve">
            <p className="text-lg">{result.monthsToRestore === null ? 'Cannot restore from current surplus' : `${result.monthsToRestore} month(s)`}</p>
          </Card>
          {result.goalImpacts.length > 0 && (
            <Card title="Impact on goals">
              {result.goalImpacts.map((g) => (
                <p key={g.title} className="text-sm">
                  {g.title}: {g.delayMonths > 0 ? <span className="text-red-600">delayed {g.delayMonths} month(s)</span> : <span className="text-green-600">no impact</span>}
                </p>
              ))}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Load `/simulator`. Enter Crocs / 5400 → SAFE, ~1.3% reduction, no goal delay. Enter Home Theater / 200000 → WAIT with Car delayed. Enter 500000 → WAIT (reserve goes negative).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add Purchase Impact Simulator page"
```

---

## Task 21: Profile editor (settings)

**Files:**
- Create: `app/settings/page.tsx`, `components/ProfileForm.tsx`
- Modify: `components/Nav.tsx` (add Settings link)

- [ ] **Step 1: ProfileForm (client)**

```tsx
// components/ProfileForm.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Profile } from '@/lib/types';

const fields: { key: keyof Profile; label: string }[] = [
  { key: 'protectedCapital', label: 'Protected Capital' },
  { key: 'reserveTarget', label: 'Reserve Target' },
  { key: 'reserveCurrent', label: 'Reserve Current' },
  { key: 'monthlyIncome', label: 'Monthly Income' },
  { key: 'monthlyExpenses', label: 'Monthly Expenses' },
  { key: 'monthlyInvestments', label: 'Monthly Investments' },
];

export function ProfileForm({ initial }: { initial: Profile }) {
  const router = useRouter();
  const [form, setForm] = useState<Profile>(initial);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    const res = await fetch('/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) });
    if (res.ok) { setSaved(true); router.refresh(); }
  }

  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => (
        <label key={f.key} className="text-sm">
          <span className="mb-1 block text-gray-600">{f.label}</span>
          <input type="number" className="w-full rounded-md border border-gray-300 px-2 py-1"
            value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })} />
        </label>
      ))}
      <div className="col-span-full">
        <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Save</button>
        {saved && <span className="ml-3 text-sm text-green-600">Saved</span>}
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Settings page (server)**

```tsx
// app/settings/page.tsx
import { Card } from '@/components/Card';
import { ProfileForm } from '@/components/ProfileForm';
import { getProfile } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const profile = await getProfile();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Card title="Financial Profile"><ProfileForm initial={profile} /></Card>
    </div>
  );
}
```

- [ ] **Step 3: Add Settings link to Nav**

In `components/Nav.tsx`, add `{ href: '/settings', label: 'Settings' }` to the `links` array.

- [ ] **Step 4: Verify**

Load `/settings`, change Reserve Current, Save, return to Dashboard — value updated.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add Settings page to edit financial profile"
```

---

## Task 22: Final verification + README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all finance + format tests pass.

- [ ] **Step 2: Run production build**

Run: `npm run build`
Expected: compiles with no type errors; all routes listed.

- [ ] **Step 3: Write README**

```markdown
# Personal Financial Priority Planner

Decide whether to spend money today by seeing all future claims on it.

## Setup
\`\`\`bash
npm install
npm run db:push     # create SQLite schema
npm run db:seed     # load demo data
npm run dev         # http://localhost:3000
\`\`\`

## Test
\`\`\`bash
npm test
\`\`\`

## Views
- **Dashboard** — Protected Capital, Opportunity Reserve (+deficit), Monthly Surplus, top unfunded item.
- **Priority Queue** — all items, priority desc then due date asc; create/edit/delete.
- **Timeline** — commitments/goals/experiences in date order.
- **Wishlist** — cooling-period guard before "mark purchased".
- **Simulator** — enter a cost; see reserve impact, months to restore, goal delays, and a SAFE/CAUTION/WAIT verdict.
- **Settings** — edit the financial profile.

Currency is INR (₹). Single-user, no auth (MVP).
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: add README"
```

---

## Self-review notes

- **Spec coverage:** Protected Capital / Opportunity Reserve / Monthly Surplus → Task 16. Four item types → Tasks 3,4,9,17. Priority Queue → 17. Funding progress → 6,17. Simulator → 8,20. Timeline → 18. Wishlist cooling period → 13,19. Profile editing → 21. Seed/all-views demo → 10. Tests → 5–8. All five MVP success criteria mapped in spec §10 are covered.
- **Type consistency:** `Item`/`Profile`/`Recommendation` defined in Task 4 and used identically in finance (6–8), data (15), API (11–13), and UI (16–21). `simulatePurchase`, `projectFunding`, `sortQueue`, `fundingProgress` names are consistent across plan and tests.
- **No placeholders:** every code step shows complete code; every run step shows expected output.
