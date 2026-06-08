import { Card } from '@/components/Card';
import { Money } from '@/components/Money';
import { formatMonth } from '@/lib/format';
import { getItems } from '@/lib/data';
import { isActive } from '@/lib/finance';

export const dynamic = 'force-dynamic';

export default async function TimelinePage() {
  const items = (await getItems())
    .filter((i) => i.type !== 'WISHLIST' && i.dueDate && isActive(i))
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Future Timeline</h1>
      <Card>
        {items.length === 0 ? (
          <p className="text-sm text-muted">Nothing scheduled.</p>
        ) : (
          <ol className="relative border-l border-hairline pl-6">
            {items.map((i) => (
              <li key={i.id} className="mb-6 last:mb-0">
                <span className="absolute -left-1.5 h-3 w-3 rounded-full bg-accent" />
                <p className="text-xs font-semibold text-muted">{formatMonth(i.dueDate!)}</p>
                <p className="font-medium">
                  {i.title} <span className="text-xs text-faint">({i.type})</span>
                </p>
                <p className="text-xs text-muted">
                  <Money amount={i.amount} />
                </p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
