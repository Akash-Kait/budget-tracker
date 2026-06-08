import type { WealthAsset, AssetType } from '@/lib/types';
import { ASSET_TYPES, ASSET_TYPE_LABELS } from '@/lib/types';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Effective value of an asset: units × price when both are present, else the manual value. */
export function assetValue(a: WealthAsset): number {
  if (a.quantity != null && a.pricePerUnit != null) return round2(a.quantity * a.pricePerUnit);
  return round2(a.value ?? 0);
}

export function totalWealth(assets: WealthAsset[]): number {
  return round2(assets.reduce((s, a) => s + assetValue(a), 0));
}

export interface WealthGroup {
  type: AssetType;
  label: string;
  assets: WealthAsset[];
  subtotal: number;
}

/** Groups assets by type in a fixed order (Mutual Funds, Stocks, Other), omitting empty groups. */
export function groupByType(assets: WealthAsset[]): WealthGroup[] {
  return ASSET_TYPES.map((type) => {
    const inType = assets.filter((a) => a.type === type);
    return { type, label: ASSET_TYPE_LABELS[type], assets: inType, subtotal: totalWealth(inType) };
  }).filter((g) => g.assets.length > 0);
}
