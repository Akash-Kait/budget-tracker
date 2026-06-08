import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { reorderSchema } from '@/lib/validation';
import { withErrorHandling } from '@/lib/handler';

export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json();
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
  // Use `update` (not `updateMany`) so a stale/unknown id throws P2025 and the whole
  // transaction rolls back (mapped to 404), rather than silently no-op'ing into a
  // partial/corrupt rank ordering. The client should then refetch and retry.
  await prisma.$transaction(
    parsed.data.ids.map((id, index) =>
      prisma.planItem.update({ where: { id }, data: { rank: index } }),
    ),
  );
  return NextResponse.json({ ok: true });
});
