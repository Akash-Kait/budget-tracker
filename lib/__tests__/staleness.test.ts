import { describe, it, expect } from 'vitest';
import { businessDaysBetween, isStale } from '@/lib/market/staleness';

// Anchor dates (all UTC): 2025-05-14 is a Wednesday.
const WED = '2025-05-14T00:00:00.000Z';

describe('businessDaysBetween', () => {
  it('is 0 on the same day and going backwards', () => {
    expect(businessDaysBetween(WED, '2025-05-14T23:00:00.000Z')).toBe(0);
    expect(businessDaysBetween(WED, '2025-05-10T00:00:00.000Z')).toBe(0);
  });
  it('counts weekdays only, skipping the weekend', () => {
    expect(businessDaysBetween(WED, '2025-05-15T00:00:00.000Z')).toBe(1); // Thu
    expect(businessDaysBetween(WED, '2025-05-16T00:00:00.000Z')).toBe(2); // Fri
    // Sat 17 + Sun 18 add nothing → Mon 19 is the 3rd business day
    expect(businessDaysBetween(WED, '2025-05-19T00:00:00.000Z')).toBe(3);
    expect(businessDaysBetween(WED, '2025-05-20T00:00:00.000Z')).toBe(4); // Tue
  });
});

describe('isStale (default 3 business days)', () => {
  it('is fresh for same-day / next business day', () => {
    expect(isStale(WED, '2025-05-14T18:00:00.000Z')).toBe(false);
    expect(isStale(WED, '2025-05-15T00:00:00.000Z')).toBe(false); // 1 biz day
  });
  it('tolerates a weekend (Fri→Mon is only 1 business day)', () => {
    const fri = '2025-05-16T00:00:00.000Z';
    expect(isStale(fri, '2025-05-19T00:00:00.000Z')).toBe(false);
  });
  it('flags stale past 3 business days', () => {
    expect(isStale(WED, '2025-05-20T00:00:00.000Z')).toBe(true); // 4 biz days
  });
  it('honours a custom threshold', () => {
    expect(isStale(WED, '2025-05-15T00:00:00.000Z', 0)).toBe(true);
  });
});
