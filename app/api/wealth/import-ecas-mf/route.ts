import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withErrorHandling } from '@/lib/handler';
import { runEcasMfParser, EcasError, type EcasErrorCode } from '@/lib/ecas/sidecar';
import { planMfImport } from '@/lib/ecas/mf-reconcile';
import { resolveAmfiCodes } from '@/lib/market/amfi';
import { displayNameForType } from '@/lib/wealth';
import type { ExistingMfAsset } from '@/lib/ecas/mf-types';

const MAX_PDF_BYTES = 15 * 1024 * 1024;

const STATUS: Record<EcasErrorCode, number> = {
  PYTHON_MISSING: 501,
  PDFPLUMBER_MISSING: 501,
  BAD_PASSWORD: 400,
  PARSE_ERROR: 422,
  BAD_OUTPUT: 422,
  TIMEOUT: 504,
};

// Import MUTUAL-FUND holdings from the eCAS FOLIO section (page-9 "MUTUAL FUND UNITS HELD AS ON …").
// This is the MF data source (replaces CAMS/KFintech). TWO-PHASE & stateless: the client POSTs the
// same file twice — first to PREVIEW the plan (confirm absent/false), then to APPLY (confirm=true).
// Re-parsing on apply means the applied plan is exactly what was parsed at apply time (no stale token,
// no server-side PDF retention). Folio rows carry cost basis + a document Valuation; MF-only; never
// touches STOCK/OTHER; reconcile-not-replace; flag-absent never delete; idempotent. A migration with
// any unbridged/new fund is BLOCKING (would double-count the 91%-of-portfolio MF holdings) — the
// apply re-checks the block server-side and refuses; the client is never trusted to have honored it.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const form = await req.formData();
  const file = form.get('file');
  const password = form.get('password');
  const confirm = form.get('confirm') === 'true';

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'An eCAS PDF file is required.' }, { status: 400 });
  }
  if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'File must be a PDF.' }, { status: 400 });
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: 'PDF is too large.' }, { status: 413 });
  }
  const pdf = Buffer.from(await file.arrayBuffer());
  const pwd = typeof password === 'string' ? password : '';

  let parsed;
  try {
    parsed = await runEcasMfParser(pdf, pwd);
  } catch (err) {
    if (err instanceof EcasError) {
      return NextResponse.json({ error: err.message }, { status: STATUS[err.code] });
    }
    throw err;
  }

  if (parsed.holdings.length === 0) {
    return NextResponse.json(
      { error: "No mutual funds found in this eCAS (expected the 'MUTUAL FUND UNITS HELD' folio section or demat-held MF units)." },
      { status: 422 },
    );
  }

  // Require a usable statement date — without it the older-statement guard can't run and rows would
  // carry a null "as of" date. Reject rather than import a price wearing no date. [eCAS-stock P1]
  const stmtMs = parsed.statementDate ? new Date(parsed.statementDate).getTime() : NaN;
  if (!Number.isFinite(stmtMs)) {
    return NextResponse.json(
      { error: "Couldn't determine the statement date from this eCAS — not imported." },
      { status: 422 },
    );
  }

  // Coverage anchors must be present when their sub-class is — otherwise a whole class could import
  // un-reconciled (the pure reconcile leaves a null-anchor check as null/non-blocking; the REAL guard
  // that the anchor was actually read belongs here, at the eCAS boundary). [deep-review P1]
  const hasFolio = parsed.holdings.some((h) => (h.section ?? 'folio') === 'folio');
  const hasDemat = parsed.holdings.some((h) => h.section === 'demat');
  if (hasFolio && parsed.grandTotalValuation == null) {
    return NextResponse.json(
      { error: "Couldn't read the folio Grand Total to verify the import — not imported." },
      { status: 422 },
    );
  }
  if (hasDemat && parsed.dematStatedTotal == null) {
    return NextResponse.json(
      { error: "Couldn't read the 'Mutual Funds Held in Demat Form' total to verify the import — not imported." },
      { status: 422 },
    );
  }

  const existing = (await prisma.wealthAsset.findMany()) as unknown as (ExistingMfAsset & {
    priceUpdatedAt: Date | string | null;
    statementDate: Date | string | null;
  })[];

  // Mirror the reconcile's rule: any pre-existing non-ECAS MF row means a bridge/migration is in play.
  const migrationContext = existing.some((a) => a.type === 'MUTUAL_FUND' && a.source !== 'ECAS');

  // Older / out-of-order statement guard. Compare against the newest STATEMENT date previously
  // imported — `statementDate`, NOT `priceUpdatedAt`: a NAV refresh moves priceUpdatedAt to the NAV
  // date, which would make this guard wrongly reject a re-import of the same statement. Rows imported
  // before this column existed carry a null statementDate and are skipped (no false block).
  const newestStmt = Math.max(
    0,
    ...existing
      .filter((a) => a.type === 'MUTUAL_FUND' && a.source === 'ECAS' && a.statementDate)
      .map((a) => new Date(a.statementDate as string | Date).getTime()),
  );
  if (newestStmt > 0 && stmtMs < newestStmt) {
    return NextResponse.json(
      { error: 'This statement is older than your most recent imported eCAS. Import the newer one.' },
      { status: 409 },
    );
  }

  // Resolve ISIN→AMFI code from the LIVE feed for the CAS→eCAS migration bridge (CAS rows key on
  // folio|amfi; folio rows key on folio|ISIN). On a MIGRATION this is mandatory — without it every
  // CAS-backed fund fails the bridge and falsely blocks; if the feed is down we fail safe (503, no
  // writes). On a FIRST import there's nothing to bridge, so proceed with an empty resolver.
  // Clean the ISINs the SAME way the reconcile does before building the bridge map, so the map key and
  // the reconcile's lookup key always agree (a soft-hyphen/lowercase ISIN must resolve, not silently
  // miss → false unmatched-block). resolveAmfi is then called with the reconcile's cleaned ISIN.
  const clean = (s: string) => s.replace(/[\s\u00ad\u200b]/g, '').toUpperCase();
  const isins = parsed.holdings.map((h) => clean(h.isin));
  let amfiMap = new Map<string, string | null>();
  try {
    amfiMap = await resolveAmfiCodes(isins);
  } catch {
    if (migrationContext) {
      return NextResponse.json(
        { error: "Couldn't reach the AMFI NAV feed to match your funds safely. Nothing was changed — try again shortly." },
        { status: 503 },
      );
    }
    // first import: no bridge needed
  }
  const resolveAmfi = (isin: string) => amfiMap.get(clean(isin)) ?? null;

  const plan = planMfImport(existing, parsed, resolveAmfi);

  // Coverage (sum of parsed valuations/invested vs the statement Grand Total) is computed in the pure
  // reconcile and folded into plan.blocked — a shortfall means a folio row silently didn't parse and
  // the import must NOT proceed (it would under-report ~91% of value / mis-flag a fund absent).
  const preview = {
    migrationContext: plan.migrationContext,
    blocked: plan.blocked,
    coverageBlocking: plan.coverageBlocking,
    matched: plan.matched.map((m) => ({
      id: m.id,
      name: m.data.name as string,
      isMigration: m.isMigration,
      costBasisDiscrepancy: m.costBasisDiscrepancy,
    })),
    creates: plan.creates.map((c) => ({
      name: c.name,
      isin: c.ticker,
      value: c.value,
      costBasis: c.costBasis, // null = demat-held (value-only, no gain/loss)
      importKey: c.importKey,
    })),
    unmatchedBlocking: plan.unmatchedBlocking,
    flaggedAbsent: plan.flaggedAbsent,
    valueErrors: plan.valueErrors,
    overlaps: plan.overlaps,
    coverage: plan.coverage,
    statementDate: parsed.statementDate ?? null,
  };

  if (!confirm) {
    return NextResponse.json({ phase: 'preview', ...preview });
  }

  // APPLY — re-validate the block server-side. NEVER trust the client to have honored the preview.
  if (plan.blocked) {
    return NextResponse.json(
      { phase: 'blocked', error: 'This import has unresolved items and cannot be applied. Resolve them and re-import.', ...preview },
      { status: 409 },
    );
  }

  await prisma.$transaction(async (tx) => {
    // displayName (clean chart name) is derived + stored at import; never overwrites `name`.
    for (const c of plan.creates)
      await tx.wealthAsset.create({ data: { ...c, displayName: displayNameForType(c.name, 'MUTUAL_FUND') } });
    for (const m of plan.matched)
      await tx.wealthAsset.update({
        where: { id: m.id },
        data: { ...m.data, displayName: displayNameForType(m.data.name as string, 'MUTUAL_FUND') },
      });
    for (const f of plan.flaggedAbsent) {
      await tx.wealthAsset.update({ where: { id: f.id }, data: { casStatus: 'ABSENT' } });
    }
  });

  return NextResponse.json({
    phase: 'applied',
    created: plan.creates.length,
    updated: plan.matched.length,
    migrated: plan.matched.filter((m) => m.isMigration).length,
    flaggedAbsent: plan.flaggedAbsent.length,
    overlaps: plan.overlaps, // same fund held two ways — stored once (folio), surfaced
    // Surfaced, never auto-applied: a stored (possibly user-adjusted) basis that differs from eCAS.
    discrepancies: plan.matched
      .filter((m) => m.costBasisDiscrepancy)
      .map((m) => ({ name: m.data.name as string, ...m.costBasisDiscrepancy! })),
    coverage: plan.coverage,
    statementDate: parsed.statementDate ?? null,
  });
});
