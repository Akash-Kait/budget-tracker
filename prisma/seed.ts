import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.planItem.deleteMany();
  await prisma.financialProfile.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      protectedCapital: 200000,
      reserveTarget: 500000,
      reserveCurrent: 420000,
      monthlyIncome: 150000,
      monthlyExpenses: 70000,
      monthlyInvestments: 30000,
    },
  });

  await prisma.planItem.createMany({
    data: [
      { type: 'COMMITMENT', title: 'Laptop', amount: 100000, fundedAmount: 60000, priority: 5, dueDate: new Date('2026-07-15'), status: 'PLANNED' },
      { type: 'COMMITMENT', title: "Friend's Wedding", amount: 40000, fundedAmount: 10000, priority: 5, dueDate: new Date('2026-08-10'), status: 'PLANNED' },
      { type: 'GOAL', title: 'Car', amount: 600000, fundedAmount: 120000, priority: 4, dueDate: new Date('2028-01-01') },
      { type: 'GOAL', title: 'Wedding Fund', amount: 800000, fundedAmount: 50000, priority: 4, dueDate: new Date('2029-03-01') },
      { type: 'EXPERIENCE', title: 'Lollapalooza', amount: 15000, fundedAmount: 0, priority: 3, dueDate: new Date('2027-01-20') },
      { type: 'EXPERIENCE', title: 'Nepal Trip', amount: 60000, fundedAmount: 5000, priority: 2, dueDate: new Date('2027-02-15') },
      { type: 'WISHLIST', title: 'Crocs', amount: 5400, priority: 2, notes: 'comfy', coolingPeriodDays: 30, dateAdded: new Date('2026-06-01') },
      { type: 'WISHLIST', title: 'Home Theater', amount: 50000, priority: 1, notes: 'nice to have', coolingPeriodDays: 30, dateAdded: new Date('2026-05-20') },
      { type: 'WISHLIST', title: 'Perfume', amount: 4000, priority: 1, coolingPeriodDays: 30, dateAdded: new Date('2026-06-06') },
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
