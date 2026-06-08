import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { fundingSchema } from '@/lib/validation';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fundings = await prisma.fundingTransaction.findMany({
    where: { itemId: id },
    orderBy: { date: 'desc' },
  });
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
