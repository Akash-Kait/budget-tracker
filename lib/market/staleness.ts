// Pure price-freshness math. Lives in the market boundary but fetches nothing, so the route
// AND the wealth UI can both ask "is this NAV stale?" without touching the provider. Never
// imported by lib/finance.ts or lib/wealth.ts (firewall) — it's a market-data concern.

/** UTC midnight (ms) of an ISO instant — day-level comparison, locale-independent. */
function utcDayStart(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Business days (Mon–Fri) strictly after `fromIso`, up to and including `toIso`'s day.
 * Holidays are not modelled (MVP) — a holiday only makes us slightly more lenient, never less.
 * Same day → 0; previous weekday → 1.
 */
export function businessDaysBetween(fromIso: string, toIso: string): number {
  const from = utcDayStart(fromIso);
  const to = utcDayStart(toIso);
  if (to <= from) return 0;
  let count = 0;
  const cur = new Date(from);
  while (cur.getTime() < to) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/**
 * A NAV is stale when its as-of date is older than `maxBusinessDays` business days.
 * Default 3 → tolerates a weekend plus a holiday or two before we flag it, but never lets a
 * genuinely old NAV pass as current.
 */
export function isStale(asOfIso: string, nowIso: string, maxBusinessDays = 3): boolean {
  return businessDaysBetween(asOfIso, nowIso) > maxBusinessDays;
}
