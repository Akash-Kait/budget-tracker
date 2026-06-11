import { describe, it, expect } from 'vitest';
import { squarify } from '@/lib/treemap';

const W = 400;
const H = 256;
const area = (r: { w: number; h: number }) => r.w * r.h;

describe('squarify (area ∝ value)', () => {
  const items = [
    { name: 'a', value: 50 },
    { name: 'b', value: 30 },
    { name: 'c', value: 15 },
    { name: 'd', value: 5 },
  ];
  const rects = squarify(items, 0, 0, W, H);

  it('lays out every positive-value item', () => {
    expect(rects).toHaveLength(4);
    expect(rects.map((r) => r.item.name).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it("each tile's area is proportional to its value (±1%)", () => {
    const totalValue = items.reduce((s, i) => s + i.value, 0);
    const totalArea = W * H;
    for (const r of rects) {
      const expected = (r.item.value / totalValue) * totalArea;
      expect(Math.abs(area(r) - expected) / expected).toBeLessThan(0.01);
    }
  });

  it('tiles cover the container area with no material gap/overlap (±0.5%)', () => {
    const covered = rects.reduce((s, r) => s + area(r), 0);
    expect(Math.abs(covered - W * H) / (W * H)).toBeLessThan(0.005);
  });

  it('every tile is within the container bounds', () => {
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-0.001);
      expect(r.y).toBeGreaterThanOrEqual(-0.001);
      expect(r.x + r.w).toBeLessThanOrEqual(W + 0.001);
      expect(r.y + r.h).toBeLessThanOrEqual(H + 0.001);
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
    }
  });

  it('a single item fills the whole rectangle', () => {
    const [only] = squarify([{ name: 'x', value: 1 }], 0, 0, W, H);
    expect(only).toMatchObject({ x: 0, y: 0, w: W, h: H });
  });

  it('drops zero/negative-value items and is safe on empty / zero-size input', () => {
    expect(squarify([{ name: 'z', value: 0 }], 0, 0, W, H)).toEqual([]);
    expect(squarify([{ name: 'a', value: 5 }], 0, 0, 0, H)).toEqual([]);
    expect(squarify([], 0, 0, W, H)).toEqual([]);
    const mixed = squarify([{ name: 'a', value: 10 }, { name: 'z', value: 0 }], 0, 0, W, H);
    expect(mixed).toHaveLength(1);
    expect(area(mixed[0])).toBeCloseTo(W * H, 5); // the single positive item fills it
  });
});
