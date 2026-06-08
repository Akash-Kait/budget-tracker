import { formatINR } from '@/lib/format';
import { colorFor } from '@/lib/colors';

export function LiabilityTreemap({ data }: { data: { title: string; remaining: number }[] }) {
  if (data.length === 0) return <p className="text-sm text-muted">No outstanding obligations.</p>;
  const total = data.reduce((s, d) => s + d.remaining, 0);
  return (
    <div className="flex h-56 w-full flex-wrap gap-1">
      {data.map((d, idx) => {
        const share = total > 0 ? d.remaining / total : 0;
        return (
          <div
            key={d.title}
            className="flex min-w-[90px] flex-col justify-between gap-1 overflow-hidden rounded-lg p-3 text-white"
            style={{
              flexGrow: Math.max(1, Math.round(share * 100)),
              flexBasis: `${Math.max(15, share * 100)}%`,
              backgroundImage: `linear-gradient(155deg, ${colorFor(idx)}, ${colorFor(idx)}99)`,
            }}
          >
            <span title={d.title} className="block min-w-0 truncate text-[13px] font-semibold leading-tight">
              {d.title}
            </span>
            <span className="block min-w-0 truncate text-xs opacity-90">
              {formatINR(d.remaining)} · {Math.round(share * 100)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
