import { formatINR } from '@/lib/format';
import { colorFor, RESERVE_COLOR } from '@/lib/colors';
import type { MonthlyAllocation } from '@/lib/finance';

export function SurplusProjection({
  data,
  surplus,
}: {
  data: MonthlyAllocation[];
  surplus: number;
}) {
  if (surplus <= 0) return <p className="text-sm text-gray-500">No surplus to allocate.</p>;
  const titles = Array.from(new Set(data.flatMap((m) => m.items.map((i) => i.title))));
  const colorOf = (title: string) => colorFor(titles.indexOf(title));
  const max = Math.max(
    surplus,
    ...data.map((m) => m.reserve + m.items.reduce((s, i) => s + i.amount, 0)),
  );

  return (
    <div>
      <div className="flex h-48 items-end gap-1">
        {data.map((m) => {
          const segs = [
            { key: 'Reserve', amount: m.reserve, color: RESERVE_COLOR },
            ...m.items.map((i) => ({ key: i.title, amount: i.amount, color: colorOf(i.title) })),
          ];
          return (
            <div key={m.month} className="flex flex-1 flex-col items-center">
              <div className="flex w-full flex-col-reverse" style={{ height: '100%' }}>
                {segs.map((s) => (
                  <div
                    key={s.key}
                    title={`${m.month} · ${s.key}: ${formatINR(s.amount)}`}
                    style={{ height: `${(s.amount / max) * 100}%`, backgroundColor: s.color }}
                  />
                ))}
              </div>
              <span className="mt-1 origin-left rotate-45 text-[9px] text-gray-400">
                {m.month.split(' ')[0]}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: RESERVE_COLOR }} />
          Reserve refill
        </span>
        {titles.map((t) => (
          <span key={t} className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: colorOf(t) }} />
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
