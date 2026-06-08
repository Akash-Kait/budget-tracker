import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Seed = {
  type: string;
  title: string;
  amount: number;
  funded: number;
  priority: number;
  dueDate?: Date;
  status?: string;
  notes?: string;
  coolingPeriodDays?: number;
  dateAdded?: Date;
};

const items: Seed[] = [
  { type: 'COMMITMENT', title: 'Laptop', amount: 100000, funded: 60000, priority: 5, dueDate: new Date('2026-07-15'), status: 'PLANNED' },
  { type: 'COMMITMENT', title: "Friend's Wedding", amount: 40000, funded: 10000, priority: 5, dueDate: new Date('2026-08-10'), status: 'PLANNED' },
  { type: 'GOAL', title: 'Car', amount: 600000, funded: 120000, priority: 4, dueDate: new Date('2028-01-01') },
  { type: 'GOAL', title: 'Wedding Fund', amount: 800000, funded: 50000, priority: 4, dueDate: new Date('2029-03-01') },
  { type: 'EXPERIENCE', title: 'Lollapalooza', amount: 15000, funded: 0, priority: 3, dueDate: new Date('2027-01-20') },
  { type: 'EXPERIENCE', title: 'Nepal Trip', amount: 60000, funded: 5000, priority: 2, dueDate: new Date('2027-02-15') },
  { type: 'WISHLIST', title: 'Crocs', amount: 5400, funded: 0, priority: 2, notes: 'comfy', coolingPeriodDays: 30, dateAdded: new Date('2026-06-01') },
  { type: 'WISHLIST', title: 'Home Theater', amount: 50000, funded: 0, priority: 1, notes: 'nice to have', coolingPeriodDays: 30, dateAdded: new Date('2026-05-20') },
  { type: 'WISHLIST', title: 'Perfume', amount: 4000, funded: 0, priority: 1, coolingPeriodDays: 30, dateAdded: new Date('2026-06-06') },
];

async function main() {
  await prisma.fundingTransaction.deleteMany();
  await prisma.planItem.deleteMany();
  const profile = {
    reserveTarget: 500000,
    reserveCurrent: 420000,
    monthlyIncome: 150000,
    monthlyExpenses: 70000,
    monthlyInvestments: 30000,
  };
  await prisma.financialProfile.upsert({
    where: { id: 1 },
    update: profile,
    create: { id: 1, ...profile },
  });

  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    await prisma.planItem.create({
      data: {
        type: it.type,
        title: it.title,
        amount: it.amount,
        priority: it.priority,
        rank: idx,
        dueDate: it.dueDate ?? null,
        status: it.status ?? null,
        notes: it.notes ?? null,
        coolingPeriodDays: it.coolingPeriodDays ?? 30,
        dateAdded: it.dateAdded ?? new Date(),
        fundings:
          it.funded > 0
            ? { create: { amount: it.funded, note: 'Initial allocation', date: it.dateAdded ?? new Date() } }
            : undefined,
      },
    });
  }

  await prisma.wealthAsset.deleteMany();
  await prisma.wealthAsset.createMany({
    data: [
      { type: 'MUTUAL_FUND', name: 'Nifty 50 Index Fund', ticker: 'NIFTY50', quantity: 1200, pricePerUnit: 95.4, costBasis: 100000, purchaseDate: new Date('2024-04-01') },
      { type: 'MUTUAL_FUND', name: 'Flexi Cap Fund', quantity: 800, pricePerUnit: 62.1, costBasis: 55000, purchaseDate: new Date('2025-01-15') },
      { type: 'STOCK', name: 'Infosys', ticker: 'INFY', quantity: 50, pricePerUnit: 1480, costBasis: 60000, purchaseDate: new Date('2024-08-10') },
      { type: 'STOCK', name: 'HDFC Bank', ticker: 'HDFCBANK', quantity: 30, pricePerUnit: 1650, costBasis: 52000, purchaseDate: new Date('2025-03-01') },
      { type: 'OTHER', name: 'Sovereign Gold Bond', value: 150000 },
    ],
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
