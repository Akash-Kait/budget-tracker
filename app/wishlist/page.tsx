import { Card } from '@/components/Card';
import { WishlistRow } from '@/components/WishlistRow';
import { ItemForm } from '@/components/ItemForm';
import { getItems } from '@/lib/data';
import { daysUntil } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function WishlistPage() {
  const items = (await getItems()).filter((i) => i.type === 'WISHLIST' && !i.purchased);
  const now = new Date().toISOString();
  const withDays = items.map((i) => {
    const expiry = new Date(i.dateAdded);
    expiry.setDate(expiry.getDate() + i.coolingPeriodDays);
    return { item: i, daysRemaining: daysUntil(expiry.toISOString(), now) };
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Wishlist</h1>
      <p className="text-sm text-gray-500">
        Items can&apos;t be marked purchased until their cooling period expires — a guard against
        impulse buys.
      </p>
      <Card title="Add wish">
        <ItemForm defaultType="WISHLIST" />
      </Card>
      <Card>
        {withDays.length === 0 ? (
          <p className="text-sm text-gray-500">No wishes yet.</p>
        ) : (
          withDays.map(({ item, daysRemaining }) => (
            <WishlistRow key={item.id} item={item} daysRemaining={daysRemaining} />
          ))
        )}
      </Card>
    </div>
  );
}
