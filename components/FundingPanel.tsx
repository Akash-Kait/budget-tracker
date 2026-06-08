'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatINR, formatMonth } from '@/lib/format';

interface Tx {
  id: string;
  amount: number;
  note: string | null;
  date: string;
}

export function FundingPanel({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<Tx[] | null>(null);

  async function load() {
    const res = await fetch(`/api/items/${itemId}/funding`);
    if (res.ok) setHistory(await res.json());
  }
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && history === null) await load();
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!n || n <= 0) return;
    const res = await fetch(`/api/items/${itemId}/funding`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount: n, note: note || undefined }),
    });
    if (res.ok) {
      setAmount('');
      setNote('');
      await load();
      router.refresh();
    }
  }

  return (
    <div className="mt-2">
      <button onClick={toggle} className="text-xs text-accent hover:underline">
        {open ? 'Hide funding' : 'Add funding'}
      </button>
      {open && (
        <div className="mt-2 rounded-md bg-surface-2 p-3">
          <form onSubmit={add} className="flex flex-wrap items-center gap-2">
            <input
              className="w-28 rounded border border-hairline bg-surface px-2 py-1 text-sm text-text placeholder:text-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent-weak"
              type="number"
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <input
              className="flex-1 rounded border border-hairline bg-surface px-2 py-1 text-sm text-text placeholder:text-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent-weak"
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button className="rounded bg-accent px-3 py-1 text-sm font-medium text-bg transition-opacity hover:opacity-90">
              Add
            </button>
          </form>
          {history && history.length > 0 && (
            <>
              <p className="mt-2 text-xs font-medium text-text">
                Funding history — {formatINR(history.reduce((s, t) => s + t.amount, 0))} across{' '}
                {history.length} transaction{history.length > 1 ? 's' : ''}
              </p>
              <ul className="mt-1 space-y-1 text-xs text-muted">
                {history.map((t) => (
                  <li key={t.id}>
                    {formatMonth(t.date)} +{formatINR(t.amount)}
                    {t.note ? ` — ${t.note}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
          {history && history.length === 0 && (
            <p className="mt-2 text-xs text-faint">No funding yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
