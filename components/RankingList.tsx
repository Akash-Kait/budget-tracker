'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Item } from '@/lib/types';

const badge: Record<string, string> = {
  COMMITMENT: 'bg-red-100 text-red-700',
  GOAL: 'bg-purple-100 text-purple-700',
  EXPERIENCE: 'bg-blue-100 text-blue-700',
  WISHLIST: 'bg-gray-100 text-gray-700',
};

export function RankingList({ initial }: { initial: Item[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);

  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const next = [...items];
    const from = next.findIndex((i) => i.id === dragId);
    const to = next.findIndex((i) => i.id === targetId);
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
    setDragId(null);
    fetch('/api/items/reorder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: next.map((i) => i.id) }),
    }).then(() => router.refresh());
  }

  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li
          key={i.id}
          draggable
          onDragStart={() => setDragId(i.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => onDrop(i.id)}
          className={`flex cursor-move items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 ${
            dragId === i.id ? 'opacity-50' : ''
          }`}
        >
          <span className="text-gray-400">⠿</span>
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge[i.type]}`}>
            {i.type}
          </span>
          <span className="font-medium">{i.title}</span>
          <span className="ml-auto text-xs text-gray-500">P{i.priority}</span>
        </li>
      ))}
    </ul>
  );
}
