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
    return NextResponse.json(
      { error: 'Cooling period not expired', daysRemaining: remaining },
      { status: 422 },
    );
  }
  const updated = await prisma.planItem.update({ where: { id }, data: { purchased: true } });
  return NextResponse.json(updated);
}
