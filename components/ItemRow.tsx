'use client';
import { useRouter } from 'next/navigation';
import { Money } from '@/components/Money';
import { ProgressBar } from '@/components/ProgressBar';
import { formatMonth } from '@/lib/format';
import type { Item } from '@/lib/types';

const badge: Record<string, string> = {
  COMMITMENT: 'bg-red-100 text-red-700',
  GOAL: 'bg-purple-100 text-purple-700',
  EXPERIENCE: 'bg-blue-100 text-blue-700',
  WISHLIST: 'bg-gray-100 text-gray-700',
};

export function ItemRow({ item }: { item: Item }) {
  const router = useRouter();
  const pct = item.amount > 0 ? Math.round((item.fundedAmount / item.amount) * 100) : 0;
  async function del() {
    if (!confirm(`Delete "${item.title}"?`)) return;
    await fetch(`/api/items/${item.id}`, { method: 'DELETE' });
    router.refresh();
  }
  return (
    <div className="flex items-center gap-4 border-b border-gray-100 py-3 last:border-0">
      <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge[item.type]}`}>
        {item.type}
      </span>
      <div className="w-40">
        <p className="font-medium">{item.title}</p>
        <p className="text-xs text-gray-500">
          P{item.priority}
          {item.dueDate ? ` · ${formatMonth(item.dueDate)}` : ''}
        </p>
      </div>
      <div className="flex-1">
        <ProgressBar pct={pct} />
        <p className="mt-1 text-xs text-gray-500">
          <Money amount={item.fundedAmount} /> / <Money amount={item.amount} /> · {pct}%
        </p>
      </div>
      <button onClick={del} className="text-xs text-red-500 hover:underline">
        Delete
      </button>
    </div>
  );
}
