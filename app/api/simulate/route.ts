import { NextRequest, NextResponse } from 'next/server';
import { simulateSchema } from '@/lib/validation';
import { simulatePurchase } from '@/lib/finance';
import { getProfile, getItems } from '@/lib/data';
import { withErrorHandling } from '@/lib/handler';

export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json();
  const parsed = simulateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });

  const profile = await getProfile();
  const items = await getItems();

  const result = simulatePurchase(profile, items, parsed.data.cost);
  return NextResponse.json({ name: parsed.data.name ?? null, ...result });
});
