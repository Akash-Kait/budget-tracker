'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ITEM_TYPES } from '@/lib/types';
import type { Item, ItemType, Status } from '@/lib/types';

type Props = { initial?: Item; defaultType?: ItemType; onDone?: () => void };

export function ItemForm({ initial, defaultType, onDone }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    type: (initial?.type ?? defaultType ?? 'COMMITMENT') as ItemType,
    title: initial?.title ?? '',
    amount: initial?.amount ?? 0,
    priority: initial?.priority ?? 3,
    dueDate: initial?.dueDate ? initial.dueDate.slice(0, 10) : '',
    status: initial?.status ?? 'PLANNED',
    notes: initial?.notes ?? '',
    coolingPeriodDays: initial?.coolingPeriodDays ?? 30,
  });
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.title.trim()) {
      setError('Title is required.');
      return;
    }
    if (form.type !== 'WISHLIST' && !form.dueDate) {
      setError('Due date is required for non-wishlist items.');
      return;
    }
    const payload = {
      type: form.type,
      title: form.title,
      amount: Number(form.amount),
      priority: Number(form.priority),
      dueDate:
        form.type !== 'WISHLIST' && form.dueDate ? new Date(form.dueDate).toISOString() : null,
      status: form.type === 'COMMITMENT' ? form.status : null,
      notes: form.notes || null,
      coolingPeriodDays: Number(form.coolingPeriodDays),
    };
    const url = initial ? `/api/items/${initial.id}` : '/api/items';
    const res = await fetch(url, {
      method: initial ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      setError('Could not save. Check required fields.');
      return;
    }
    if (!initial) {
      setForm({ ...form, title: '', amount: 0, dueDate: '', notes: '' });
    }
    onDone?.();
    router.refresh();
  }

  const input =
    'rounded-md border border-hairline bg-surface-2 px-2 py-1 text-sm text-text placeholder:text-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent-weak';
  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <select
        className={input}
        value={form.type}
        onChange={(e) => setForm({ ...form, type: e.target.value as ItemType })}
      >
        {ITEM_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <input
        className={input}
        placeholder="Title"
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
      />
      <input
        className={input}
        type="number"
        placeholder="Amount"
        value={form.amount}
        onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
      />
      <select
        className={input}
        value={form.priority}
        onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
      >
        {[1, 2, 3, 4, 5].map((p) => (
          <option key={p} value={p}>
            P{p}
          </option>
        ))}
      </select>
      {form.type !== 'WISHLIST' ? (
        <input
          className={input}
          type="date"
          value={form.dueDate}
          onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
        />
      ) : (
        <input
          className={input}
          type="number"
          placeholder="Cooling days"
          value={form.coolingPeriodDays}
          onChange={(e) => setForm({ ...form, coolingPeriodDays: Number(e.target.value) })}
        />
      )}
      {form.type === 'COMMITMENT' && (
        <select
          className={input}
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value as Status })}
        >
          <option value="PLANNED">PLANNED</option>
          <option value="FUNDED">FUNDED</option>
          <option value="COMPLETED">COMPLETED</option>
        </select>
      )}
      <button
        type="submit"
        className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-bg transition-opacity hover:opacity-90"
      >
        {initial ? 'Save' : 'Add'}
      </button>
      {error && <p className="col-span-full text-xs text-negative">{error}</p>}
    </form>
  );
}
