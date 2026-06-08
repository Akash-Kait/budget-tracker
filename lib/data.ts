import { prisma } from '@/lib/db';
import type { Item, Profile } from '@/lib/types';

export async function getProfile(): Promise<Profile> {
  const r = await prisma.financialProfile.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  return {
    protectedCapital: r.protectedCapital,
    reserveTarget: r.reserveTarget,
    reserveCurrent: r.reserveCurrent,
    monthlyIncome: r.monthlyIncome,
    monthlyExpenses: r.monthlyExpenses,
    monthlyInvestments: r.monthlyInvestments,
  };
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
    fundedAmount: r.fundings.reduce((s, f) => s + f.amount, 0),
    priority: r.priority,
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
