'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '@/components/hooks/usePrefersReducedMotion';
import { formatINR } from '@/lib/format';
import { squarify } from '@/lib/treemap';

// One holding per tile, area ∝ value (within this type); colour = type (a swappable dimension —
// sizing is fixed on value). HTML tiles (not SVG). On hover the hovered tile ITSELF grows in place:
// it expands FROM ITS OWN EDGE/CORNER nearest the panel boundary (left-column tile grows right/down,
// right-edge tile grows left, bottom tile grows up) so it visibly emanates from where the tile sits —
// the shared edge stays fixed (the transform-origin), the others move out. Neighbours hold position
// (no reflow); the grown tile lifts above them (raised z + shadow), keeps its exact fill, and never
// shrinks below its own size. Growing the box (vs a CSS scale) keeps the name + value crisp. Clamped
// within the panel so it can't overflow.
export interface TreemapLeaf {
  label: string; // clean display name (full legal name lives in the holdings list)
  value: number;
  fill: string;
}

const HEIGHT = 256;
const MIN_W = 190; // readable grown size — fits name + value even for a tiny tile (e.g. City Union ₹270)
const MIN_H = 80;

function contrastText(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length < 6) return '#0b0e14';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#0b0e14' : '#ffffff'; // accessible contrast
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

export function TreemapChart({ items }: { items: TreemapLeaf[] }) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [contentH, setContentH] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // TRUE size-to-content: measure the grown tile's content and set the tile height to it, so the
  // value is never the line that gets clipped (estimates undershoot on long names). +4 for the border.
  useLayoutEffect(() => {
    setContentH(hovered != null && cardRef.current ? cardRef.current.offsetHeight + 4 : 0);
  }, [hovered, width]);

  const hasData = items.some((i) => i.value > 0);
  const rects = width > 0 ? squarify(items, 0, 0, width, HEIGHT) : [];

  return (
    <div ref={ref} className="relative w-full" style={{ height: HEIGHT }} onMouseLeave={() => setHovered(null)}>
      {!hasData && (
        <div className="flex h-full items-center justify-center text-sm text-faint">No holdings to map.</div>
      )}

      {rects.map((r, i) => {
        const { item, x, y, w, h } = r;
        const txt = contrastText(item.fill);
        const isHover = hovered === i;

        let box = { left: x, top: y, w, h };
        if (isHover) {
          // Grow a bit beyond the tile, never below it; reach a readable min; cap to the panel.
          const gw = clamp(Math.max(w * 1.15, MIN_W), MIN_W, width);
          // Height = the MEASURED content height (name + value, no clip); a line estimate seeds the
          // first frame before measurement lands, then `contentH` refines it exactly.
          const estLines = Math.max(1, Math.ceil((item.label.length * 7.5) / Math.max(1, gw - 20)));
          const seed = 24 + estLines * 18 + 26;
          const gh = clamp(Math.max(h, contentH || seed, MIN_H), MIN_H, HEIGHT);
          // Anchor the EDGE nearest the panel boundary (so it grows INWARD from the tile's real spot):
          // left-half tile keeps its left edge & grows right; right-half keeps its right edge & grows
          // left; same vertically. That fixed edge IS the growth origin.
          const left = x + w / 2 < width / 2 ? x : x + w - gw;
          const top = y + h / 2 < HEIGHT / 2 ? y : y + h - gh;
          box = {
            left: clamp(left, 0, Math.max(0, width - gw)),
            top: clamp(top, 0, Math.max(0, HEIGHT - gh)),
            w: gw,
            h: gh,
          };
        }
        const roomy = w > 44 && h > 24;

        return (
          <div
            key={`${item.label}-${i}`}
            onMouseEnter={() => setHovered(i)}
            className={`absolute overflow-hidden border-2 border-bg ${
              isHover ? 'z-30 rounded-lg shadow-2xl' : 'z-0 rounded-[3px]'
            } ${reduced ? '' : 'transition-[left,top,width,height,border-radius,box-shadow] duration-200 ease-out'}`}
            style={{ left: box.left, top: box.top, width: box.w, height: box.h, background: item.fill, color: txt }}
          >
            {isHover ? (
              // Grown tile: ONLY the full name (no clip) + the current value. Measured for its height.
              <div ref={cardRef} className="p-2.5">
                <p className="text-sm font-semibold leading-snug">{item.label}</p>
                <p className="mt-1 font-mono text-base font-bold tabular-nums">{formatINR(item.value)}</p>
              </div>
            ) : (
              roomy && (
                <div className="pointer-events-none p-1.5">
                  <span className="block truncate text-[11px] font-semibold leading-tight">{item.label}</span>
                  <span className="mt-0.5 block font-mono text-[10px] tabular-nums opacity-80">
                    {formatINR(item.value)}
                  </span>
                </div>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
