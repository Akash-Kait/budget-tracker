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

export interface WealthAllocation {
  type: AssetType;
  label: string;
  value: number;
  pct: number; // 0–100, share of total wealth
}

/** Allocation of total wealth across asset types, fixed order, empty types omitted. */
export function allocationByType(assets: WealthAsset[]): WealthAllocation[] {
  const total = totalWealth(assets);
  return ASSET_TYPES.map((type) => {
    const value = totalWealth(assets.filter((a) => a.type === type));
    return {
      type,
      label: ASSET_TYPE_LABELS[type],
      value,
      pct: total > 0 ? Math.round((value / total) * 100) : 0,
    };
  }).filter((a) => a.value > 0);
}

/** The single highest-value asset, or null when there are none. */
export function largestHolding(assets: WealthAsset[]): WealthAsset | null {
  if (assets.length === 0) return null;
  return assets.reduce((max, a) => (assetValue(a) > assetValue(max) ? a : max));
}

// ── Cost basis + gain/loss ──
// "Unknown cost basis" is null, never 0 — so a holding with no basis is distinguishable from a flat
// (zero-gain) one. pct is null when cost basis is 0 (percentage is undefined). Pure: no finance/market.

export interface GainLoss {
  absolute: number; // currentValue − costBasis (may be negative)
  pct: number | null; // % of cost basis; null when cost basis is 0
}

/** Total invested in the holding, or null when unknown (NOT 0). */
export function assetCostBasis(a: WealthAsset): number | null {
  return a.costBasis ?? null;
}

/** Gain/loss for one asset, or null when cost basis is unknown (distinct from a flat 0 result). */
export function assetGainLoss(a: WealthAsset): GainLoss | null {
  const basis = assetCostBasis(a);
  if (basis === null) return null;
  const absolute = round2(assetValue(a) - basis);
  const pct = basis > 0 ? round2((absolute / basis) * 100) : null;
  return { absolute, pct };
}

/** Sum of known cost bases; null when NO asset has a cost basis (fully unknown). */
export function totalCostBasis(assets: WealthAsset[]): number | null {
  const known = assets.filter((a) => assetCostBasis(a) !== null);
  if (known.length === 0) return null;
  return round2(known.reduce((s, a) => s + (a.costBasis as number), 0));
}

/** Portfolio gain/loss over the subset of assets WITH a cost basis; null when none have one. */
export function totalGainLoss(assets: WealthAsset[]): GainLoss | null {
  const known = assets.filter((a) => assetCostBasis(a) !== null);
  if (known.length === 0) return null;
  const basis = known.reduce((s, a) => s + (a.costBasis as number), 0);
  const value = known.reduce((s, a) => s + assetValue(a), 0);
  const absolute = round2(value - basis);
  const pct = basis > 0 ? round2((absolute / basis) * 100) : null;
  return { absolute, pct };
}
