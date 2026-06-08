'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Money } from '@/components/Money';
import { ProgressBar } from '@/components/ProgressBar';
import { ItemForm } from '@/components/ItemForm';
import { FundingPanel } from '@/components/FundingPanel';
import { formatMonth } from '@/lib/format';
import { fundingProgress } from '@/lib/finance';
import type { Item } from '@/lib/types';

interface Props {
  item: Item;
  remaining: number;
  projectedIso: string | null;
  behindMonths: number | null;
}

export function EditableItemRow({ item, remaining, projectedIso, behindMonths }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const { pct, overFundedBy } = fundingProgress(item);

  async function complete() {
    await fetch(`/api/items/${item.id}/complete`, { method: 'POST' });
    router.refresh();
  }
  async function del() {
    if (!confirm(`Delete "${item.title}"?`)) return;
    await fetch(`/api/items/${item.id}`, { method: 'DELETE' });
    router.refresh();
  }

  if (editing) {
    return (
      <div className="border-b border-hairline py-3 last:border-0">
        <ItemForm initial={item} onDone={() => setEditing(false)} />
        <button
          onClick={() => setEditing(false)}
          className="mt-2 text-xs text-faint hover:text-text"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-hairline py-3 last:border-0">
      <div className="flex items-center gap-4">
        <span className="rounded bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
          {item.type}
        </span>
        <div className="w-40">
          <p className="font-medium text-text">{item.title}</p>
          <p className="text-xs text-muted">
            P{item.priority}
            {item.dueDate ? ` · due ${formatMonth(item.dueDate)}` : ''}
          </p>
        </div>
        <div className="flex-1">
          <ProgressBar pct={pct} />
          <p className="mt-1 text-xs text-muted">
            <Money amount={item.fundedAmount} /> / <Money amount={item.amount} /> ·{' '}
            {overFundedBy > 0 ? (
              <span className="text-warning">
                over-funded by <Money amount={overFundedBy} />
              </span>
            ) : (
              <>
                Remaining <Money amount={remaining} />
              </>
            )}
          </p>
          <p className="text-xs text-muted">
            {projectedIso ? (
              <>
                Projected: {formatMonth(projectedIso)}
                {behindMonths && behindMonths > 0 ? (
                  <span className="text-warning"> · ⚠ behind by {behindMonths} mo</span>
                ) : (
                  <span className="text-accent"> · on track</span>
                )}
              </>
            ) : (
              <span className="text-faint">Projected: not on current plan</span>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs">
          <button onClick={() => setEditing(true)} className="text-muted hover:text-accent">
            Edit
          </button>
          <button onClick={complete} className="text-muted hover:text-accent">
            Complete
          </button>
          <button onClick={del} className="text-muted hover:text-negative">
            Delete
          </button>
        </div>
      </div>
      <FundingPanel itemId={item.id} />
    </div>
  );
}
