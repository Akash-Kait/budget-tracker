'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ASSET_TYPES, ASSET_TYPE_LABELS } from '@/lib/types';
import type { WealthAsset, AssetType } from '@/lib/types';

type Props = { initial?: WealthAsset; onDone?: () => void };

export function WealthAssetForm({ initial, onDone }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    type: (initial?.type ?? 'MUTUAL_FUND') as AssetType,
    name: initial?.name ?? '',
    ticker: initial?.ticker ?? '',
    quantity: initial?.quantity != null ? String(initial.quantity) : '',
    pricePerUnit: initial?.pricePerUnit != null ? String(initial.pricePerUnit) : '',
    value: initial?.value != null ? String(initial.value) : '',
  });
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    const quantity = form.quantity === '' ? null : Number(form.quantity);
    const pricePerUnit = form.pricePerUnit === '' ? null : Number(form.pricePerUnit);
    const value = form.value === '' ? null : Number(form.value);
    if (!((quantity != null && pricePerUnit != null) || value != null)) {
      setError('Enter quantity + price, or a manual value.');
      return;
    }
    const payload = {
      type: form.type,
      name: form.name,
      ticker: form.ticker || null,
      quantity,
      pricePerUnit,
      value,
    };
    const url = initial ? `/api/wealth/${initial.id}` : '/api/wealth';
    const res = await fetch(url, {
      method: initial ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      setError('Could not save. Check the fields.');
      return;
    }
    if (!initial) {
      setForm({ ...form, name: '', ticker: '', quantity: '', pricePerUnit: '', value: '' });
    }
    onDone?.();
    router.refresh();
  }

  const input = 'rounded-md border border-gray-300 px-2 py-1 text-sm';
  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <select
        className={input}
        value={form.type}
        onChange={(e) => setForm({ ...form, type: e.target.value as AssetType })}
      >
        {ASSET_TYPES.map((t) => (
          <option key={t} value={t}>
            {ASSET_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <input
        className={input}
        placeholder="Name"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <input
        className={input}
        placeholder="Ticker (optional)"
        value={form.ticker}
        onChange={(e) => setForm({ ...form, ticker: e.target.value })}
      />
      <input
        className={input}
        type="number"
        placeholder="Quantity"
        value={form.quantity}
        onChange={(e) => setForm({ ...form, quantity: e.target.value })}
      />
      <input
        className={input}
        type="number"
        placeholder="Price / unit"
        value={form.pricePerUnit}
        onChange={(e) => setForm({ ...form, pricePerUnit: e.target.value })}
      />
      <input
        className={input}
        type="number"
        placeholder="Manual value"
        value={form.value}
        onChange={(e) => setForm({ ...form, value: e.target.value })}
      />
      <button
        type="submit"
        className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
      >
        {initial ? 'Save' : 'Add'}
      </button>
      {error && <p className="col-span-full text-xs text-red-600">{error}</p>}
      <p className="col-span-full text-xs text-gray-400">
        Value = quantity × price when both are given; otherwise the manual value is used.
      </p>
    </form>
  );
}
