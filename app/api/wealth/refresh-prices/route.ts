import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withErrorHandling } from '@/lib/handler';
import { getPriceProvider } from '@/lib/market/provider';

// Batch-refresh unit prices for assets that have a ticker, via the active price provider.
// With the default manual provider this is a no-op (updated: 0) — it wires the integration
// path so a real provider later needs no route changes.
export const POST = withErrorHandling(async () => {
  const provider = getPriceProvider();
  const assets = await prisma.wealthAsset.findMany({ where: { ticker: { not: null } } });
  let updated = 0;
  for (const a of assets) {
    const quote = await provider.getQuote(a.ticker!);
    if (!quote) continue;
    await prisma.wealthAsset.update({
      where: { id: a.id },
      data: {
        pricePerUnit: quote.price,
        lastPrice: quote.price,
        priceUpdatedAt: new Date(quote.asOf),
        priceSource: 'API',
      },
    });
    updated++;
  }
  return NextResponse.json({ provider: provider.name, checked: assets.length, updated });
});
