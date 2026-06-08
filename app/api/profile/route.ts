import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { profileSchema } from '@/lib/validation';
import { withErrorHandling } from '@/lib/handler';

export const GET = withErrorHandling(async () => {
  const profile = await prisma.financialProfile.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  return NextResponse.json(profile);
});

export const PUT = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json();
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
  // upsert (not update) so a PUT before any GET still works rather than throwing P2025
  const updated = await prisma.financialProfile.upsert({
    where: { id: 1 },
    update: parsed.data,
    create: { id: 1, ...parsed.data },
  });
  return NextResponse.json(updated);
});
