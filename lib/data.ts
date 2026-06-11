import { prisma } from '@/lib/db';
import { roundMoney } from '@/lib/finance';
import { displayNameForType } from '@/lib/wealth';
import type { Item, Profile, WealthAsset } from '@/lib/types';

export async function getProfile(): Promise<Profile> {
  const r = await prisma.financialProfile.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  return {
    reserveTarget: r.reserveTarget,
    reserveCurrent: r.reserveCurrent,
    monthlyIncome: r.monthlyIncome,
    monthlyExpenses: r.monthlyExpenses,
    monthlyInvestments: r.monthlyInvestments,
  };
}

export async function getWealthAssets(): Promise<WealthAsset[]> {
  const rows = await prisma.wealthAsset.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type as WealthAsset['type'],
    ticker: r.ticker,
    quantity: r.quantity,
    pricePerUnit: r.pricePerUnit,
    value: r.value,
    lastPrice: r.lastPrice,
    priceUpdatedAt: r.priceUpdatedAt ? r.priceUpdatedAt.toISOString() : null,
    priceSource: r.priceSource as WealthAsset['priceSource'],
    priceStatus: r.priceStatus as WealthAsset['priceStatus'],
    tickerName: r.tickerName,
    source: r.source as WealthAsset['source'],
    importKey: r.importKey,
    casStatus: r.casStatus as WealthAsset['casStatus'],
    costBasis: r.costBasis,
    // Stored at import; derived from the full name for legacy rows (backfill-on-read, never null).
    displayName: r.displayName ?? displayNameForType(r.name, r.type),
    purchaseDate: r.purchaseDate ? r.purchaseDate.toISOString() : null,
  }));
}

export async function getItems(): Promise<Item[]> {
  const rows = await prisma.planItem.findMany({
    orderBy: { createdAt: 'asc' },
    include: { fundings: true },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type as Item['type'],
    title: r.title,
    amount: r.amount,
    fundedAmount: roundMoney(r.fundings.reduce((s, f) => s + f.amount, 0)),
    priority: r.priority,
    rank: r.rank,
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    status: r.status as Item['status'],
    notes: r.notes,
    coolingPeriodDays: r.coolingPeriodDays,
    dateAdded: r.dateAdded.toISOString(),
    purchased: r.purchased,
  }));
}

export async function getFundings(itemId: string) {
  return prisma.fundingTransaction.findMany({ where: { itemId }, orderBy: { date: 'desc' } });
}
