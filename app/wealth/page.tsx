import { Panel } from '@/components/wealth/Panel';
import { WealthAssetForm } from '@/components/wealth/WealthAssetForm';
import { WealthAssetRow } from '@/components/wealth/WealthAssetRow';
import { WealthKpiCards } from '@/components/wealth/WealthKpiCards';
import { HeroWealth } from '@/components/wealth/HeroWealth';
import { AllocationChart } from '@/components/wealth/AllocationChart';
import { GainLossChart, type GainLossRow } from '@/components/wealth/GainLossChart';
import { wealthTypeColor } from '@/lib/colors';
import { isStale } from '@/lib/market/staleness';
import { getWealthAssets } from '@/lib/data';
import {
  groupByType,
  totalWealth,
  allocationByType,
  totalGainLoss,
  assetCostBasis,
  assetValue,
  assetGainLoss,
} from '@/lib/wealth';

export const dynamic = 'force-dynamic';

export default async function WealthPage() {
  const assets = await getWealthAssets();
  const now = new Date().toISOString();
  // A live (API) NAV that hasn't refreshed in N business days is stale — flagged in the row.
  const isAssetStale = (a: (typeof assets)[number]) =>
    a.priceSource === 'API' && a.priceUpdatedAt != null && isStale(a.priceUpdatedAt, now);
  const total = totalWealth(assets);
  const groups = groupByType(assets);
  const empty = assets.length === 0;

  // Plain, serializable data for the client chart/hero components (no lib logic crosses the boundary).
  const allocation = allocationByType(assets).map((a) => ({
    label: a.label,
    value: a.value,
    pct: a.pct,
    color: wealthTypeColor(a.type),
  }));
  const gl = totalGainLoss(assets);
  const covered = assets.filter((a) => assetCostBasis(a) !== null).length;
  const glRows: GainLossRow[] = assets
    .map((a) => {
      const g = assetGainLoss(a);
      return {
        name: a.name,
        value: assetValue(a),
        status: (g === null ? 'none' : g.absolute > 0 ? 'gain' : g.absolute < 0 ? 'loss' : 'none') as
          | 'gain'
          | 'loss'
          | 'none',
        glAbsolute: g?.absolute ?? null,
        glPct: g?.pct ?? null,
      };
    })
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-text">Wealth</h1>
        <p className="mt-1 max-w-xl text-sm text-muted">
          Investment assets, entered manually for now. Tracked separately — they never affect your
          planning reserve, projections, or the purchase simulator.
        </p>
      </header>

      {empty ? (
        <Panel>
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full border border-hairline text-accent">
              ₹
            </div>
            <p className="text-base font-medium text-text">No assets yet</p>
            <p className="max-w-sm text-sm text-muted">
              Add your mutual funds, stocks, or other holdings below to see your allocation and total.
            </p>
          </div>
          <div className="mt-2 border-t border-hairline pt-5">
            <WealthAssetForm />
          </div>
        </Panel>
      ) : (
        <>
          {/* HERO — the single loud element (count-up + glow) */}
          <HeroWealth total={total} gl={gl} covered={covered} count={assets.length} allocation={allocation} />

          {/* Supporting trio — calm */}
          <WealthKpiCards assets={assets} />

          {/* Charts — calm surfaces, animate in */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Allocation by type">
              <AllocationChart data={allocation} total={total} />
            </Panel>
            <Panel title="Value & gain/loss by holding">
              <GainLossChart data={glRows} />
            </Panel>
          </div>

          {/* Holdings — calm grouped table */}
          <section className="space-y-4">
            {groups.map((g) => (
              <Panel
                key={g.type}
                title={g.label}
                right={
                  <span className="flex items-center gap-2 font-mono text-sm tabular-nums text-text">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: wealthTypeColor(g.type) }}
                    />
                    ₹{g.subtotal.toLocaleString('en-IN')}
                  </span>
                }
              >
                {g.assets.map((a) => (
                  <WealthAssetRow key={a.id} asset={a} stale={isAssetStale(a)} />
                ))}
              </Panel>
            ))}
          </section>

          {/* Add — calm */}
          <Panel title="Add asset">
            <WealthAssetForm />
          </Panel>
        </>
      )}
    </div>
  );
}
