import { Panel } from '@/components/wealth/Panel';
import { EcasUnifiedImportPanel } from '@/components/wealth/EcasUnifiedImportPanel';
import { WealthAssetForm } from '@/components/wealth/WealthAssetForm';
import { WealthAssetRow } from '@/components/wealth/WealthAssetRow';
import { WealthKpiCards } from '@/components/wealth/WealthKpiCards';
import { HeroWealth } from '@/components/wealth/HeroWealth';
import { AllocationChart } from '@/components/wealth/AllocationChart';
import { TreemapChart } from '@/components/wealth/TreemapChart';
import { wealthTypeColor } from '@/lib/colors';
import { isStale } from '@/lib/market/staleness';
import { getWealthAssets } from '@/lib/data';
import {
  groupByType,
  totalWealth,
  allocationByType,
  assetValue,
} from '@/lib/wealth';

export const dynamic = 'force-dynamic';

export default async function WealthPage() {
  const assets = await getWealthAssets();
  const now = new Date().toISOString();
  // A refreshed live price (API = AMFI NAV, NSE = equity close) that hasn't advanced in N business
  // days is stale — flagged in the row. (eCAS/CAS statement-seed prices aren't "live", so not flagged.)
  const isAssetStale = (a: (typeof assets)[number]) =>
    (a.priceSource === 'API' || a.priceSource === 'NSE') && a.priceUpdatedAt != null && isStale(a.priceUpdatedAt, now);
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
  // One treemap PER asset type: cells sized to proportions WITHIN their own type, each filling its own
  // panel (so the 12 stocks aren't crushed against the 91%-of-value MFs). Cross-type magnitude is NOT
  // implied — the allocation donut remains the honest between-types split; each treemap panel is
  // labelled with its own type TOTAL so it reads as within-type proportion. Zero-value holdings can't
  // be sized, so they're omitted here (they still show in the holdings list).
  const typeTreemaps = groups
    .map((g) => ({
      type: g.type,
      label: g.label,
      total: g.subtotal,
      color: wealthTypeColor(g.type),
      items: g.assets
        .map((a) => ({ label: a.displayName, value: assetValue(a), fill: wealthTypeColor(g.type) }))
        .filter((c) => c.value > 0),
    }))
    .filter((t) => t.items.length > 0);

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
          <div className="mt-2 space-y-5 border-t border-hairline pt-5">
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wide text-faint">Import from eCAS</p>
              <EcasUnifiedImportPanel />
            </div>
            <div className="border-t border-hairline pt-5">
              <WealthAssetForm />
            </div>
          </div>
        </Panel>
      ) : (
        <>
          {/* HERO — the single loud element (count-up + glow) */}
          <HeroWealth total={total} allocation={allocation} />

          {/* Supporting trio — calm */}
          <WealthKpiCards assets={assets} />

          {/* Allocation donut — the honest CROSS-type split (between-types). */}
          <Panel title="Allocation by type">
            <AllocationChart data={allocation} total={total} />
          </Panel>

          {/* Within-type treemaps — one per type, each sized to its own proportions and labelled with
              its type total (NOT comparable across panels; the donut covers cross-type magnitude). */}
          <div className="grid gap-6 lg:grid-cols-2">
            {typeTreemaps.map((t) => (
              <Panel
                key={t.type}
                title={t.label}
                right={
                  <span className="flex items-center gap-2 font-mono text-sm tabular-nums text-text">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                    ₹{t.total.toLocaleString('en-IN')}
                  </span>
                }
              >
                <TreemapChart items={t.items} />
              </Panel>
            ))}
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

          {/* Import from eCAS — one upload → stocks + mutual funds in one atomic confirm */}
          <Panel title="Import from eCAS">
            <EcasUnifiedImportPanel />
          </Panel>

          {/* Add — calm */}
          <Panel title="Add asset">
            <WealthAssetForm />
          </Panel>
        </>
      )}
    </div>
  );
}
