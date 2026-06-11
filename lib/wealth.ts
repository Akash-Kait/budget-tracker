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

/**
 * A clean DISPLAY name for charts — the legal holding name truncated at its first separator:
 * a "#" or a separator dash (" - ", or a word-attached "LIMITED- NEW"). Verified against the real
 * eCAS stock names ("STATE BANK OF INDIA # NEW EQUITY SHARES…" → "STATE BANK OF INDIA",
 * "ADANI PORTS … LIMITED- NEW EQUITY…" → "ADANI PORTS … LIMITED", "BAJAJ AUTO LIMITED - EQUITY
 * SHARES" → "BAJAJ AUTO LIMITED"). No delimiter → the full name (safe fallback). A too-short result
 * (e.g. a leading RTA/scheme code like "ETDG"/"8019" on a folio-MF name) is treated as odd and also
 * falls back to the full name. PURE — derive at import time + as a read-time backfill, never in a
 * component. NEVER overwrites the full legal `name`.
 */
export function shortHoldingName(fullName: string): string {
  const name = (fullName ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return fullName;
  const idxs: number[] = [];
  const hash = name.indexOf('#');
  if (hash > 0) idxs.push(hash);
  const spaceDash = name.indexOf(' - '); // "BAJAJ AUTO LIMITED - EQUITY…"
  if (spaceDash > 0) idxs.push(spaceDash);
  const wordDash = name.search(/\S- /); // "…LIMITED- NEW…" (hyphen attached to the word)
  if (wordDash >= 0) idxs.push(wordDash + 1);
  if (idxs.length === 0) return name;
  const short = name.slice(0, Math.min(...idxs)).trim();
  return short.length < 5 ? name : short; // too short → likely a code, not a name → keep full
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Clean display name for a MUTUAL FUND. MF names carry a leading scheme-code prefix AND a trailing
 * plan/option suffix (both dash-separated), so the stock rule mis-cuts. This:
 *  - takes the part AFTER a "#" (AMC#scheme → the scheme), then
 *  - strips a leading short code prefix ("TPDG - ", "8019 - "), an "AMC MF- " prefix (demat),
 *  - drops a "(formerly …)" aside, and the plan/option suffix from "… - Direct/Regular …" onward,
 *  - Title-Cases an ALL-CAPS result (demat names) while leaving already-mixed-case folio names as-is.
 * Verified → "TPDG - quant ELSS Tax Saver Fund - Direct Plan - Growth" → "quant ELSS Tax Saver Fund";
 * "…#MOTILAL OSWAL MF- MOTILAL OSWAL NIFTY 50 INDEX FUND-DIRECT-GROWTH" → "Motilal Oswal Nifty 50
 * Index Fund". Odd/empty result → full name. (Acronyms in all-caps demat names like SBI/UTI become
 * Sbi/Uti — the AMFI-resolved scheme name would case these perfectly; flagged as a follow-up.)
 */
export function cleanMfName(fullName: string): string {
  let s = (fullName ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return fullName;
  const hash = s.indexOf('#');
  if (hash >= 0) s = s.slice(hash + 1).trim(); // AMC#scheme → scheme part
  s = s.replace(/^[A-Z0-9]{2,6}\s*-\s*/, ''); // leading scheme code: "TPDG - ", "8019 - "
  s = s.replace(/^.*?\bMF\s*-\s*/i, ''); // demat "… MF- " AMC prefix
  s = s.replace(/\s*\(formerly[^)]*\)/i, ''); // "(formerly …)" aside
  s = s.replace(/[-\s]+(?:direct|regular)\b.*$/i, ''); // plan/option suffix (Direct/Regular onward)
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return fullName;
  return s === s.toUpperCase() ? titleCase(s) : s;
}

/** Type-aware clean display name: MFs use the code-prefix/plan-suffix rule, others the #/dash rule. */
export function displayNameForType(name: string, type: string): string {
  return type === 'MUTUAL_FUND' ? cleanMfName(name) : shortHoldingName(name);
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

/**
 * The gain/loss display status the chart keys its bar off: 'gain'/'loss' colour, or 'none' →
 * the striped "no cost basis" hatch. A holding with unknown cost basis (e.g. an eCAS-imported
 * stock — eCAS has no cost column) is 'none' and shows no P/L; holdings WITH a basis are
 * unchanged. (Extracted so the striped-vs-coloured decision is unit-testable.)
 */
export function gainLossStatus(a: WealthAsset): 'gain' | 'loss' | 'none' {
  const g = assetGainLoss(a);
  if (g === null) return 'none';
  return g.absolute > 0 ? 'gain' : g.absolute < 0 ? 'loss' : 'none';
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
