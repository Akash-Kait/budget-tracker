import { Card } from '@/components/Card';
import { ItemRow } from '@/components/ItemRow';
import { ItemForm } from '@/components/ItemForm';
import { getItems } from '@/lib/data';
import { sortQueue } from '@/lib/finance';

export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  const items = await getItems();
  const queue = sortQueue(items);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Priority Queue</h1>
      <p className="text-sm text-gray-500">
        Sorted by priority (highest first), then by due date. Wishlist items live on their own
        page.
      </p>
      <Card title="Add item">
        <ItemForm />
      </Card>
      <Card>
        {queue.length === 0 ? (
          <p className="text-sm text-gray-500">No items yet.</p>
        ) : (
          queue.map((i) => <ItemRow key={i.id} item={i} />)
        )}
      </Card>
    </div>
  );
}
