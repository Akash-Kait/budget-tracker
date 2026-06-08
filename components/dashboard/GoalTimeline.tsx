import { formatMonth } from '@/lib/format';
import type { Item } from '@/lib/types';

export function GoalTimeline({ items }: { items: Item[] }) {
  const dated = items
    .filter((i) => i.dueDate)
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());
  if (dated.length === 0) return <p className="text-sm text-gray-500">Nothing scheduled.</p>;
  const times = dated.map((i) => new Date(i.dueDate!).getTime());
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = max - min || 1;
  return (
    <div className="relative mt-6 h-24">
      <div className="absolute left-0 right-0 top-3 h-0.5 bg-gray-200" />
      {dated.map((i) => {
        const pos = ((new Date(i.dueDate!).getTime() - min) / span) * 100;
        return (
          <div key={i.id} className="absolute -translate-x-1/2" style={{ left: `${pos}%`, top: 0 }}>
            <div className="mx-auto h-3 w-3 rounded-full bg-blue-500" />
            <div className="mt-1 w-24 -translate-x-1/2 text-center text-[10px] text-gray-600 ml-3">
              <div className="font-medium leading-tight">{i.title}</div>
              <div className="text-gray-400">{formatMonth(i.dueDate!)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
