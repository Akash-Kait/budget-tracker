'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Money } from '@/components/Money';
import { WealthAssetForm } from '@/components/wealth/WealthAssetForm';
import { assetValue } from '@/lib/wealth';
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
      <div className="border-b border-gray-100 py-3 last:border-0">
        <WealthAssetForm initial={asset} onDone={() => setEditing(false)} />
        <button
          onClick={() => setEditing(false)}
          className="mt-2 text-xs text-gray-500 hover:underline"
        >
          Cancel
        </button>
      </div>
    );
  }

  const breakdown =
    asset.quantity != null && asset.pricePerUnit != null
      ? `${asset.quantity} × ₹${asset.pricePerUnit.toLocaleString('en-IN')}`
      : 'manual value';

  return (
    <div className="flex items-center justify-between border-b border-gray-100 py-3 last:border-0">
      <div>
        <p className="font-medium">
          {asset.name}
          {asset.ticker ? <span className="ml-2 text-xs text-gray-400">{asset.ticker}</span> : null}
        </p>
        <p className="text-xs text-gray-500">{breakdown}</p>
      </div>
      <div className="flex items-center gap-4">
        <span className="font-medium">
          <Money amount={assetValue(asset)} />
        </span>
        <button onClick={() => setEditing(true)} className="text-xs text-blue-600 hover:underline">
          Edit
        </button>
        <button onClick={del} className="text-xs text-red-500 hover:underline">
          Delete
        </button>
      </div>
    </div>
  );
}
