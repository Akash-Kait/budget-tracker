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

const badge: Record<string, string> = {
  COMMITMENT: 'bg-red-100 text-red-700',
  GOAL: 'bg-purple-100 text-purple-700',
  EXPERIENCE: 'bg-blue-100 text-blue-700',
  WISHLIST: 'bg-gray-100 text-gray-700',
};

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
      <div className="border-b border-gray-100 py-3 last:border-0">
        <ItemForm initial={item} onDone={() => setEditing(false)} />
        <button
          onClick={() => setEditing(false)}
          className="mt-2 text-xs text-gray-500 hover:underline"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-gray-100 py-3 last:border-0">
      <div className="flex items-center gap-4">
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge[item.type]}`}>
          {item.type}
        </span>
        <div className="w-40">
          <p className="font-medium">{item.title}</p>
          <p className="text-xs text-gray-500">
            P{item.priority}
            {item.dueDate ? ` · due ${formatMonth(item.dueDate)}` : ''}
          </p>
        </div>
        <div className="flex-1">
          <ProgressBar pct={pct} />
          <p className="mt-1 text-xs text-gray-500">
            <Money amount={item.fundedAmount} /> / <Money amount={item.amount} /> ·{' '}
            {overFundedBy > 0 ? (
              <span className="text-amber-600">
                over-funded by <Money amount={overFundedBy} />
              </span>
            ) : (
              <>
                Remaining <Money amount={remaining} />
              </>
            )}
          </p>
          <p className="text-xs text-gray-500">
            {projectedIso ? (
              <>
                Projected: {formatMonth(projectedIso)}
                {behindMonths && behindMonths > 0 ? (
                  <span className="text-amber-600"> · ⚠ behind by {behindMonths} mo</span>
                ) : (
                  <span className="text-green-600"> · on track</span>
                )}
              </>
            ) : (
              <span className="text-gray-400">Projected: not on current plan</span>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs">
          <button onClick={() => setEditing(true)} className="text-blue-600 hover:underline">
            Edit
          </button>
          <button onClick={complete} className="text-green-600 hover:underline">
            Complete
          </button>
          <button onClick={del} className="text-red-500 hover:underline">
            Delete
          </button>
        </div>
      </div>
      <FundingPanel itemId={item.id} />
    </div>
  );
}
