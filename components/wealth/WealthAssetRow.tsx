'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Money } from '@/components/Money';
import { WealthAssetForm } from '@/components/wealth/WealthAssetForm';
import { assetValue } from '@/lib/wealth';
import { formatMonth } from '@/lib/format';
import type { WealthAsset } from '@/lib/types';

export function WealthAssetRow({ asset }: { asset: WealthAsset }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  async function del() {
    if (!confirm(`Delete "${asset.name}"?`)) return;
    await fetch(`/api/wealth/${asset.id}`, { method: 'DELETE' });
    router.refresh();
  }

  if (editing) {
    return (
      <div className="border-b border-hairline py-4 last:border-0">
        <WealthAssetForm initial={asset} onDone={() => setEditing(false)} />
      </div>
    );
  }

  const holding =
    asset.quantity != null && asset.pricePerUnit != null
      ? `${asset.quantity} × ₹${asset.pricePerUnit.toLocaleString('en-IN')}`
      : 'Manual value';

  return (
    <div className="grid grid-cols-2 items-center gap-x-3 gap-y-1 border-b border-hairline py-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_150px_150px_110px] sm:gap-y-0">
      {/* Asset */}
      <div className="col-span-2 sm:col-span-1">
        <span className="font-medium text-text">{asset.name}</span>
        {asset.ticker && (
          <span className="ml-2 rounded border border-hairline px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted">
            {asset.ticker}
          </span>
        )}
      </div>
      {/* Holding */}
      <span className="font-mono text-xs tabular-nums text-muted">{holding}</span>
      {/* Price as-of */}
      <span className="text-xs text-faint">
        {asset.priceUpdatedAt
          ? `${asset.priceSource === 'API' ? 'Live' : 'Manual'} · ${formatMonth(asset.priceUpdatedAt)}`
          : ''}
      </span>
      {/* Value + actions */}
      <div className="col-span-2 flex items-center justify-between sm:col-span-1 sm:justify-end sm:gap-4">
        <span className="font-mono text-sm font-medium tabular-nums text-text">
          <Money amount={assetValue(asset)} />
        </span>
        <span className="flex gap-3">
          <button onClick={() => setEditing(true)} className="text-xs text-muted transition-colors hover:text-accent">
            Edit
          </button>
          <button onClick={del} className="text-xs text-muted transition-colors hover:text-negative">
            Delete
          </button>
        </span>
      </div>
    </div>
  );
}
