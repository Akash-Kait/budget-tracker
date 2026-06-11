'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RefreshPricesButton() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    setMsg(null);
    const res = await fetch('/api/wealth/refresh-prices', { method: 'POST' });
    setBusy(false);
    if (!res.ok) {
      // Loud, not silent: a write failure changed nothing server-side (prices kept), so say so.
      setMsg('Price refresh failed — prices unchanged, may be stale.');
      return;
    }
    const data = await res.json();
    if (data.mfProvider === 'manual' && data.equityProvider === 'manual') {
      setMsg('Manual mode — set MARKET_DATA_PROVIDER=amfi (MF NAVs) / EQUITY_DATA_PROVIDER=nse (stock closes) for live prices.');
    } else if (data.checked === 0 && !data.manual?.length) {
      setMsg('No holdings with a ticker to refresh.');
    } else {
      const parts: string[] = [];
      if (data.checked > 0) parts.push(`Updated ${data.updated}/${data.checked}`);
      if (data.stale?.length) parts.push(`${data.stale.length} stale`);
      if (data.notFound?.length) parts.push(`couldn’t update: ${data.notFound.join(', ')}`);
      // A domain whose live provider isn't enabled — its assets weren't attempted (so they're NOT
      // hidden in the "X/Y" denominator); say so instead of looking like silent failures.
      if (data.manual?.length) parts.push(`${data.manual.join(' & ')}: live pricing not enabled`);
      // A whole domain's feed was down — prices kept, surfaced (not silently frozen-as-current).
      if (data.failed?.length) parts.push(`${data.failed.join(' & ')} feed unavailable — prices kept, may be stale`);
      setMsg(parts.join(' · '));
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      {msg && <span className="hidden text-xs text-faint sm:inline">{msg}</span>}
      <button
        onClick={refresh}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg border border-hairline px-3 py-1.5 text-sm text-text transition-colors hover:bg-surface-2 hover:border-hairline-strong disabled:opacity-50"
      >
        {busy && (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-faint border-t-accent" />
        )}
        {busy ? 'Refreshing…' : 'Refresh prices'}
      </button>
    </div>
  );
}
