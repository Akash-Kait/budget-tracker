import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withErrorHandling } from '@/lib/handler';
import { runEcasUnifiedParser, EcasError, type EcasErrorCode } from '@/lib/ecas/sidecar';
import { planUnifiedImport, type UnifiedExisting } from '@/lib/ecas/unified-reconcile';
import { resolveAmfiCodes } from '@/lib/market/amfi';
import { displayNameForType } from '@/lib/wealth';

const MAX_PDF_BYTES = 15 * 1024 * 1024;

const STATUS: Record<EcasErrorCode, number> = {
  PYTHON_MISSING: 501,
  PDFPLUMBER_MISSING: 501,
  BAD_PASSWORD: 400,
  PARSE_ERROR: 422,
  BAD_OUTPUT: 422,
  TIMEOUT: 504,
};

// UNIFIED eCAS import: ONE upload → ONE parse → fan out to the two UNCHANGED engines → ONE combined
// preview → ONE atomic confirm. Two-phase & stateless (same file re-sent on confirm; re-parsed +
// re-guarded server-side). Guards (row-accounting balance, equity + MF coverage, both older-statement
// guards) run BEFORE the transaction — if any blocks, ZERO writes are attempted (no txn opened). The
// confirm applies stocks + folio MFs + demat MFs through ONE shared `tx` handle: any failure in any
// sub-part rolls back EVERYTHING. PDF + password server-side/in-memory/stdin only; never logged.
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
    parsed = await runEcasUnifiedParser(pdf, pwd);
  } catch (err) {
    if (err instanceof EcasError) return NextResponse.json({ error: err.message }, { status: STATUS[err.code] });
    throw err;
  }

  const ra = parsed.rowAccounting;
  if (ra.parsedRows === 0) {
    return NextResponse.json({ error: 'No holdings found in this eCAS.' }, { status: 422 });
  }

  // Require a usable statement date (older-statement guard + honest "as of" dates).
  const stmtIso = parsed.equity.statementDate ?? parsed.mf.statementDate ?? null;
  if (!stmtIso || !Number.isFinite(new Date(stmtIso).getTime())) {
    return NextResponse.json({ error: "Couldn't determine the statement date from this eCAS — not imported." }, { status: 422 });
  }

  // Coverage anchors must be present when their sub-class is — else a class could import un-reconciled.
  if (ra.equity > 0 && parsed.equity.equityStatedTotal == null) {
    return NextResponse.json({ error: "Couldn't read the stated Equity total to verify the import — not imported." }, { status: 422 });
  }
  if (ra.folioMf > 0 && parsed.mf.grandTotalValuation == null) {
    return NextResponse.json({ error: "Couldn't read the folio Grand Total to verify the import — not imported." }, { status: 422 });
  }
  if (ra.dematMf > 0 && parsed.mf.dematStatedTotal == null) {
    return NextResponse.json({ error: "Couldn't read the 'Mutual Funds Held in Demat Form' total — not imported." }, { status: 422 });
  }

  // Read outside the txn (single-user MVP). A concurrent mutation between this read and the apply txn
  // is not serialized; Prisma surfaces a P2002/P2025 cleanly (the txn rolls back) rather than corrupt.
  const existing = (await prisma.wealthAsset.findMany()) as unknown as UnifiedExisting[];

  // ISIN→AMFI feed resolve for the MF migration bridge. Mandatory on a migration (any non-ECAS MF row);
  // fail safe (503, no writes) if the feed is down. Clean the ISINs the same way the reconcile does.
  const migrationContext = existing.some((a) => a.type === 'MUTUAL_FUND' && a.source !== 'ECAS');
  const clean = (s: string) => s.replace(/[\s\u00ad\u200b]/g, '').toUpperCase();
  let amfiMap = new Map<string, string | null>();
  try {
    amfiMap = await resolveAmfiCodes(parsed.mf.holdings.map((h) => clean(h.isin)));
  } catch {
    if (migrationContext) {
      return NextResponse.json(
        { error: "Couldn't reach the AMFI NAV feed to match your funds safely. Nothing was changed — try again shortly." },
        { status: 503 },
      );
    }
  }
  const resolveAmfi = (isin: string) => amfiMap.get(clean(isin)) ?? null;

  // Compute ALL plans + run ALL guards (pure). NO writes here.
  const plan = planUnifiedImport(existing, parsed, resolveAmfi);

  const preview = {
    statementDate: stmtIso,
    rowAccounting: ra,
    balance: plan.balance,
    blocked: plan.blocked,
    olderStatement: plan.olderStatement,
    equity: {
      created: plan.stock.creates.length,
      updated: plan.stock.updates.length,
      flaggedAbsent: plan.stock.flaggedAbsent.length,
      incomplete: plan.stock.incomplete,
      coverage: plan.equityCoverage,
    },
    mf: {
      created: plan.mf.creates.length,
      matched: plan.mf.matched.length,
      flaggedAbsent: plan.mf.flaggedAbsent.length,
      unmatchedBlocking: plan.mf.unmatchedBlocking,
      valueErrors: plan.mf.valueErrors,
      overlaps: plan.mf.overlaps,
      coverage: plan.mf.coverage,
      coverageBlocking: plan.mf.coverageBlocking,
      discrepancies: plan.mf.matched.filter((m) => m.costBasisDiscrepancy).map((m) => ({ name: m.data.name as string, ...m.costBasisDiscrepancy! })),
    },
    unrecognized: parsed.equity.unrecognized,
  };

  if (!confirm) {
    return NextResponse.json({ phase: 'preview', ...preview });
  }

  // APPLY — re-validate the AND-gate server-side; the client is never trusted. Guard failure here means
  // NO transaction is opened (zero writes attempted) — distinct from a write failure (rollback).
  if (plan.blocked) {
    return NextResponse.json(
      { phase: 'blocked', error: 'This import has unresolved items and cannot be applied. Resolve them and re-import.', ...preview },
      { status: 409 },
    );
  }

  // ONE transaction spanning BOTH domains, via a SINGLE shared `tx` handle. A failure in ANY sub-part
  // (stock OR folio-MF OR demat-MF write) rolls the WHOLE thing back — no partial-success possible.
  await prisma.$transaction(async (tx) => {
    // Stocks
    for (const c of plan.stock.creates)
      await tx.wealthAsset.create({ data: { ...c, displayName: displayNameForType(c.name, 'STOCK') } });
    for (const u of plan.stock.updates)
      await tx.wealthAsset.update({
        where: { id: u.id },
        data: typeof u.data.name === 'string' ? { ...u.data, displayName: displayNameForType(u.data.name, 'STOCK') } : u.data,
      });
    for (const f of plan.stock.flaggedAbsent)
      await tx.wealthAsset.update({ where: { id: f.id }, data: { casStatus: 'ABSENT' } });
    // Mutual funds (folio + demat — same engine, same tx)
    for (const c of plan.mf.creates)
      await tx.wealthAsset.create({ data: { ...c, displayName: displayNameForType(c.name, 'MUTUAL_FUND') } });
    for (const m of plan.mf.matched)
      await tx.wealthAsset.update({
        where: { id: m.id },
        data: { ...m.data, displayName: displayNameForType(m.data.name as string, 'MUTUAL_FUND') },
      });
    for (const f of plan.mf.flaggedAbsent)
      await tx.wealthAsset.update({ where: { id: f.id }, data: { casStatus: 'ABSENT' } });
  });

  return NextResponse.json({
    phase: 'applied',
    statementDate: stmtIso,
    rowAccounting: ra,
    equity: { created: plan.stock.creates.length, updated: plan.stock.updates.length, flaggedAbsent: plan.stock.flaggedAbsent.length },
    mf: {
      created: plan.mf.creates.length,
      updated: plan.mf.matched.length,
      migrated: plan.mf.matched.filter((m) => m.isMigration).length,
      flaggedAbsent: plan.mf.flaggedAbsent.length,
    },
    unrecognized: parsed.equity.unrecognized,
  });
});
