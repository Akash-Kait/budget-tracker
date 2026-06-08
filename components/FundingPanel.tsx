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
      <button onClick={toggle} className="text-xs text-blue-600 hover:underline">
        {open ? 'Hide funding' : 'Add funding'}
      </button>
      {open && (
        <div className="mt-2 rounded-md bg-gray-50 p-3">
          <form onSubmit={add} className="flex flex-wrap items-center gap-2">
            <input
              className="w-28 rounded border border-gray-300 px-2 py-1 text-sm"
              type="number"
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <input
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700">
              Add
            </button>
          </form>
          {history && history.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-gray-600">
              {history.map((t) => (
                <li key={t.id}>
                  {formatMonth(t.date)} +{formatINR(t.amount)}
                  {t.note ? ` — ${t.note}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
