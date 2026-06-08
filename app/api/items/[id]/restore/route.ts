import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await prisma.planItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const updated = await prisma.planItem.update({ where: { id }, data: { status: 'PLANNED' } });
  return NextResponse.json(updated);
}
