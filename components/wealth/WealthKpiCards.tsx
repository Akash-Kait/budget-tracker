import { Money } from '@/components/Money';
import { GainLossText } from '@/components/wealth/GainLossText';
import { assetValue, largestHolding, assetCostBasis, totalGainLoss } from '@/lib/wealth';
import type { WealthAsset } from '@/lib/types';

function Kpi({
  label,
  children,
  hero = false,
}: {
  label: string;
  children: React.ReactNode;
  hero?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-hairline bg-surface p-5 transition-colors hover:border-hairline-strong ${
        hero ? 'sm:col-span-2 lg:col-span-1' : ''
      }`}
    >
      {hero && <span className="absolute inset-x-0 top-0 h-px bg-accent/70" />}
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function WealthKpiCards({ assets, total }: { assets: WealthAsset[]; total: number }) {
  const largest = largestHolding(assets);
  const typeCount = new Set(assets.map((a) => a.type)).size;
  const gl = totalGainLoss(assets);
  const covered = assets.filter((a) => assetCostBasis(a) !== null).length;
  const partial = covered > 0 && covered < assets.length;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <Kpi label="Total Wealth" hero>
        <p className="font-mono text-3xl font-semibold tabular-nums tracking-tight text-text">
          <Money amount={total} />
        </p>
      </Kpi>
      <Kpi label="Total Gain / Loss">
        {gl ? (
          <>
            <GainLossText gl={gl} className="text-2xl font-semibold" />
            {partial && (
              <p className="mt-0.5 text-[11px] text-faint">
                based on {covered} of {assets.length} holdings
              </p>
            )}
          </>
        ) : (
          <p className="font-mono text-3xl font-semibold text-faint">—</p>
        )}
      </Kpi>
      <Kpi label="Holdings">
        <p className="font-mono text-3xl font-semibold tabular-nums text-text">{assets.length}</p>
      </Kpi>
      <Kpi label="Largest Holding">
        {largest ? (
          <>
            <p className="truncate text-lg font-semibold text-text">{largest.name}</p>
            <p className="mt-0.5 font-mono text-sm tabular-nums text-muted">
              <Money amount={assetValue(largest)} />
            </p>
          </>
        ) : (
          <p className="font-mono text-3xl font-semibold text-faint">—</p>
        )}
      </Kpi>
      <Kpi label="Asset Types">
        <p className="font-mono text-3xl font-semibold tabular-nums text-text">{typeCount}</p>
      </Kpi>
    </div>
  );
}
