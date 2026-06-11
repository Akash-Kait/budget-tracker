'use client';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { usePrefersReducedMotion } from '@/components/hooks/usePrefersReducedMotion';
import { formatINR } from '@/lib/format';

// "What do I hold and how big" — one rectangle per holding, area ∝ current value, grouped by asset
// type (nesting clusters same-type holdings) and COLOURED by type. ALL holdings appear (no cost basis
// needed). Colour is a SWAPPABLE dimension: value-sizing is fixed, so a future gain/loss colour mode
// would only change each leaf's `fill` — the structure here doesn't preclude it.
// Index signatures: recharts' TreemapDataType is an open record, so the node shapes need one to be
// assignable to the `data` prop. The named fields are what this component actually reads.
export interface TreemapLeaf {
  name: string;
  value: number;
  fill: string; // type colour today; could become a gain/loss colour later
  [key: string]: unknown;
}
export interface TreemapGroup {
  name: string;
  children: TreemapLeaf[];
  [key: string]: unknown;
}
export interface TreemapLegendItem {
  label: string;
  color: string;
  value: number;
}

// Dark text on light cells, white on dark — keeps labels legible on any type colour (accessibility).
function contrastText(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length < 6) return '#0b0e14';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#0b0e14' : '#ffffff';
}

// recharts clones this per node with the node's props. Only LEAVES carry a `fill` (groups/root don't),
// so `fill` is the leaf discriminator — robust to recharts' depth numbering. Groups render nothing;
// their children tile the region, so the colour clustering shows the type split.
function TreeCell(props: {
  x?: number; y?: number; width?: number; height?: number; name?: string; value?: number;
  fill?: string; payload?: { fill?: string; name?: string; value?: number };
}) {
  const { x = 0, y = 0, width = 0, height = 0 } = props;
  // recharts may expose node fields directly or nested under `payload` depending on version — read
  // both so a leaf never silently renders blank.
  const fill = props.fill ?? props.payload?.fill;
  const name = props.name ?? props.payload?.name ?? '';
  const value = props.value ?? props.payload?.value ?? 0;
  if (!fill || width <= 0 || height <= 0) return <g />;
  const txt = contrastText(fill);
  const charsThatFit = Math.floor((width - 10) / 6.2);
  const showName = width > 36 && height > 16 && charsThatFit >= 3;
  const label = showName
    ? name.length > charsThatFit
      ? `${name.slice(0, Math.max(1, charsThatFit - 1))}…`
      : name
    : '';
  const showValue = width > 64 && height > 32;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="var(--bg)" strokeWidth={1.5} rx={3} />
      {label && (
        <text x={x + 6} y={y + 15} fontSize={11} fontWeight={600} fill={txt} pointerEvents="none">
          {label}
        </text>
      )}
      {showValue && (
        <text x={x + 6} y={y + 29} fontSize={10} fill={txt} opacity={0.82} pointerEvents="none">
          {formatINR(value)}
        </text>
      )}
    </g>
  );
}

export function TreemapChart({ data, legend }: { data: TreemapGroup[]; legend: TreemapLegendItem[] }) {
  const reduced = usePrefersReducedMotion();
  const hasData = data.some((g) => g.children.length > 0);
  if (!hasData) {
    return <div className="flex h-64 items-center justify-center text-sm text-faint">No holdings to map.</div>;
  }
  return (
    <div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={data}
            dataKey="value"
            nameKey="name"
            isAnimationActive={!reduced}
            animationDuration={600}
            content={<TreeCell />}
          >
            <Tooltip
              content={({ active, payload }) =>
                active && payload && payload.length ? (
                  <div className="rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-xs shadow-lg">
                    <div className="text-text">{payload[0].payload?.name}</div>
                    <div className="font-mono tabular-nums text-muted">
                      {formatINR(Number(payload[0].value))}
                    </div>
                  </div>
                ) : null
              }
            />
          </Treemap>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {legend.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5 text-xs text-muted">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: l.color }} />
            {l.label}
            <span className="font-mono tabular-nums text-faint">{formatINR(l.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
