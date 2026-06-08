import { formatINR } from '@/lib/format';
import { colorFor } from '@/lib/colors';
import { ASSET_TYPES } from '@/lib/types';
import type { WealthAllocation } from '@/lib/wealth';

const colorForType = (type: WealthAllocation['type']) => colorFor(ASSET_TYPES.indexOf(type));

export function AllocationDonut({ data, total }: { data: WealthAllocation[]; total: number }) {
  if (data.length === 0 || total <= 0) {
    return <p className="text-sm text-gray-500">No assets to allocate.</p>;
  }
  const r = 70;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width="180" height="180" viewBox="0 0 180 180" className="shrink-0">
        <circle cx="90" cy="90" r={r} fill="none" stroke="#f3f4f6" strokeWidth="22" />
        {data.map((a) => {
          const len = (a.pct / 100) * circ;
          const seg = (
            <circle
              key={a.type}
              cx="90"
              cy="90"
              r={r}
              fill="none"
              stroke={colorForType(a.type)}
              strokeWidth="22"
              strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 90 90)"
            />
          );
          offset += len;
          return seg;
        })}
        <text x="90" y="86" textAnchor="middle" className="fill-gray-500" fontSize="11">
          Total
        </text>
        <text x="90" y="104" textAnchor="middle" className="fill-gray-900" fontSize="15" fontWeight="700">
          {formatINR(total)}
        </text>
      </svg>
      <ul className="space-y-2 text-sm">
        {data.map((a) => (
          <li key={a.type} className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded"
              style={{ backgroundColor: colorForType(a.type) }}
            />
            <span className="w-28 text-gray-700">{a.label}</span>
            <span className="font-medium">{formatINR(a.value)}</span>
            <span className="text-gray-400">· {a.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
