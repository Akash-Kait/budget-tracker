import { Money } from '@/components/Money';
import { fundingProgress } from '@/lib/finance';
import type { Item } from '@/lib/types';

export function FundingBars({ items }: { items: Item[] }) {
  if (items.length === 0) return <p className="text-sm text-muted">No active items.</p>;
  return (
    <div className="space-y-3">
      {items.map((i) => {
        const { pct, overFundedBy } = fundingProgress(i);
        const remaining = Math.max(0, i.amount - i.fundedAmount);
        return (
          <div key={i.id}>
            <div className="mb-1 flex justify-between text-xs">
              <span className="font-medium text-text">{i.title}</span>
              <span className="text-muted">
                {pct}% ·{' '}
                {overFundedBy > 0 ? (
                  <span className="text-warning">
                    +<Money amount={overFundedBy} /> over
                  </span>
                ) : (
                  <>
                    <Money amount={remaining} /> left
                  </>
                )}
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full ${overFundedBy > 0 ? 'bg-warning' : 'bg-accent'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
