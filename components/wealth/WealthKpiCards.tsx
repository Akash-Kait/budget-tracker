import { Card } from '@/components/Card';
import { Money } from '@/components/Money';
import { assetValue, largestHolding } from '@/lib/wealth';
import type { WealthAsset } from '@/lib/types';

export function WealthKpiCards({ assets, total }: { assets: WealthAsset[]; total: number }) {
  const largest = largestHolding(assets);
  const typeCount = new Set(assets.map((a) => a.type)).size;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card title="Total Wealth">
        <p className="text-2xl font-bold">
          <Money amount={total} />
        </p>
      </Card>
      <Card title="Holdings">
        <p className="text-2xl font-bold">{assets.length}</p>
      </Card>
      <Card title="Largest Holding">
        {largest ? (
          <>
            <p className="truncate text-lg font-bold">{largest.name}</p>
            <p className="text-xs text-gray-500">
              <Money amount={assetValue(largest)} />
            </p>
          </>
        ) : (
          <p className="text-2xl font-bold">—</p>
        )}
      </Card>
      <Card title="Asset Types">
        <p className="text-2xl font-bold">{typeCount}</p>
      </Card>
    </div>
  );
}
