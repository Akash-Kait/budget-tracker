import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { convertSchema } from '@/lib/validation';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await prisma.planItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (item.type !== 'WISHLIST') {
    return NextResponse.json({ error: 'Only wishlist items can be converted' }, { status: 400 });
  }
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
