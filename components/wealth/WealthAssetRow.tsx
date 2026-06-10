'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Money } from '@/components/Money';
import { WealthAssetForm } from '@/components/wealth/WealthAssetForm';
import { GainLossText } from '@/components/wealth/GainLossText';
import { assetValue, assetGainLoss } from '@/lib/wealth';
import { formatDay } from '@/lib/format';
import type { WealthAsset } from '@/lib/types';

// `stale` is computed on the server (price freshness lives in the market boundary, not here).
export function WealthAssetRow({ asset, stale = false }: { asset: WealthAsset; stale?: boolean }) {
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
    <div className="grid grid-cols-2 items-center gap-x-3 gap-y-1 border-b border-hairline py-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_130px_180px_130px] sm:gap-y-0">
      {/* Asset — name + ticker + status badge wrap together; resolved-fund echo on its own line */}
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-text">{asset.name}</span>
          {asset.ticker && (
            <span className="rounded border border-hairline px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted">
              {asset.ticker}
            </span>
          )}
          {asset.priceStatus === 'NOT_FOUND' && (
            <span
              title="This scheme code wasn't found in the NAV feed on the last refresh. Edit the asset to fix it."
              className="rounded border border-warning/40 bg-warning-weak px-1.5 py-0.5 text-[10px] font-medium text-warning"
            >
              scheme code didn’t resolve
            </span>
          )}
          {asset.casStatus === 'ABSENT' && (
            <span
              title="This holding wasn't in your most recently imported statement. It hasn't been deleted — re-import a statement that includes it, or remove it manually."
              className="rounded border border-warning/40 bg-warning-weak px-1.5 py-0.5 text-[10px] font-medium text-warning"
            >
              {/* source-aware copy (spec Q4): eCAS stocks vs MF CAS */}
              {asset.source === 'ECAS' ? 'not in latest eCAS statement' : 'not in latest CAS'}
            </span>
          )}
          {asset.source === 'ECAS' && asset.casStatus !== 'ABSENT' && (
            // Import-sourced vs manual marker, so the manual-maintenance gap is honest in the UI.
            <span className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-faint">
              from eCAS
            </span>
          )}
        </div>
        {asset.tickerName && (
          // Echo the provider-resolved scheme name so a wrong-but-valid code is visible.
          <span className="mt-0.5 block truncate text-[11px] leading-tight text-faint">
            ↳ {asset.tickerName}
          </span>
        )}
      </div>
      {/* Holding */}
      <span className="min-w-0 truncate font-mono text-xs tabular-nums text-muted">{holding}</span>
      {/* Price as-of — AMFI NAV is end-of-day, never live; wraps within its own column */}
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-tight text-faint">
        {asset.priceUpdatedAt &&
          (asset.priceSource === 'API'
            ? `NAV as of ${formatDay(asset.priceUpdatedAt)} · end of day`
            : asset.priceSource === 'CAS'
              ? `From CAS · ${formatDay(asset.priceUpdatedAt)}`
              : asset.priceSource === 'ECAS'
                ? // statement-date price only — no live stock provider yet (spec Q6); honestly not live
                  `as of ${formatDay(asset.priceUpdatedAt)} · end of day`
                : `Manual · ${formatDay(asset.priceUpdatedAt)}`)}
        {stale && (
          <span
            title="This NAV is older than expected — the feed may not have updated for this scheme."
            className="rounded bg-warning-weak px-1.5 py-0.5 text-[10px] font-medium text-warning"
          >
            stale
          </span>
        )}
      </span>
      {/* Value + gain/loss + actions — stacked & right-aligned on desktop so it never crowds the
          as-of column regardless of ₹ magnitude; inline (value left / actions right) on mobile */}
      <div className="col-span-2 flex items-center justify-between sm:col-span-1 sm:flex-col sm:items-end sm:justify-center sm:gap-1">
        <div className="sm:text-right">
          <div className="font-mono text-sm font-medium tabular-nums text-text">
            <Money amount={assetValue(asset)} />
          </div>
          <GainLossText gl={assetGainLoss(asset)} className="text-xs" />
        </div>
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
