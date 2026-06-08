import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { profileSchema } from '@/lib/validation';

export async function GET() {
  const profile = await prisma.financialProfile.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
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
