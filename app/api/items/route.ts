import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { itemSchema } from '@/lib/validation';
import { withErrorHandling } from '@/lib/handler';
import { roundMoney } from '@/lib/finance';

export const GET = withErrorHandling(async (req: NextRequest) => {
  const type = req.nextUrl.searchParams.get('type');
  const where = type ? { type } : {};
  const items = await prisma.planItem.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: { fundings: true },
  });
  const withFunded = items.map(({ fundings, ...i }) => ({
    ...i,
    fundedAmount: roundMoney(fundings.reduce((s, f) => s + f.amount, 0)),
  }));
  return NextResponse.json(withFunded);
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json();
  const parsed = itemSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;
  const max = await prisma.planItem.aggregate({ _max: { rank: true } });
  const nextRank = (max._max.rank ?? -1) + 1;
  const created = await prisma.planItem.create({
    data: {
      type: d.type,
      title: d.title,
      amount: d.amount,
      priority: d.priority,
      rank: nextRank,
      dueDate: d.dueDate ? new Date(d.dueDate) : null,
      status: d.status ?? null,
      notes: d.notes ?? null,
      coolingPeriodDays: d.coolingPeriodDays,
    },
  });
  return NextResponse.json(created, { status: 201 });
});
