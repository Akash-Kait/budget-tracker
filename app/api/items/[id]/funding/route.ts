import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { fundingSchema } from '@/lib/validation';
import { withErrorHandling } from '@/lib/handler';
import { roundMoney } from '@/lib/finance';

export const GET = withErrorHandling(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const fundings = await prisma.fundingTransaction.findMany({
      where: { itemId: id },
      orderBy: { date: 'desc' },
    });
    return NextResponse.json(fundings);
  },
);

export const POST = withErrorHandling(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const item = await prisma.planItem.findUnique({ where: { id } });
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const body = await req.json();
    const parsed = fundingSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
    // create + recompute in one transaction so the returned total reflects this write atomically
    const updated = await prisma.$transaction(async (tx) => {
      await tx.fundingTransaction.create({
        data: { itemId: id, amount: parsed.data.amount, note: parsed.data.note ?? null },
      });
      return tx.planItem.findUnique({ where: { id }, include: { fundings: true } });
    });
    const fundedAmount = roundMoney((updated?.fundings ?? []).reduce((s, f) => s + f.amount, 0));
    return NextResponse.json({ ...updated, fundedAmount }, { status: 201 });
  },
);
