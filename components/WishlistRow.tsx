'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Money } from '@/components/Money';
import { ConvertForm } from '@/components/ConvertForm';
import type { Item } from '@/lib/types';

export function WishlistRow({
  item,
  daysRemaining,
  daysOld,
}: {
  item: Item;
  daysRemaining: number;
  daysOld: number;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const locked = daysRemaining > 0 && !item.purchased;

  async function purchase() {
    setMsg(null);
    const res = await fetch(`/api/items/${item.id}/purchase`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json();
      setMsg(data.daysRemaining ? `${data.daysRemaining} days remaining` : 'Could not mark purchased');
      return;
    }
    router.refresh();
  }

  async function del() {
    if (!confirm(`Delete "${item.title}"?`)) return;
    await fetch(`/api/items/${item.id}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <div className="flex items-center justify-between border-b border-hairline py-3 last:border-0">
      <div>
        <p className="font-medium text-text">
          {item.title}{' '}
          {item.purchased && <span className="text-xs text-accent">✓ purchased</span>}
        </p>
        <p className="text-xs text-muted">
          <Money amount={item.amount} /> · P{item.priority}
          {item.notes ? ` · ${item.notes}` : ''}
        </p>
        <p className="text-xs text-faint">
          Added: {daysOld} day{daysOld === 1 ? '' : 's'} ago
        </p>
        {locked && (
          <p className="text-xs text-warning">
            Cooling period: {daysRemaining} day{daysRemaining > 1 ? 's' : ''} remaining
          </p>
        )}
        {msg && <p className="text-xs text-negative">{msg}</p>}
        {!item.purchased && <ConvertForm itemId={item.id} defaultAmount={item.amount} />}
      </div>
      <div className="flex items-center gap-3">
        {!item.purchased && (
          <button
            onClick={purchase}
            disabled={locked}
            className={`rounded-md px-3 py-1 text-sm font-medium ${
              locked
                ? 'cursor-not-allowed bg-surface-2 text-faint'
                : 'bg-accent text-bg transition-opacity hover:opacity-90'
            }`}
          >
            Mark purchased
          </button>
        )}
        <button onClick={del} className="text-xs text-muted hover:text-negative">
          Delete
        </button>
      </div>
    </div>
  );
}
