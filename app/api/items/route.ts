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
      type: d.type,
      title: d.title,
      amount: d.amount,
      fundedAmount: d.fundedAmount,
      priority: d.priority,
      dueDate: d.dueDate ? new Date(d.dueDate) : null,
      status: d.status ?? null,
      notes: d.notes ?? null,
      coolingPeriodDays: d.coolingPeriodDays,
    },
  });
  return NextResponse.json(created, { status: 201 });
}
