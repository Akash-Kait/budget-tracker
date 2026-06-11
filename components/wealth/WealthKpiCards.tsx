import { Money } from '@/components/Money';
import { assetValue, largestHolding } from '@/lib/wealth';
import type { WealthAsset } from '@/lib/types';

// Supporting trio — deliberately calm (no glow, no entrance motion); Total Wealth leads in the hero so
// these recede beneath it. Value-framed: no gain/loss anywhere (cost-basis data kept, not displayed).
function Kpi({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-hairline bg-surface p-5 transition-colors hover:border-hairline-strong">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function WealthKpiCards({ assets }: { assets: WealthAsset[] }) {
  const largest = largestHolding(assets);
  const typeCount = new Set(assets.map((a) => a.type)).size;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Kpi label="Holdings">
        <p className="font-mono text-xl font-semibold tabular-nums text-text">{assets.length}</p>
      </Kpi>
      <Kpi label="Largest Holding">
        {largest ? (
          <>
            <p className="truncate text-base font-semibold text-text">{largest.name}</p>
            <p className="mt-0.5 font-mono text-sm tabular-nums text-muted">
              <Money amount={assetValue(largest)} />
            </p>
          </>
        ) : (
          <p className="font-mono text-xl font-semibold text-faint">—</p>
        )}
      </Kpi>
      <Kpi label="Asset Types">
        <p className="font-mono text-xl font-semibold tabular-nums text-text">{typeCount}</p>
      </Kpi>
    </div>
  );
}
