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

// MANUAL = user-entered, API = AMFI live NAV (MF), CAS = MF statement seed, ECAS = depository eCAS
// import seed (statement-date price), NSE = refreshed equity end-of-day close (nselib). The as-of label
// derives from this (NAV/eCAS/NSE close), so a stock's pre-refresh vs refreshed provenance stays honest.
export const PRICE_SOURCES = ['MANUAL', 'API', 'CAS', 'ECAS', 'NSE'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

// Outcome of the last live-price refresh for an asset. NOT_FOUND = the ticker/scheme code didn't
// resolve in the feed (a data-entry error to fix); persisted so it survives reloads, unlike a toast.
export const PRICE_STATUSES = ['OK', 'NOT_FOUND'] as const;
export type PriceStatus = (typeof PRICE_STATUSES)[number];

// How a holding entered the app. CAS = MF statement (CAMS/KFintech); ECAS = depository stock
// statement. Each import path only ever update/flags rows of its own source.
export const SOURCES = ['MANUAL', 'CAS', 'ECAS'] as const;
export type Source = (typeof SOURCES)[number];

// Whether a CAS-sourced holding appeared in the most recent uploaded statement. ABSENT = flagged
// "not in latest CAS" (never auto-deleted); null = not CAS-sourced.
export const CAS_STATUSES = ['CURRENT', 'ABSENT'] as const;
export type CasStatus = (typeof CAS_STATUSES)[number];

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
  priceStatus: PriceStatus | null; // result of last refresh; NOT_FOUND surfaces a fix-me badge
  tickerName: string | null; // provider-resolved name for `ticker`, shown so a wrong code is visible
  source: Source | null; // MANUAL | CAS (null = legacy/manual)
  importKey: string | null; // stable CAS reconciliation key
  casStatus: CasStatus | null; // CURRENT | ABSENT (CAS-sourced only)
  costBasis: number | null; // total amount invested; null = unknown
  displayName: string; // clean chart name (full `name` truncated at "#"/" - "); DTO always populates it
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
