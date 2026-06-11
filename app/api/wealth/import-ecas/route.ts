import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withErrorHandling } from '@/lib/handler';
import { runEcasParser, EcasError, type EcasErrorCode } from '@/lib/ecas/sidecar';
import { reconcile } from '@/lib/ecas/reconcile';
import { displayNameForType } from '@/lib/wealth';
import type { ExistingStockAsset } from '@/lib/ecas/types';

const MAX_PDF_BYTES = 15 * 1024 * 1024;

const STATUS: Record<EcasErrorCode, number> = {
  PYTHON_MISSING: 501,
  PDFPLUMBER_MISSING: 501,
  BAD_PASSWORD: 400,
  PARSE_ERROR: 422,
  BAD_OUTPUT: 422,
  TIMEOUT: 504,
};

// Import STOCK holdings from a CDSL/NSDL eCAS PDF (Phase 1: manual upload). Stocks-only; never
// touches MF/other; reconcile-not-replace; flag-absent never delete; idempotent. Failures change
// nothing (parse precedes the transaction).
export const POST = withErrorHandling(async (req: NextRequest) => {
  const form = await req.formData();
  const file = form.get('file');
  const password = form.get('password');

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
    parsed = await runEcasParser(pdf, pwd);
  } catch (err) {
    if (err instanceof EcasError) {
      return NextResponse.json({ error: err.message }, { status: STATUS[err.code] });
    }
    throw err;
  }

  const existing = (await prisma.wealthAsset.findMany()) as unknown as (ExistingStockAsset & {
    priceUpdatedAt: Date | string | null;
  })[];

  // Require a usable statement date. Without one we can't run the older-statement guard below, so a
  // dateless import could silently rewind quantities and mis-flag holdings, and rows would carry a
  // null "as of" date. Reject rather than import blind. [deep-review P1]
  const stmt = parsed.statementDate ? new Date(parsed.statementDate).getTime() : NaN;
  if (!Number.isFinite(stmt)) {
    return NextResponse.json(
      { error: "Couldn't determine the statement date from this eCAS — not imported." },
      { status: 422 },
    );
  }

  // Older / out-of-order statement guard (mirror CAS P0): applying an older statement would rewind
  // quantities and wrongly flag still-held stocks absent. Compare against the newest eCAS date stored.
  const newestImported = Math.max(
    0,
    ...existing
      .filter((a) => a.source === 'ECAS' && a.priceUpdatedAt)
      .map((a) => new Date(a.priceUpdatedAt as string | Date).getTime()),
  );
  if (newestImported > 0 && stmt < newestImported) {
    return NextResponse.json(
      { error: 'This statement is older than your most recent imported eCAS. Import the newer one.' },
      { status: 409 },
    );
  }

  const plan = reconcile(existing, parsed);

  await prisma.$transaction(async (tx) => {
    // displayName (clean chart name) is derived + stored at import; never overwrites `name`.
    for (const c of plan.creates)
      await tx.wealthAsset.create({ data: { ...c, displayName: displayNameForType(c.name, 'STOCK') } });
    for (const u of plan.updates)
      await tx.wealthAsset.update({
        where: { id: u.id },
        // Only (re)derive displayName when this update carries a name (eCAS-sourced rows); an adopted
        // manual row keeps its own name → leave its displayName for the read-time backfill.
        data: typeof u.data.name === 'string'
          ? { ...u.data, displayName: displayNameForType(u.data.name, 'STOCK') }
          : u.data,
      });
    for (const f of plan.flaggedAbsent) {
      await tx.wealthAsset.update({ where: { id: f.id }, data: { casStatus: 'ABSENT' } });
    }
  });

  // Completeness check: the value we actually imported (qty×price across every equity row this run)
  // vs the statement's stated Equity total. A shortfall means a holding silently didn't parse — make
  // it VISIBLE rather than let the total quietly under-report. [live-run issue 2]
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  const imported =
    plan.creates.reduce((s, c) => s + num(c.quantity) * num(c.pricePerUnit), 0) +
    plan.updates.reduce((s, u) => s + num(u.data.quantity) * num(u.data.pricePerUnit), 0);
  const importedEquityValue = Math.round(imported * 100) / 100;
  const stated = parsed.equityStatedTotal ?? null;
  const coverage = {
    statedEquityTotal: stated,
    importedEquityValue,
    // null = couldn't read a statement total to verify against; true/false = matches within tolerance.
    complete: stated == null ? null : Math.abs(importedEquityValue - stated) <= Math.max(1, stated * 0.005),
  };

  return NextResponse.json({
    created: plan.creates.length,
    updated: plan.updates.length,
    flaggedAbsent: plan.flaggedAbsent.length,
    unrecognized: parsed.unrecognized, // ISINs neither equity nor MF — surfaced, not dropped (Q7)
    incomplete: plan.incomplete, // present but unreadable (no units/price) — surfaced, not silent (GAP)
    coverage, // imported-vs-stated equity total — surfaces a silently-dropped holding
    statementDate: parsed.statementDate ?? null,
  });
});
