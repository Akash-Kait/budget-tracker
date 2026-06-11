// Squarified treemap layout (Bruls, Huizing & van Wijk, 2000) — PURE, no DOM/React, so the
// "area ∝ value" guarantee is unit-testable. Lays `items` (each with a positive `.value`) into the
// rectangle (x, y, w, h) in pixels and returns each item with its {x, y, w, h}. The algorithm greedily
// grows a row along the shorter side while that improves the worst aspect ratio, then fixes the row
// and recurses on the remaining space — keeping tiles close to square so labels stay legible.

export interface TreemapRect<T> {
  item: T;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function squarify<T extends { value: number }>(
  items: T[],
  x: number,
  y: number,
  w: number,
  h: number,
): TreemapRect<T>[] {
  const valid = items.filter((it) => it.value > 0);
  const out: TreemapRect<T>[] = [];
  if (valid.length === 0 || w <= 0 || h <= 0) return out;

  const total = valid.reduce((s, it) => s + it.value, 0);
  const scale = (w * h) / total; // px² per unit value
  const nodes = valid
    .map((it) => ({ it, area: it.value * scale }))
    .sort((a, b) => b.area - a.area); // squarify assumes descending areas

  // Worst (largest) aspect ratio in a row laid along `side`, given the row's tile areas.
  const worst = (areas: number[], side: number): number => {
    const sum = areas.reduce((a, b) => a + b, 0);
    const mx = Math.max(...areas);
    const mn = Math.min(...areas);
    const s2 = sum * sum;
    const side2 = side * side;
    return Math.max((side2 * mx) / s2, s2 / (side2 * mn));
  };

  let rect = { x, y, w, h };
  let row: { it: T; area: number }[] = [];

  const layoutRow = () => {
    const side = Math.min(rect.w, rect.h);
    const rowArea = row.reduce((s, n) => s + n.area, 0);
    const thickness = rowArea / side; // consumed from the longer side
    const wide = rect.w >= rect.h;
    let off = 0;
    for (const n of row) {
      const len = n.area / thickness; // extent along the shorter side
      if (wide) out.push({ item: n.it, x: rect.x, y: rect.y + off, w: thickness, h: len });
      else out.push({ item: n.it, x: rect.x + off, y: rect.y, w: len, h: thickness });
      off += len;
    }
    rect = wide
      ? { x: rect.x + thickness, y: rect.y, w: rect.w - thickness, h: rect.h }
      : { x: rect.x, y: rect.y + thickness, w: rect.w, h: rect.h - thickness };
  };

  for (const node of nodes) {
    const side = Math.min(rect.w, rect.h);
    const cur = row.map((n) => n.area);
    if (row.length === 0 || worst(cur, side) >= worst([...cur, node.area], side)) {
      row.push(node);
    } else {
      layoutRow();
      row = [node];
    }
  }
  if (row.length) layoutRow();
  return out;
}
