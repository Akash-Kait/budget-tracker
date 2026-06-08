import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { wealthAssetSchema } from '@/lib/validation';
import { withErrorHandling } from '@/lib/handler';

export const PUT = withErrorHandling(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = wealthAssetSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
    const d = parsed.data;
    const updated = await prisma.wealthAsset.update({
      where: { id },
      data: {
        name: d.name,
        type: d.type,
        ticker: d.ticker ?? null,
        quantity: d.quantity ?? null,
        pricePerUnit: d.pricePerUnit ?? null,
        value: d.value ?? null,
        priceSource: d.pricePerUnit != null ? 'MANUAL' : null,
        priceUpdatedAt: d.pricePerUnit != null ? new Date() : null,
      },
    });
    return NextResponse.json(updated);
  },
);

export const DELETE = withErrorHandling(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await prisma.wealthAsset.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  },
);
