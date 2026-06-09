import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withErrorHandling } from '@/lib/handler';
import { getPriceProvider } from '@/lib/market/provider';
import { isStale } from '@/lib/market/staleness';

// Batch-refresh mutual-fund unit prices via the active provider. AMFI (the only live provider
// today) covers MUTUAL FUNDS only — stocks/other stay manual and are never touched here. With the
// default manual provider this is a no-op (updated: 0). Failure handling is the point:
//   - feed unreachable/parse error → getQuotes throws BEFORE any write → 500, nothing changes
//   - scheme code not in feed       → asset NOT touched (price kept, never zeroed); priceStatus=NOT_FOUND
//   - stale NAV (older than N biz days) → price updated but flagged stale; never shown as current
export const POST = withErrorHandling(async () => {
  const provider = getPriceProvider();
  // Without a live batch provider (the default manual mode), refresh is a true no-op — we must NOT
  // flag every fund NOT_FOUND just because no provider is configured.
  if (!provider.getQuotes) {
    return NextResponse.json({ provider: provider.name, checked: 0, updated: 0, stale: [], notFound: [] });
  }
  const assets = await prisma.wealthAsset.findMany({
    where: { type: 'MUTUAL_FUND', ticker: { not: null } },
  });
  if (assets.length === 0) {
    return NextResponse.json({ provider: provider.name, checked: 0, updated: 0, stale: [], notFound: [] });
  }
  const tickers = assets.map((a) => a.ticker!);

  // Fetch + parse ONCE, up front. A feed/network/parse failure throws here → withErrorHandling
  // maps it to 500 and NO DB write has happened, so every price + totalWealth is left untouched.
  const quotes = await provider.getQuotes(tickers);

  const now = new Date().toISOString();
  const stale: string[] = [];
  const notFound: string[] = [];
  let updated = 0;

  // All per-asset writes run in ONE transaction so the batch is atomic: if any update fails
  // mid-loop, every write rolls back and withErrorHandling returns 500 — so "nothing changed" is
  // TRUE, not a half-applied batch. The feed fetch stays above this (never hold a txn over HTTP).
  await prisma.$transaction(async (tx) => {
    for (const a of assets) {
      const quote = quotes.get(a.ticker!) ?? null;
      if (!quote) {
        // Scheme code didn't resolve: keep the last good price (never zero), persist a fix-me flag.
        notFound.push(a.name);
        if (a.priceStatus !== 'NOT_FOUND') {
          await tx.wealthAsset.update({ where: { id: a.id }, data: { priceStatus: 'NOT_FOUND' } });
        }
        continue;
      }
      await tx.wealthAsset.update({
        where: { id: a.id },
        data: {
          pricePerUnit: quote.price,
          lastPrice: quote.price,
          priceUpdatedAt: new Date(quote.asOf),
          priceSource: 'API',
          priceStatus: 'OK',
          tickerName: quote.name ?? null, // echo the resolved scheme name so a wrong code is visible
        },
      });
      updated++;
      if (isStale(quote.asOf, now)) stale.push(a.name);
    }
  });

  return NextResponse.json({ provider: provider.name, checked: assets.length, updated, stale, notFound });
});
