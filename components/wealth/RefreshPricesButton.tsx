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
        ? 'Manual mode — connect a market-data provider to fetch live prices.'
        : `Updated ${data.updated} of ${data.checked} tickers.`,
    );
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={refresh}
        disabled={busy}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-100 disabled:opacity-50"
      >
        {busy ? 'Refreshing…' : 'Refresh prices'}
      </button>
      {msg && <span className="text-xs text-gray-500">{msg}</span>}
    </div>
  );
}
