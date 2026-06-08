import { Card } from '@/components/Card';
import { Money } from '@/components/Money';
import { getItems } from '@/lib/data';
import { isDone } from '@/lib/finance';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const done = (await getItems()).filter(isDone);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Completed History</h1>
      <Card>
        {done.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing completed yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {done.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium">
                    {i.title}{' '}
                    <span className="text-xs text-green-600">
                      ✓ {i.type === 'WISHLIST' && i.purchased ? 'purchased' : 'completed'}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {i.type} · P{i.priority}
                  </p>
                </div>
                <Money amount={i.amount} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
