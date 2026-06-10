'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const inr = (n: number | null | undefined) =>
  n == null ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

type Discrepancy = { stored: number; statement: number };
type Preview = {
  phase: string;
  migrationContext: boolean;
  blocked: boolean;
  coverageBlocking: boolean;
  matched: { id: string; name: string; isMigration: boolean; costBasisDiscrepancy: Discrepancy | null }[];
  creates: { name: string; isin: string; value: number | null; costBasis: number | null; importKey: string }[];
  unmatchedBlocking: { isin: string; name: string; folio: string; reason: string }[];
  flaggedAbsent: { id: string; name: string }[];
  valueErrors: { isin: string; name: string; unitsTimesNav: number; valuation: number }[];
  overlaps: { isin: string; name: string; folioValue: number | null; dematValueDropped: number | null }[];
  coverage: {
    folioParsed: number; folioStated: number | null; folioMatches: boolean | null;
    dematParsed: number; dematStated: number | null; dematMatches: boolean | null;
    investedParsed: number; investedStated: number | null; investedMatches: boolean | null;
    overlapDropped: number; storedTotal: number; expectedTotal: number | null; totalMatches: boolean | null;
  };
  statementDate: string | null;
};

// Import mutual funds from the eCAS FOLIO section — the MF data source. TWO-PHASE: Preview shows a
// blocking plan (matched / new / unmatched-blocking / value errors / cost-basis discrepancies +
// a Grand-Total coverage check); Confirm applies it. A migration that can't fully bridge is BLOCKED
// (it would double-count your funds). The PDF + password are sent each phase, used server-side once,
// never stored. Folio MFs carry cost basis (so they show gain/loss); AMFI keeps NAV fresh afterward.
export function EcasMfImportPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const fileSnap = useRef<File | null>(null); // captured at preview so Confirm re-sends the same file
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
    const res = await fetch('/api/wealth/import-ecas-mf', { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
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
    const { ok, data } = await post(file, false);
    setBusy(false);
    if (!ok) {
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
    const { ok, data } = await post(file, true);
    setBusy(false);
    if (!ok) {
      setErr(data.error ?? 'Import failed.');
      // Blocked → refresh the blocking detail in place; any other failure (e.g. feed dropped, a newer
      // statement now exists) means the preview is stale → clear it so the user must re-preview.
      setPreview(data.phase === 'blocked' ? (data as Preview) : null);
      return;
    }
    const parts = [`Imported ${data.created} new`, `updated ${data.updated}`];
    if (data.migrated) parts.push(`${data.migrated} migrated from CAS`);
    if (data.flaggedAbsent) parts.push(`${data.flaggedAbsent} not in this statement`);
    setMsg(`${parts.join(' · ')}${data.statementDate ? ` (as of ${data.statementDate.slice(0, 10)})` : ''}.`);
    reset();
    router.refresh();
  }

  const field =
    'w-full rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-faint outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-weak [color-scheme:dark]';
  const c = preview?.coverage;

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
          {busy && !preview ? 'Reading…' : 'Preview import'}
        </button>
      </form>

      {err && <p className="text-xs text-negative">{err}</p>}
      {msg && <p className="text-xs text-positive">{msg}</p>}

      {preview && (
        <div className="space-y-3 rounded-lg border border-hairline bg-surface-2 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span className="font-medium text-text">
              {preview.migrationContext ? 'Migration from CAS' : 'First MF import'}
            </span>
            {preview.statementDate && <span>as of {preview.statementDate.slice(0, 10)}</span>}
            <span>{preview.matched.length} matched · {preview.creates.length} new · {preview.flaggedAbsent.length} absent</span>
          </div>

          {/* Coverage — each MF sub-class must tie to its OWN stated bucket, and the stored total to
              folio+demat−overlap. A miss BLOCKS (a holding silently didn't parse, or an overlap shrank
              the total) — no sub-class can vanish unflagged. */}
          {c && (
            <div className={`space-y-0.5 rounded border p-2 text-xs ${preview.coverageBlocking ? 'border-negative/40 bg-negative/10 text-negative' : 'border-hairline text-faint'}`}>
              {preview.coverageBlocking && <p className="font-medium">⚠ Coverage mismatch — a holding didn’t parse / overlap shrank the total. Import blocked so it can’t silently under-report.</p>}
              <p>Folio MF: parsed {inr(c.folioParsed)} vs stated {inr(c.folioStated)}{c.folioMatches === true && ' ✓'}{c.folioMatches === false && ' ✗'}</p>
              <p>Demat-held MF: parsed {inr(c.dematParsed)} vs stated {inr(c.dematStated)}{c.dematMatches === true && ' ✓'}{c.dematMatches === false && ' ✗'}</p>
              <p>Stored total: {inr(c.storedTotal)} vs expected {inr(c.expectedTotal)}{c.totalMatches === true && ' ✓'}{c.totalMatches === false && ' ✗'}{c.overlapDropped > 0 && ` (overlap −${inr(c.overlapDropped)})`}</p>
            </div>
          )}

          {/* Overlap — same fund held two ways; stored ONCE (folio, with basis), never silently merged. */}
          {preview.overlaps.length > 0 && (
            <div className="space-y-1 rounded border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
              <p className="font-medium">{preview.overlaps.length} fund(s) held both in a folio AND in demat — kept once (folio, with cost basis); the demat copy isn’t added again:</p>
              <ul className="ml-3 list-disc">
                {preview.overlaps.map((o) => (
                  <li key={o.isin}>{o.name} ({o.isin}) — folio {inr(o.folioValue)}, demat {inr(o.dematValueDropped)} dropped</li>
                ))}
              </ul>
            </div>
          )}

          {/* BLOCKING — unmatched on a migration (would double-count) + value parse errors */}
          {preview.unmatchedBlocking.length > 0 && (
            <div className="space-y-1 rounded border border-negative/40 bg-negative/10 p-2 text-xs text-negative">
              <p className="font-medium">⚠ {preview.unmatchedBlocking.length} folio holding(s) couldn’t be safely matched — import is blocked (auto-creating them could double-count existing funds):</p>
              <ul className="ml-3 list-disc">
                {preview.unmatchedBlocking.map((u) => (
                  <li key={u.isin + u.folio}>{u.name} ({u.isin}, folio {u.folio}) — {u.reason}</li>
                ))}
              </ul>
            </div>
          )}
          {preview.valueErrors.length > 0 && (
            <div className="space-y-1 rounded border border-negative/40 bg-negative/10 p-2 text-xs text-negative">
              <p className="font-medium">⚠ {preview.valueErrors.length} holding(s) failed the units×NAV vs Valuation check — import is blocked:</p>
              <ul className="ml-3 list-disc">
                {preview.valueErrors.map((v) => (
                  <li key={v.isin}>{v.name}: units×NAV {inr(v.unitsTimesNav)} ≠ Valuation {inr(v.valuation)}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Cost-basis discrepancies — surfaced, NOT auto-applied (a stored basis may be user-adjusted) */}
          {preview.matched.some((m) => m.costBasisDiscrepancy) && (
            <div className="space-y-1 rounded border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
              <p className="font-medium">Cost-basis differences (your stored value is kept — not overwritten):</p>
              <ul className="ml-3 list-disc">
                {preview.matched.filter((m) => m.costBasisDiscrepancy).map((m) => (
                  <li key={m.id}>{m.name}: stored {inr(m.costBasisDiscrepancy!.stored)} vs eCAS {inr(m.costBasisDiscrepancy!.statement)}</li>
                ))}
              </ul>
            </div>
          )}

          {preview.creates.length > 0 && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer text-faint">{preview.creates.length} new fund(s) to add</summary>
              <ul className="ml-3 mt-1 list-disc">
                {preview.creates.map((cr) => (
                  <li key={cr.importKey}>
                    {cr.name} — {inr(cr.value)} {cr.costBasis == null ? '(demat-held · value-only, no gain/loss)' : `(invested ${inr(cr.costBasis)})`}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              disabled={busy || preview.blocked}
              onClick={doConfirm}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              title={preview.blocked ? 'Resolve the blocking items first' : undefined}
            >
              {busy ? 'Importing…' : preview.blocked ? 'Blocked — resolve above' : 'Confirm import'}
            </button>
            <button type="button" onClick={reset} className="text-xs text-faint hover:text-muted">
              Cancel
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-faint">
        All your mutual funds, from the eCAS — folio holdings (with cost basis → gain/loss) and units
        held in demat form (value-only, no cost basis in the statement, so no gain/loss). Your PDF &amp;
        password are used once on the server — never stored or logged. NAV stays fresh via the daily
        AMFI feed. Funds missing from a statement are flagged, never deleted.
      </p>
    </div>
  );
}
