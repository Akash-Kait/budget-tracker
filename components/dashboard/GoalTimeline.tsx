import { formatMonth } from '@/lib/format';
import type { Item } from '@/lib/types';

export function GoalTimeline({ items }: { items: Item[] }) {
  const dated = items
    .filter((i) => i.dueDate)
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());
  if (dated.length === 0) return <p className="text-sm text-muted">Nothing scheduled.</p>;

  return (
    <div className="overflow-x-auto pb-2">
      <ol className="relative flex min-w-full">
        {/* connecting rail behind the dots — subtle accent fade from the nearest milestone */}
        <span
          className="pointer-events-none absolute inset-x-0 top-[5px] h-0.5"
          style={{ background: 'linear-gradient(90deg, var(--accent-weak), var(--hairline))' }}
        />
        {dated.map((i, idx) => (
          <li
            key={i.id}
            className="relative flex min-w-[90px] flex-1 flex-col items-center px-1 text-center"
          >
            <span
              className="z-10 h-3 w-3 rounded-full bg-accent"
              style={idx === 0 ? { boxShadow: '0 0 0 4px var(--accent-weak)' } : undefined}
            />
            <span className="mt-2 break-words text-xs font-medium leading-tight text-text">
              {i.title}
            </span>
            <span className="text-[10px] text-faint">{formatMonth(i.dueDate!)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
