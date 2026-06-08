export const ITEM_TYPES = ['COMMITMENT', 'GOAL', 'EXPERIENCE', 'WISHLIST'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const STATUSES = ['PLANNED', 'FUNDED', 'COMPLETED'] as const;
export type Status = (typeof STATUSES)[number];

export interface Profile {
  protectedCapital: number;
  reserveTarget: number;
  reserveCurrent: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyInvestments: number;
}

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  amount: number;
  fundedAmount: number;
  priority: number;
  rank: number;
  dueDate: string | null; // ISO
  status: Status | null;
  notes: string | null;
  coolingPeriodDays: number;
  dateAdded: string; // ISO
  purchased: boolean;
}

export type Recommendation = 'SAFE' | 'CAUTION' | 'WAIT';
