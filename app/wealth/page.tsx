import { Card } from '@/components/Card';
import { Money } from '@/components/Money';
import { WealthAssetForm } from '@/components/wealth/WealthAssetForm';
import { WealthAssetRow } from '@/components/wealth/WealthAssetRow';
import { getWealthAssets } from '@/lib/data';
import { groupByType, totalWealth } from '@/lib/wealth';

export const dynamic = 'force-dynamic';

export default async function WealthPage() {
  const assets = await getWealthAssets();
  const groups = groupByType(assets);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Wealth</h1>
        <p className="text-sm text-gray-500">
          Total:{' '}
          <span className="text-lg font-bold text-gray-900">
            <Money amount={totalWealth(assets)} />
          </span>
        </p>
      </div>
      <p className="text-sm text-gray-500">
        Investment assets, entered manually for now. These are tracked separately and never affect
        your planning reserve, projections, or the purchase simulator.
      </p>
      <Card title="Add asset">
        <WealthAssetForm />
      </Card>
      {groups.length === 0 ? (
        <Card>
          <p className="text-sm text-gray-500">No assets yet.</p>
        </Card>
      ) : (
        groups.map((g) => (
          <Card key={g.type} title={`${g.label} · ₹${g.subtotal.toLocaleString('en-IN')}`}>
            {g.assets.map((a) => (
              <WealthAssetRow key={a.id} asset={a} />
            ))}
          </Card>
        ))
      )}
    </div>
  );
}
