import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withErrorHandling } from '@/lib/handler';
import { runCasParser, CasError, type CasErrorCode } from '@/lib/cas/sidecar';
import { reconcile } from '@/lib/cas/reconcile';
import type { ExistingAsset } from '@/lib/cas/types';

const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15MB — a CAS PDF is well under this

// CasError code → HTTP status. The PDF/password are never logged; failures change nothing in the DB
// (parsing happens before the transaction).
const STATUS: Record<CasErrorCode, number> = {
  PYTHON_MISSING: 501,
  CASPARSER_MISSING: 501,
  BAD_PASSWORD: 400,
  PARSE_ERROR: 422,
  BAD_OUTPUT: 422,
  TIMEOUT: 504,
};

// Import a CAMS/KFintech CAS PDF and reconcile its mutual-fund holdings into WealthAssets. MF only;
// never touches STOCK/OTHER; never deletes (absent holdings are flagged); idempotent on re-upload.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const form = await req.formData();
  const file = form.get('file');
  const password = form.get('password');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'A CAS PDF file is required.' }, { status: 400 });
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
    parsed = await runCasParser(pdf, pwd);
  } catch (err) {
    if (err instanceof CasError) {
      return NextResponse.json({ error: err.message }, { status: STATUS[err.code] });
    }
    throw err; // unexpected → withErrorHandling → 500 (no leak)
  }

  const existing = (await prisma.wealthAsset.findMany()) as unknown as (ExistingAsset & {
    priceUpdatedAt: Date | string | null;
  })[];

  // Reject an OLDER / out-of-order statement. Applying it would silently rewind units & NAVs to
  // stale values AND wrongly flag funds bought since (absent from the older CAS) as "not in latest
  // CAS." Compare the statement date against the newest date we've already imported from a CAS.
  if (parsed.statementDate) {
    const stmt = new Date(parsed.statementDate).getTime();
    const newestImported = Math.max(
      0,
      ...existing
        .filter((a) => a.source === 'CAS' && a.priceUpdatedAt)
        .map((a) => new Date(a.priceUpdatedAt as string | Date).getTime()),
    );
    if (Number.isFinite(stmt) && newestImported > 0 && stmt < newestImported) {
      return NextResponse.json(
        {
          error:
            'This statement is older than your most recent imported CAS. Import the newer statement, or edit holdings manually.',
        },
        { status: 409 },
      );
    }
  }

  const plan = reconcile(existing, parsed);

  await prisma.$transaction(async (tx) => {
    for (const c of plan.creates) await tx.wealthAsset.create({ data: c });
    for (const u of plan.updates) await tx.wealthAsset.update({ where: { id: u.id }, data: u.data });
    for (const f of plan.flaggedAbsent) {
      await tx.wealthAsset.update({ where: { id: f.id }, data: { casStatus: 'ABSENT' } });
    }
  });

  return NextResponse.json({
    created: plan.creates.length,
    updated: plan.updates.length,
    flaggedAbsent: plan.flaggedAbsent.length,
    statementDate: parsed.statementDate ?? null,
  });
});
