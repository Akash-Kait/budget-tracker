import { Card } from '@/components/Card';
import { EditableItemRow } from '@/components/EditableItemRow';
import { ItemForm } from '@/components/ItemForm';
import { getItems, getProfile } from '@/lib/data';
import { sortQueue, isActive, remaining, projectedCompletion } from '@/lib/finance';

export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  const [items, profile] = await Promise.all([getItems(), getProfile()]);
  const active = items.filter(isActive);
  const queue = sortQueue(active);
  const proj = projectedCompletion(profile, items, new Date().toISOString());
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Priority Queue</h1>
      <p className="text-sm text-gray-500">
        Active items, sorted by priority (highest first), then by due date. Completed items move to
        History.
      </p>
      <Card title="Add item">
        <ItemForm />
      </Card>
      <Card>
        {queue.length === 0 ? (
          <p className="text-sm text-gray-500">No active items.</p>
        ) : (
          queue.map((i) => (
            <EditableItemRow
              key={i.id}
              item={i}
              remaining={remaining(i)}
              projectedIso={proj[i.id]?.isoDate ?? null}
              behindMonths={proj[i.id]?.behindMonths ?? null}
            />
          ))
        )}
      </Card>
    </div>
  );
}
