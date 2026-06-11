import { z } from 'zod';
import { ecasParsedSchema } from './types';
import { mfParsedSchema } from './mf-types';

// The single unified parse: the existing equity (EcasParsed) + MF (MfParsed) shapes the two engines
// already consume, PLUS the row-accounting tally. RAW per-class counts (every ISIN-bearing holding
// row the parser saw, partitioned) — the denominator for the balance guard.
export const rowAccountingSchema = z.object({
  parsedRows: z.number(), // total holding-shaped rows seen (the balance denominator)
  equity: z.number(),
  folioMf: z.number(),
  dematMf: z.number(),
  unrecognized: z.number(),
  skipped: z.number(), // transaction rows etc. — explicitly skipped, never silently dropped
});

export const unifiedParsedSchema = z.object({
  equity: ecasParsedSchema,
  mf: mfParsedSchema,
  rowAccounting: rowAccountingSchema,
});

export type RowAccounting = z.infer<typeof rowAccountingSchema>;
export type UnifiedParsed = z.infer<typeof unifiedParsedSchema>;
