'use client';
import { useState } from 'react';
import { Card } from '@/components/Card';
import { Money } from '@/components/Money';
import { RecommendationBanner } from '@/components/RecommendationBanner';
import type { SimulationResult } from '@/lib/finance';

type SimResult = SimulationResult & { name: string | null };

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

  const input = 'w-full rounded-md border border-hairline bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent-weak';
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
          <button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg transition-opacity hover:opacity-90">
            Simulate
          </button>
          {error && <p className="text-xs text-negative">{error}</p>}
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
              <p className={`text-xl font-bold ${result.reserveAfter < 0 ? 'text-negative' : ''}`}>
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
                  {g.nowUnfundable ? (
                    <span className="text-negative">no longer fundable within 10 years</span>
                  ) : g.delayMonths > 0 ? (
                    <span className="text-negative">delayed {g.delayMonths} month(s)</span>
                  ) : (
                    <span className="text-accent">no impact</span>
                  )}
                </p>
              ))}
            </Card>
          )}
          {result.underfunded.length > 0 && (
            <Card title="Pushed past due date">
              <p className="text-sm text-negative">{result.underfunded.join(', ')}</p>
              <p className="mt-1 text-xs text-muted">
                This purchase delays funding enough that these dated items miss their target date.
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
