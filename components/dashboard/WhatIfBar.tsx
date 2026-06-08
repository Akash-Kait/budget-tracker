'use client';
import { Card } from '@/components/Card';
import { RecommendationBanner } from '@/components/RecommendationBanner';
import type { SimulationResult } from '@/lib/finance';

export function WhatIfBar({
  name,
  cost,
  onName,
  onCost,
  onClear,
  sim,
}: {
  name: string;
  cost: string;
  onName: (v: string) => void;
  onCost: (v: string) => void;
  onClear: () => void;
  sim: SimulationResult | null;
}) {
  const input = 'rounded-md border border-gray-300 px-3 py-2 text-sm';
  return (
    <Card title="Quick What-If">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={input}
          placeholder="Item name"
          value={name}
          onChange={(e) => onName(e.target.value)}
        />
        <input
          className={input}
          type="number"
          placeholder="Cost (₹)"
          value={cost}
          onChange={(e) => onCost(e.target.value)}
        />
        {sim && (
          <button
            onClick={onClear}
            className="rounded-md bg-gray-200 px-3 py-2 text-sm font-medium hover:bg-gray-300"
          >
            Clear Simulation
          </button>
        )}
        {sim && (
          <span className="text-xs text-gray-500">
            Simulating — dashboard reflects this purchase (not saved).
          </span>
        )}
      </div>
      {sim && (
        <div className="mt-3">
          <RecommendationBanner rec={sim.recommendation} message={sim.message} />
        </div>
      )}
    </Card>
  );
}
