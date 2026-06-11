'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const inr = (n: number | null | undefined) =>
  n == null ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const ok = (m: boolean | null) => (m === true ? '✓' : m === false ? '✗' : '');

type Preview = {
  phase: string;
  statementDate: string | null;
  blocked: boolean;
  rowAccounting: { parsedRows: number; equity: number; folioMf: number; dematMf: number; unrecognized: number; skipped: number };
  balance: { parsedRows: number; accountedRows: number; ok: boolean };
  olderStatement: { blocked: boolean; reason: string | null };
  equity: {
    created: number; updated: number; flaggedAbsent: number;
    incomplete: { isin: string; name: string }[];
    coverage: { statedEquityTotal: number | null; importedEquityValue: number; complete: boolean | null };
  };
  mf: {
    created: number; matched: number; flaggedAbsent: number;
    unmatchedBlocking: { isin: string; name: string; folio: string; reason: string }[];
    valueErrors: { isin: string; name: string; unitsTimesNav: number; valuation: number }[];
    overlaps: { isin: string; name: string }[];
    coverage: {
      folioParsed: number; folioStated: number | null; folioMatches: boolean | null;
      dematParsed: number; dematStated: number | null; dematMatches: boolean | null;
      storedTotal: number; expectedTotal: number | null; totalMatches: boolean | null;
    };
    coverageBlocking: boolean;
    discrepancies: { name: string; stored: number; statement: number }[];
  };
  unrecognized: { isin: string; name: string }[];
};

// ONE "Import from eCAS" entry: one upload → one preview (all three holding groups + every coverage
// check + the row-accounting balance) → one atomic confirm. Supersedes the separate stock/MF panels.
export function EcasUnifiedImportPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const fileSnap = useRef<File | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setPreview(null);
    setPassword('');
    fileSnap.current = null;
    if (fileRef.current) fileRef.current.value = '';
  }

  async function post(file: File, confirm: boolean) {
    const body = new FormData();
    body.append('file', file);
    body.append('password', password);
    if (confirm) body.append('confirm', 'true');
    const res = await fetch('/api/wealth/import-ecas-unified', { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  async function doPreview(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setPreview(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setErr('Choose your eCAS PDF first.');
      return;
    }
    setBusy(true);
    const { ok: good, data } = await post(file, false);
    setBusy(false);
    if (!good) {
      setErr(data.error ?? 'Preview failed.');
      return;
    }
    fileSnap.current = file;
    setPreview(data as Preview);
  }

  async function doConfirm() {
    const file = fileSnap.current;
    if (!file) {
      setErr('Re-select your eCAS PDF and preview again.');
      return;
    }
    setBusy(true);
    setErr(null);
    const { ok: good, data } = await post(file, true);
    setBusy(false);
    if (!good) {
      setErr(data.error ?? 'Import failed.');
      setPreview(data.phase === 'blocked' ? (data as Preview) : null);
      return;
    }
    const parts = [`${data.equity.created + data.mf.created} new`, `${data.equity.updated + data.mf.updated} updated`];
    if (data.mf.migrated) parts.push(`${data.mf.migrated} migrated`);
    setMsg(`Imported ${parts.join(' · ')}${data.statementDate ? ` (as of ${data.statementDate.slice(0, 10)})` : ''}.`);
    reset();
    router.refresh();
  }

  const field =
    'w-full rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-faint outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-weak [color-scheme:dark]';
  const p = preview;

  return (
    <div className="space-y-4">
      <form onSubmit={doPreview} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-faint">eCAS PDF (CDSL/NSDL)</span>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={() => setPreview(null)} className={`${field} file:mr-3 file:rounded file:border-0 file:bg-surface file:px-2 file:py-1 file:text-xs file:text-muted`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-faint">PDF password</span>
          <input type="password" autoComplete="off" className={field} placeholder="if protected" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit" disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50">
          {busy && !p ? 'Reading…' : 'Preview import'}
        </button>
      </form>

      {err && <p className="text-xs text-negative">{err}</p>}
      {msg && <p className="text-xs text-positive">{msg}</p>}

      {p && (
        <div className="space-y-3 rounded-lg border border-hairline bg-surface-2 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            {p.statementDate && <span className="font-medium text-text">as of {p.statementDate.slice(0, 10)}</span>}
            <span>Stocks: {p.equity.created} new · {p.equity.updated} upd · {p.equity.flaggedAbsent} absent</span>
            <span>MFs: {p.mf.created} new · {p.mf.matched} matched · {p.mf.flaggedAbsent} absent</span>
          </div>

          {/* Row-accounting balance */}
          <div className={`text-xs ${p.balance.ok ? 'text-faint' : 'text-negative'}`}>
            Row accounting: {p.rowAccounting.parsedRows} parsed = {p.rowAccounting.equity} equity + {p.rowAccounting.folioMf} folio-MF + {p.rowAccounting.dematMf} demat-MF + {p.rowAccounting.unrecognized} unrecognized + {p.rowAccounting.skipped} skipped {p.balance.ok ? '✓' : '✗ — a row fell through; import blocked'}
          </div>

          {/* Coverage — all must tie */}
          <div className={`space-y-0.5 rounded border p-2 text-xs ${(p.equity.coverage.complete === false || p.mf.coverageBlocking) ? 'border-negative/40 bg-negative/10 text-negative' : 'border-hairline text-faint'}`}>
            <p>Equity: imported {inr(p.equity.coverage.importedEquityValue)} vs stated {inr(p.equity.coverage.statedEquityTotal)} {ok(p.equity.coverage.complete)}</p>
            <p>Folio MF: {inr(p.mf.coverage.folioParsed)} vs {inr(p.mf.coverage.folioStated)} {ok(p.mf.coverage.folioMatches)} · Demat MF: {inr(p.mf.coverage.dematParsed)} vs {inr(p.mf.coverage.dematStated)} {ok(p.mf.coverage.dematMatches)}</p>
            <p>MF stored total {inr(p.mf.coverage.storedTotal)} vs {inr(p.mf.coverage.expectedTotal)} {ok(p.mf.coverage.totalMatches)}</p>
          </div>

          {p.olderStatement.blocked && <p className="rounded border border-negative/40 bg-negative/10 p-2 text-xs text-negative">⚠ {p.olderStatement.reason}</p>}

          {p.mf.unmatchedBlocking.length > 0 && (
            <div className="rounded border border-negative/40 bg-negative/10 p-2 text-xs text-negative">
              ⚠ {p.mf.unmatchedBlocking.length} MF holding(s) couldn’t be matched: {p.mf.unmatchedBlocking.map((u) => `${u.name} (${u.isin})`).join(', ')}
            </div>
          )}
          {p.mf.valueErrors.length > 0 && (
            <div className="rounded border border-negative/40 bg-negative/10 p-2 text-xs text-negative">⚠ {p.mf.valueErrors.length} MF holding(s) failed the units×NAV check.</div>
          )}
          {p.mf.overlaps.length > 0 && (
            <p className="text-xs text-warning">{p.mf.overlaps.length} fund(s) held both folio + demat — kept once (folio).</p>
          )}
          {p.mf.discrepancies.length > 0 && (
            <div className="text-xs text-warning">Cost-basis differences kept (not overwritten): {p.mf.discrepancies.map((d) => `${d.name} (stored ${inr(d.stored)} vs ${inr(d.statement)})`).join('; ')}</div>
          )}
          {p.unrecognized.length > 0 && (
            <p className="text-xs text-faint">{p.unrecognized.length} unrecognized — not imported: {p.unrecognized.map((u) => u.isin).join(', ')}</p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button type="button" disabled={busy || p.blocked} onClick={doConfirm} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
              {busy ? 'Importing…' : p.blocked ? 'Blocked — resolve above' : 'Confirm import'}
            </button>
            <button type="button" onClick={reset} className="text-xs text-faint hover:text-muted">Cancel</button>
          </div>
        </div>
      )}

      <p className="text-xs text-faint">
        One upload imports everything from your eCAS — stocks and mutual funds (folio with cost basis +
        demat-held value-only) — in a single atomic confirm. Your PDF &amp; password are used once on the
        server, never stored. Coverage and row-accounting checks must pass before anything is written.
      </p>
    </div>
  );
}
