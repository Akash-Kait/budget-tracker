'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// Upload a CAMS/KFintech CAS PDF to auto-populate mutual-fund holdings. The PDF + password are sent
// once, processed server-side, and never stored — surfaced in the copy below.
export function CasImportPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setErr('Choose your CAS PDF first.');
      return;
    }
    const body = new FormData();
    body.append('file', file);
    body.append('password', password);

    setBusy(true);
    const res = await fetch('/api/wealth/import-cas', { method: 'POST', body });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErr(data.error ?? 'Import failed.');
      return;
    }
    const d = await res.json();
    const parts = [`Imported ${d.created} new`, `updated ${d.updated}`];
    if (d.flaggedAbsent) parts.push(`${d.flaggedAbsent} not in this CAS`);
    setMsg(`${parts.join(' · ')}${d.statementDate ? ` (as of ${d.statementDate})` : ''}.`);
    setPassword('');
    if (fileRef.current) fileRef.current.value = '';
    router.refresh();
  }

  const field =
    'w-full rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-faint outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-weak [color-scheme:dark]';

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-faint">CAS PDF</span>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className={`${field} file:mr-3 file:rounded file:border-0 file:bg-surface file:px-2 file:py-1 file:text-xs file:text-muted`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-faint">PDF password</span>
        <input type="password" autoComplete="off" className={field} placeholder="usually your PAN" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Importing…' : 'Import CAS'}
      </button>

      <div className="sm:col-span-3">
        {err ? (
          <p className="text-xs text-negative">{err}</p>
        ) : msg ? (
          <p className="text-xs text-faint">{msg}</p>
        ) : (
          <p className="text-xs text-faint">
            Mutual funds only. Your PDF &amp; password are used once on the server to read holdings —
            never stored or logged. Existing holdings update in place; ones missing from this
            statement are flagged, never deleted.
          </p>
        )}
      </div>
    </form>
  );
}
