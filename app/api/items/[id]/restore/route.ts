import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withErrorHandling } from '@/lib/handler';

export const POST = withErrorHandling(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const updated = await prisma.planItem.update({ where: { id }, data: { status: 'PLANNED' } });
    return NextResponse.json(updated);
  },
);
