import { Card } from '@/components/Card';
import { RankingList } from '@/components/RankingList';
import { getItems } from '@/lib/data';
import { sortQueue, isActive } from '@/lib/finance';

export const dynamic = 'force-dynamic';

export default async function RankingPage() {
  const items = sortQueue((await getItems()).filter(isActive));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Priority Ranking</h1>
      <p className="text-sm text-gray-500">
        Drag to reorder. Ranking sets the order <em>within</em> a priority level — higher-priority
        items always stay on top. This order drives the queue and the simulator&apos;s projections.
      </p>
      <Card>
        {items.length === 0 ? (
          <p className="text-sm text-gray-500">No active items.</p>
        ) : (
          <RankingList initial={items} />
        )}
      </Card>
    </div>
  );
}
