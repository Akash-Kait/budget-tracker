const PALETTE = [
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#06b6d4',
  '#ef4444',
  '#6366f1',
  '#84cc16',
  '#f97316',
];

export function colorFor(index: number): string {
  return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];
}

export const RESERVE_COLOR = '#94a3b8';

// ── Wealth dashboard data-viz palette (dark-tuned, accent-anchored) ──
// Cohesive mint → cyan + neutral slate; high-contrast on near-black. Distinct from the
// gain/loss semantic tokens (--positive/--negative) by design. Keyed by AssetType.
import type { AssetType } from '@/lib/types';

export const WEALTH_CHART: Record<AssetType, string> = {
  MUTUAL_FUND: '#34d399', // accent (mint)
  STOCK: '#22d3ee', // harmonized cyan
  OTHER: '#64748b', // neutral slate
};

export function wealthTypeColor(type: AssetType): string {
  return WEALTH_CHART[type];
}
