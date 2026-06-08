import { describe, it, expect } from 'vitest';
import { formatINR, formatMonth, daysUntil, daysSince } from '@/lib/format';

describe('formatINR', () => {
  it('uses Indian digit grouping with ₹', () => {
    expect(formatINR(420000)).toBe('₹4,20,000');
    expect(formatINR(5400)).toBe('₹5,400');
    expect(formatINR(0)).toBe('₹0');
  });
  it('rounds to whole rupees', () => {
    expect(formatINR(5400.6)).toBe('₹5,401');
  });
});

describe('formatMonth', () => {
  it('formats ISO date as "Mon YYYY"', () => {
    expect(formatMonth('2026-07-15T00:00:00.000Z')).toBe('Jul 2026');
  });
});

describe('daysUntil', () => {
  it('returns whole days from a reference date to a future date', () => {
    expect(daysUntil('2026-06-10T00:00:00.000Z', '2026-06-07T00:00:00.000Z')).toBe(3);
  });
  it('clamps negatives to 0', () => {
    expect(daysUntil('2026-06-01T00:00:00.000Z', '2026-06-07T00:00:00.000Z')).toBe(0);
  });
});

describe('daysSince', () => {
  it('counts whole days elapsed', () => {
    expect(daysSince('2026-06-01T00:00:00.000Z', '2026-06-07T00:00:00.000Z')).toBe(6);
  });
  it('is 0 for same day', () => {
    expect(daysSince('2026-06-07T00:00:00.000Z', '2026-06-07T00:00:00.000Z')).toBe(0);
  });
  it('clamps future dates to 0', () => {
    expect(daysSince('2026-06-10T00:00:00.000Z', '2026-06-07T00:00:00.000Z')).toBe(0);
  });
});
