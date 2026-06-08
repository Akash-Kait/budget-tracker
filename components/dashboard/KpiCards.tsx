import { Card } from '@/components/Card';
import { Money } from '@/components/Money';

export function KpiCards({
  reservePct,
  futureFunding,
  topUnfunded,
  monthsToFund,
  surplus,
}: {
  reservePct: number;
  futureFunding: number;
  topUnfunded: string | null;
  monthsToFund: number | null;
  surplus: number;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <Card title="Reserve Health">
        <p className="text-2xl font-bold">{reservePct}%</p>
      </Card>
      <Card title="Future Funding Needed">
        <p className="text-2xl font-bold">
          <Money amount={futureFunding} />
        </p>
      </Card>
      <Card title="Top Unfunded">
        <p className="truncate text-2xl font-bold">{topUnfunded ?? '—'}</p>
      </Card>
      <Card title="Months to Fully Fund">
        <p className="text-2xl font-bold">{monthsToFund === null ? '—' : monthsToFund.toFixed(1)}</p>
      </Card>
      <Card title="Monthly Surplus">
        <p className={`text-2xl font-bold ${surplus < 0 ? 'text-red-600' : ''}`}>
          <Money amount={surplus} />
        </p>
      </Card>
    </div>
  );
}
