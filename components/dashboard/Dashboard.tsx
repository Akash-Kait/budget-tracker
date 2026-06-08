'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Card } from '@/components/Card';
import { Money } from '@/components/Money';
import { KpiCards } from '@/components/dashboard/KpiCards';
import { WhatIfBar } from '@/components/dashboard/WhatIfBar';
import { ReserveGauge } from '@/components/dashboard/ReserveGauge';
import { FundingBars } from '@/components/dashboard/FundingBars';
import { LiabilityTreemap } from '@/components/dashboard/LiabilityTreemap';
import { GoalTimeline } from '@/components/dashboard/GoalTimeline';
import { SurplusProjection } from '@/components/dashboard/SurplusProjection';
import { deriveDashboardModel } from '@/lib/dashboard';
import type { Item, Profile } from '@/lib/types';

export function Dashboard({
  profile,
  items,
  totalWealth,
}: {
  profile: Profile;
  items: Item[];
  totalWealth: number;
}) {
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const costNum = Number(cost) || 0;

  const m = useMemo(
    () => deriveDashboardModel(profile, items, costNum, new Date().toISOString()),
    [profile, items, costNum],
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-text">Dashboard</h1>
      <KpiCards
        reservePct={m.reservePct}
        futureFunding={m.liability.total}
        topUnfunded={m.topUnfunded}
        monthsToFund={m.monthsToFund}
        surplus={m.surplus}
      />
      <Link
        href="/wealth"
        className="flex items-center justify-between rounded-2xl border border-dashed border-hairline bg-surface px-5 py-3 text-sm transition-colors hover:border-hairline-strong"
      >
        <span className="text-muted">
          Total Wealth <span className="text-faint">(tracked separately — not part of planning)</span>
        </span>
        <span className="font-mono font-semibold tabular-nums text-text">
          <Money amount={totalWealth} /> →
        </span>
      </Link>
      <WhatIfBar
        name={name}
        cost={cost}
        onName={setName}
        onCost={setCost}
        onClear={() => {
          setName('');
          setCost('');
        }}
        sim={m.sim}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Reserve Health">
          <ReserveGauge
            current={m.effReserveCurrent}
            target={profile.reserveTarget}
            recoveryMonths={m.recovery}
          />
        </Card>
        <Card title="Funding Progress">
          <FundingBars items={m.active} />
        </Card>
      </div>
      <Card title="Future Liability Breakdown">
        <LiabilityTreemap data={m.liability.breakdown} />
      </Card>
      <Card title="Goal Timeline">
        <GoalTimeline items={m.active} />
      </Card>
      <Card title="Monthly Surplus Projection (12 mo)">
        <SurplusProjection data={m.projection} surplus={m.surplus} />
      </Card>
    </div>
  );
}
