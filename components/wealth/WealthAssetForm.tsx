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
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    const payload = { type: form.type, name: form.name, ticker: form.ticker || null, quantity, pricePerUnit, value };
    const url = initial ? `/api/wealth/${initial.id}` : '/api/wealth';
    const res = await fetch(url, {
      method: initial ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      setError('Could not save. Check the fields.');
      return;
    }
    if (!initial) setForm({ ...form, name: '', ticker: '', quantity: '', pricePerUnit: '', value: '' });
    onDone?.();
    router.refresh();
  }

  const field =
    'w-full rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-faint outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-weak';

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-faint">Type</span>
        <select
          className={field}
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value as AssetType })}
        >
          {ASSET_TYPES.map((t) => (
            <option key={t} value={t} className="bg-surface-2 text-text">
              {ASSET_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-faint">Name</span>
        <input className={field} placeholder="e.g. Nifty 50 Index Fund" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-faint">Ticker</span>
        <input className={field} placeholder="optional" value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-faint">Quantity</span>
        <input className={`${field} font-mono tabular-nums`} type="number" placeholder="units" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-faint">Price / unit</span>
        <input className={`${field} font-mono tabular-nums`} type="number" placeholder="₹" value={form.pricePerUnit} onChange={(e) => setForm({ ...form, pricePerUnit: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-faint">Manual value</span>
        <input className={`${field} font-mono tabular-nums`} type="number" placeholder="₹ (if no qty×price)" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
      </label>

      <div className="flex items-center gap-3 sm:col-span-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Saving…' : initial ? 'Save' : 'Add asset'}
        </button>
        {initial && (
          <button
            type="button"
            onClick={() => onDone?.()}
            className="rounded-lg border border-hairline px-4 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            Cancel
          </button>
        )}
        {error ? (
          <p className="text-xs text-negative">{error}</p>
        ) : (
          <p className="text-xs text-faint">Value = quantity × price when both are given; otherwise the manual value.</p>
        )}
      </div>
    </form>
  );
}
