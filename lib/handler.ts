import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';

// Loose handler signature: Next.js route handlers vary (GET(), POST(req), GET(req, {params})).
type RouteHandler = (...args: never[]) => Promise<Response>;

/**
 * Wraps a route handler so failures become controlled responses instead of an
 * uncontrolled 500 (which leaks a stack trace in dev). Maps:
 *   - malformed JSON body (SyntaxError from req.json()) -> 400
 *   - ZodError                                          -> 400
 *   - Prisma P2025 (record not found)                   -> 404
 *   - Prisma P2002 (unique constraint)                  -> 409
 *   - anything else                                     -> 500 (logged server-side only)
 */
export function withErrorHandling<H extends RouteHandler>(handler: H): H {
  return (async (...args: Parameters<H>) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof SyntaxError) {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
      }
      if (err instanceof ZodError) {
        return NextResponse.json({ errors: err.flatten() }, { status: 400 });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return NextResponse.json({ error: 'Not found' }, { status: 404 });
        if (err.code === 'P2002') return NextResponse.json({ error: 'Already exists' }, { status: 409 });
      }
      console.error('[api] unhandled error:', err);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  }) as H;
}
