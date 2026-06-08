import { formatMonth } from '@/lib/format';
import type { Item } from '@/lib/types';

export function GoalTimeline({ items }: { items: Item[] }) {
  const dated = items
    .filter((i) => i.dueDate)
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());
  if (dated.length === 0) return <p className="text-sm text-gray-500">Nothing scheduled.</p>;

  return (
    <div className="overflow-x-auto pb-2">
      <ol className="relative flex min-w-full">
        {/* connecting line behind the dots */}
        <span className="pointer-events-none absolute inset-x-0 top-[5px] h-0.5 bg-gray-200" />
        {dated.map((i) => (
          <li
            key={i.id}
            className="relative flex min-w-[90px] flex-1 flex-col items-center px-1 text-center"
          >
            <span className="z-10 h-3 w-3 rounded-full bg-blue-500" />
            <span className="mt-2 break-words text-xs font-medium leading-tight text-gray-700">
              {i.title}
            </span>
            <span className="text-[10px] text-gray-400">{formatMonth(i.dueDate!)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
