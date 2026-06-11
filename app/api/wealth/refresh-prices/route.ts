import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { withErrorHandling } from '@/lib/handler';
import { getPriceProvider, getEquityPriceProvider, type PriceProvider, type Quote } from '@/lib/market/provider';
import { isStale } from '@/lib/market/staleness';

// Batch-refresh prices, fanned out by asset class to INDEPENDENT providers: MUTUAL_FUND → AMFI NAVs
// (MARKET_DATA_PROVIDER), STOCK → NSE end-of-day closes (EQUITY_DATA_PROVIDER). Each domain fails
// independently — one source down doesn't block the other. Honesty discipline (per domain):
//   - provider has no batch (manual mode)   → that domain is a true no-op (NOT flagged NOT_FOUND)
//   - provider getQuotes throws (feed down) → that domain UNTOUCHED (prices kept, never zeroed),
//     surfaced in `failed`; the other domain still refreshes; NO 500
//   - ticker not resolved by the provider   → asset untouched, priceStatus=NOT_FOUND (fix-me flag)
//   - stale (older than N business days)     → price updated but flagged stale; never shown as current
// All writes run in ONE transaction (a DB write failure → rollback → 500: "nothing changed" is true).

type Resolved = { quotes: Map<string, Quote | null> | null; failed: boolean };

// Run a provider for a domain. quotes=null means "didn't run" (manual → no-op, or threw → failed);
// the network fetch stays OUTSIDE the transaction (never hold a txn over HTTP).
async function resolve(provider: PriceProvider, assets: { ticker: string | null }[]): Promise<Resolved> {
  if (!provider.getQuotes || assets.length === 0) return { quotes: null, failed: false };
  try {
    return { quotes: await provider.getQuotes(assets.map((a) => a.ticker!)), failed: false };
  } catch {
    return { quotes: null, failed: true }; // feed down → domain untouched, surfaced; never a half-write
  }
}

type Asset = { id: string; name: string; ticker: string | null; priceStatus: string | null; tickerName: string | null };

async function apply(
  tx: Prisma.TransactionClient,
  assets: Asset[],
  resolved: Resolved,
  source: 'API' | 'NSE',
  now: string,
  stale: string[],
  notFound: string[],
): Promise<number> {
  if (resolved.quotes === null) return 0; // provider didn't run (manual or failed) → leave untouched
  let updated = 0;
  for (const a of assets) {
    const quote = resolved.quotes.get(a.ticker!) ?? null;
    if (!quote) {
      notFound.push(a.name); // not resolved: keep the last good price (never zero), persist a fix-me flag
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
        priceSource: source, // 'API' (AMFI NAV) | 'NSE' (equity close) → drives the honest as-of label
        priceStatus: 'OK',
        // Resolved-name echo. AMFI ('API') returns the authoritative scheme name → keep it current so
        // a wrong-but-valid code stays visible. NSE has no company name; we carry only the bare symbol
        // as a weak fallback, so fill tickerName ONLY when the holding has none yet — never replace a
        // clean eCAS-derived name (e.g. "State Bank of India") with "SBIN" on refresh. Never null it.
        ...(quote.name == null
          ? {}
          : source === 'API'
            ? { tickerName: quote.name }
            : a.tickerName
              ? {}
              : { tickerName: quote.name }),
      },
    });
    updated++;
    if (isStale(quote.asOf, now)) stale.push(a.name);
  }
  return updated;
}

export const POST = withErrorHandling(async () => {
  const mfProvider = getPriceProvider();
  const equityProvider = getEquityPriceProvider();

  const [mfAssets, stockAssets] = await Promise.all([
    prisma.wealthAsset.findMany({ where: { type: 'MUTUAL_FUND', ticker: { not: null } } }),
    prisma.wealthAsset.findMany({ where: { type: 'STOCK', ticker: { not: null } } }),
  ]);

  // Resolve each domain's quotes independently (fetch outside the txn).
  const mf = await resolve(mfProvider, mfAssets);
  const stock = await resolve(equityProvider, stockAssets);

  const now = new Date().toISOString();
  const stale: string[] = [];
  const notFound: string[] = [];
  let updated = 0;
  await prisma.$transaction(async (tx) => {
    updated += await apply(tx, mfAssets as Asset[], mf, 'API', now, stale, notFound);
    updated += await apply(tx, stockAssets as Asset[], stock, 'NSE', now, stale, notFound);
  });

  // Classify each domain's outcome so nothing is silently buried in the denominator:
  //   - failed  → provider threw (feed down); prices kept, surfaced.
  //   - manual  → domain has tickered assets but its provider is in manual mode (no getQuotes), so it
  //               was never attempted. resolve() returns quotes:null + failed:false for this case;
  //               assets.length>0 distinguishes it from "no holdings to refresh".
  // `checked` counts ONLY assets in domains that actually ran (produced a quote map), so "Updated
  // X/Y" reflects real attempts — manual/failed domains are reported via their own fields instead.
  const failed: string[] = [];
  if (mf.failed) failed.push('mutual funds');
  if (stock.failed) failed.push('stocks');

  const manual: string[] = [];
  if (!mf.quotes && !mf.failed && mfAssets.length) manual.push('mutual funds');
  if (!stock.quotes && !stock.failed && stockAssets.length) manual.push('stocks');

  return NextResponse.json({
    mfProvider: mfProvider.name,
    equityProvider: equityProvider.name,
    checked: (mf.quotes ? mfAssets.length : 0) + (stock.quotes ? stockAssets.length : 0),
    updated,
    stale,
    notFound,
    failed, // a domain whose feed was unreachable — prices kept, surfaced (not a silent freeze)
    manual, // a domain whose live provider isn't enabled — its assets were not attempted
  });
});
