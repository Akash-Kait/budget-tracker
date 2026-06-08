'use client';
import { useState } from 'react';
import { Card } from '@/components/Card';
import { Money } from '@/components/Money';
import { RecommendationBanner } from '@/components/RecommendationBanner';
import type { Recommendation } from '@/lib/types';

interface SimResult {
  name: string | null;
  cost: number;
  reserveBefore: number;
  reserveAfter: number;
  reductionPct: number;
  monthsToRestore: number | null;
  goalImpacts: { title: string; delayMonths: number }[];
  recommendation: Recommendation;
  message: string;
}

export default function SimulatorPage() {
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const n = Number(cost);
    if (!n || n <= 0) {
      setError('Enter a positive cost.');
      return;
    }
    const res = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, cost: n }),
    });
    if (!res.ok) {
      setError('Simulation failed.');
      return;
    }
    setResult(await res.json());
  }

  const input = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm';
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Purchase Impact Simulator</h1>
      <Card title="Should I buy this?">
        <form onSubmit={run} className="space-y-3">
          <input
            className={input}
            placeholder="Item name (e.g. Home Theater)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className={input}
            type="number"
            placeholder="Cost (₹)"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
          <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            Simulate
          </button>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </form>
      </Card>

      {result && (
        <div className="space-y-4">
          <RecommendationBanner rec={result.recommendation} message={result.message} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Card title="Reserve Before">
              <p className="text-xl font-bold">
                <Money amount={result.reserveBefore} />
              </p>
            </Card>
            <Card title="Reserve After">
              <p className={`text-xl font-bold ${result.reserveAfter < 0 ? 'text-red-600' : ''}`}>
                <Money amount={result.reserveAfter} />
              </p>
            </Card>
            <Card title="Reduction">
              <p className="text-xl font-bold">{result.reductionPct.toFixed(1)}%</p>
            </Card>
          </div>
          <Card title="Months to restore reserve">
            <p className="text-lg">
              {result.monthsToRestore === null
                ? 'Cannot restore from current surplus'
                : `${result.monthsToRestore} month(s)`}
            </p>
          </Card>
          {result.goalImpacts.length > 0 && (
            <Card title="Impact on goals">
              {result.goalImpacts.map((g) => (
                <p key={g.title} className="text-sm">
                  {g.title}:{' '}
                  {g.delayMonths > 0 ? (
                    <span className="text-red-600">delayed {g.delayMonths} month(s)</span>
                  ) : (
                    <span className="text-green-600">no impact</span>
                  )}
                </p>
              ))}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
