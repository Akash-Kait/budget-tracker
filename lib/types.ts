export const ITEM_TYPES = ['COMMITMENT', 'GOAL', 'EXPERIENCE', 'WISHLIST'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const STATUSES = ['PLANNED', 'FUNDED', 'COMPLETED'] as const;
export type Status = (typeof STATUSES)[number];

export interface Profile {
  reserveTarget: number;
  reserveCurrent: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyInvestments: number;
}

export const ASSET_TYPES = ['MUTUAL_FUND', 'STOCK', 'OTHER'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  MUTUAL_FUND: 'Mutual Funds',
  STOCK: 'Stocks',
  OTHER: 'Other',
};

export const PRICE_SOURCES = ['MANUAL', 'API'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export interface WealthAsset {
  id: string;
  name: string;
  type: AssetType;
  ticker: string | null;
  quantity: number | null;
  pricePerUnit: number | null;
  value: number | null; // manual fallback
  lastPrice: number | null;
  priceUpdatedAt: string | null; // ISO
  priceSource: PriceSource | null;
  costBasis: number | null; // total amount invested; null = unknown
  purchaseDate: string | null; // ISO
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
