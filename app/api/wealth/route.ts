import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { wealthAssetSchema } from '@/lib/validation';
import { withErrorHandling } from '@/lib/handler';

export const GET = withErrorHandling(async () => {
  const assets = await prisma.wealthAsset.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json(assets);
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json();
  const parsed = wealthAssetSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;
  const created = await prisma.wealthAsset.create({
    data: {
      name: d.name,
      type: d.type,
      ticker: d.ticker ?? null,
      quantity: d.quantity ?? null,
      pricePerUnit: d.pricePerUnit ?? null,
      value: d.value ?? null,
      costBasis: d.costBasis ?? null,
      purchaseDate: d.purchaseDate ? new Date(d.purchaseDate) : null,
      // a user-entered unit price is a MANUAL source, stamped now
      priceSource: d.pricePerUnit != null ? 'MANUAL' : null,
      priceUpdatedAt: d.pricePerUnit != null ? new Date() : null,
      priceStatus: null, // manual entry: no outstanding "couldn't update" state
      tickerName: null, // resolved name is repopulated on the next live refresh
    },
  });
  return NextResponse.json(created, { status: 201 });
});
