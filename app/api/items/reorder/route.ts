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
