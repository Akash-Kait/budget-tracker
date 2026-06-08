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
      setMsg('Refresh failed.');
      return;
    }
    const data = await res.json();
    setMsg(
      data.provider === 'manual'
        ? 'Manual mode — connect a market-data provider for live prices.'
        : `Updated ${data.updated} of ${data.checked} tickers.`,
    );
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
