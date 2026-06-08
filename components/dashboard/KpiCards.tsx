import { Card } from '@/components/Card';
import { Money } from '@/components/Money';

// Supporting quartet — Reserve Health moved to the hero, so these recede beneath it. Calm: no glow,
// no motion, only the Card hover.
export function KpiCards({
  futureFunding,
  topUnfunded,
  monthsToFund,
  surplus,
}: {
  futureFunding: number;
  topUnfunded: string | null;
  monthsToFund: number | null;
  surplus: number;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card title="Future Funding Needed">
        <p className="font-mono text-2xl font-semibold tabular-nums text-text">
          <Money amount={futureFunding} />
        </p>
      </Card>
      <Card title="Top Unfunded">
        <p className="truncate text-2xl font-semibold text-text">{topUnfunded ?? '—'}</p>
      </Card>
      <Card title="Months to Fully Fund">
        <p className="font-mono text-2xl font-semibold tabular-nums text-text">
          {monthsToFund === null ? '—' : monthsToFund.toFixed(1)}
        </p>
      </Card>
      <Card title="Monthly Surplus">
        <p
          className={`font-mono text-2xl font-semibold tabular-nums ${surplus < 0 ? 'text-negative' : 'text-text'}`}
        >
          <Money amount={surplus} />
        </p>
      </Card>
    </div>
  );
}
