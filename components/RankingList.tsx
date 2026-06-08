'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Item } from '@/lib/types';

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
          className={`flex cursor-move items-center gap-3 rounded-lg border border-hairline bg-surface px-4 py-3 transition-colors hover:border-hairline-strong ${
            dragId === i.id ? 'opacity-50' : ''
          }`}
        >
          <span className="text-faint">⠿</span>
          <span className="rounded bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
            {i.type}
          </span>
          <span className="font-medium text-text">{i.title}</span>
          <span className="ml-auto text-xs text-muted">P{i.priority}</span>
        </li>
      ))}
    </ul>
  );
}
