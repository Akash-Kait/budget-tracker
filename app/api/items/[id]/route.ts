import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { itemSchema } from '@/lib/validation';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await prisma.planItem.findUnique({ where: { id }, include: { fundings: true } });
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { fundings, ...rest } = item;
  return NextResponse.json({ ...rest, fundedAmount: fundings.reduce((s, f) => s + f.amount, 0) });
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
      type: d.type,
      title: d.title,
      amount: d.amount,
      priority: d.priority,
      dueDate: d.dueDate ? new Date(d.dueDate) : null,
      status: d.status ?? null,
      notes: d.notes ?? null,
      coolingPeriodDays: d.coolingPeriodDays,
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.planItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
