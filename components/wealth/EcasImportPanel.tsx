'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// Upload a CDSL/NSDL eCAS PDF to auto-populate STOCK holdings (Phase 1: manual upload). The PDF +
// password are sent once, processed server-side, never stored. Mutual funds in the statement are
// skipped (tracked via the CAS importer); stocks carry no cost basis (eCAS has none) so they show
// no gain/loss — and prices read "as of <statement date>", not live.
export function EcasImportPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setWarn(null);
    setErr(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setErr('Choose your eCAS PDF first.');
      return;
    }
    const body = new FormData();
    body.append('file', file);
    body.append('password', password);

    setBusy(true);
    const res = await fetch('/api/wealth/import-ecas', { method: 'POST', body });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErr(data.error ?? 'Import failed.');
      return;
    }
    const d = await res.json();
    const parts = [`Imported ${d.created} new`, `updated ${d.updated}`];
    if (d.flaggedAbsent) parts.push(`${d.flaggedAbsent} not in this statement`);
    setMsg(`${parts.join(' · ')}${d.statementDate ? ` (as of ${d.statementDate})` : ''}.`);
    // Surface unrecognized + unreadable holdings — never a silent drop (spec Q7 / deep-review GAP).
    const warns: string[] = [];
    if (Array.isArray(d.unrecognized) && d.unrecognized.length > 0) {
      warns.push(`${d.unrecognized.length} unrecognized — not imported: ${d.unrecognized.map((u: { isin: string }) => u.isin).join(', ')}`);
    }
    if (Array.isArray(d.incomplete) && d.incomplete.length > 0) {
      warns.push(`${d.incomplete.length} couldn’t be read (no units/price) — not imported/updated: ${d.incomplete.map((u: { isin: string }) => u.isin).join(', ')}`);
    }
    // Completeness: a shortfall vs the statement's equity total means a holding didn't parse.
    const c = d.coverage;
    if (c && c.complete === false) {
      warns.push(
        `⚠ Imported equity ₹${c.importedEquityValue?.toLocaleString('en-IN')} but the statement's equity total is ₹${c.statedEquityTotal?.toLocaleString('en-IN')} — some holdings didn't parse. Don't trust the total until resolved.`,
      );
    } else if (c && c.complete == null) {
      warns.push("Couldn't verify against a statement equity total — review that all holdings imported.");
    }
    if (warns.length) setWarn(warns.join(' · '));
    setPassword('');
    if (fileRef.current) fileRef.current.value = '';
    router.refresh();
  }

  const field =
    'w-full rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-faint outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-weak [color-scheme:dark]';

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-faint">eCAS PDF (CDSL/NSDL)</span>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className={`${field} file:mr-3 file:rounded file:border-0 file:bg-surface file:px-2 file:py-1 file:text-xs file:text-muted`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-faint">PDF password</span>
        <input type="password" autoComplete="off" className={field} placeholder="if protected" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Importing…' : 'Import eCAS'}
      </button>

      <div className="space-y-1 sm:col-span-3">
        {err ? (
          <p className="text-xs text-negative">{err}</p>
        ) : (
          msg && <p className="text-xs text-faint">{msg}</p>
        )}
        {warn && <p className="text-xs text-warning">{warn}</p>}
        {!err && !msg && (
          <p className="text-xs text-faint">
            Stocks only (mutual funds are tracked via the CAS import). Your PDF &amp; password are used
            once on the server — never stored or logged. Imported stocks show value &amp; “as of
            &lt;statement date&gt;” price (not live), and no gain/loss (the eCAS has no cost basis).
            Holdings missing from a statement are flagged, never deleted.
          </p>
        )}
      </div>
    </form>
  );
}
