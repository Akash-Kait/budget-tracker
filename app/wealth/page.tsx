import { Panel } from '@/components/wealth/Panel';
import { WealthAssetForm } from '@/components/wealth/WealthAssetForm';
import { WealthAssetRow } from '@/components/wealth/WealthAssetRow';
import { WealthKpiCards } from '@/components/wealth/WealthKpiCards';
import { AllocationDonut } from '@/components/wealth/AllocationDonut';
import { RefreshPricesButton } from '@/components/wealth/RefreshPricesButton';
import { wealthTypeColor } from '@/lib/colors';
import { getWealthAssets } from '@/lib/data';
import { groupByType, totalWealth, allocationByType } from '@/lib/wealth';

export const dynamic = 'force-dynamic';

export default async function WealthPage() {
  const assets = await getWealthAssets();
  const groups = groupByType(assets);
  const total = totalWealth(assets);
  const allocation = allocationByType(assets);
  const empty = assets.length === 0;

  return (
    <div className="space-y-8">
      {/* Header band */}
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-text">Wealth</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Investment assets, entered manually for now. Tracked separately — they never affect your
            planning reserve, projections, or the purchase simulator.
          </p>
        </div>
        <RefreshPricesButton />
      </header>

      {/* KPI row */}
      <div className="rise" style={{ animationDelay: '60ms' }}>
        <WealthKpiCards assets={assets} total={total} />
      </div>

      {empty ? (
        <Panel className="rise" >
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
          {/* Allocation */}
          <Panel title="Allocation by type" className="rise" >
            <AllocationDonut data={allocation} total={total} />
          </Panel>

          {/* Holdings, grouped by type */}
          <section className="rise space-y-4" style={{ animationDelay: '120ms' }}>
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
                  <WealthAssetRow key={a.id} asset={a} />
                ))}
              </Panel>
            ))}
          </section>

          {/* Add */}
          <Panel title="Add asset" className="rise">
            <WealthAssetForm />
          </Panel>
        </>
      )}
    </div>
  );
}
