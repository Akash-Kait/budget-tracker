'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ConvertForm({ itemId, defaultAmount }: { itemId: string; defaultAmount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(defaultAmount));
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState(3);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!dueDate) {
      setError('Pick a target date.');
      return;
    }
    const res = await fetch(`/api/items/${itemId}/convert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: Number(amount),
        dueDate: new Date(dueDate).toISOString(),
        priority: Number(priority),
      }),
    });
    if (!res.ok) {
      setError('Conversion failed.');
      return;
    }
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-accent hover:underline">
        Convert to Goal
      </button>
    );
  }
  const input =
    'rounded border border-hairline bg-surface-2 px-2 py-1 text-sm text-text placeholder:text-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent-weak';
  return (
    <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2">
      <input
        className={input}
        type="number"
        placeholder="Target amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <input
        className={input}
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
      />
      <select
        className={input}
        value={priority}
        onChange={(e) => setPriority(Number(e.target.value))}
      >
        {[1, 2, 3, 4, 5].map((p) => (
          <option key={p} value={p}>
            P{p}
          </option>
        ))}
      </select>
      <button className="rounded bg-accent px-3 py-1 text-sm font-medium text-bg transition-opacity hover:opacity-90">
        Convert
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-faint hover:text-text"
      >
        Cancel
      </button>
      {error && <p className="w-full text-xs text-negative">{error}</p>}
    </form>
  );
}
