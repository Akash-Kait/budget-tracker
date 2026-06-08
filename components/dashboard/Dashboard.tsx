'use client';
import { useState, useMemo } from 'react';
import { Card } from '@/components/Card';
import { KpiCards } from '@/components/dashboard/KpiCards';
import { WhatIfBar } from '@/components/dashboard/WhatIfBar';
import { ReserveGauge } from '@/components/dashboard/ReserveGauge';
import { FundingBars } from '@/components/dashboard/FundingBars';
import { LiabilityTreemap } from '@/components/dashboard/LiabilityTreemap';
import { GoalTimeline } from '@/components/dashboard/GoalTimeline';
import { SurplusProjection } from '@/components/dashboard/SurplusProjection';
import {
  monthlySurplus,
  reserveRecoveryMonths,
  totalFutureLiability,
  monthsToFullyFund,
  sortQueue,
  isActive,
  fundingProgress,
  projectMonthlyAllocation,
  simulatePurchase,
} from '@/lib/finance';
import type { Item, Profile } from '@/lib/types';

export function Dashboard({ profile, items }: { profile: Profile; items: Item[] }) {
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const costNum = Number(cost) || 0;
  const active = useMemo(() => sortQueue(items.filter(isActive)), [items]);

  const sim = costNum > 0 ? simulatePurchase(profile, items, costNum) : null;
  const effProfile: Profile = sim
    ? { ...profile, reserveCurrent: profile.reserveCurrent - costNum }
    : profile;

  const surplus = monthlySurplus(profile);
  const reservePct =
    profile.reserveTarget > 0
      ? Math.round((effProfile.reserveCurrent / profile.reserveTarget) * 100)
      : 0;
  const liability = totalFutureLiability(items);
  const topUnfunded = active.find((i) => fundingProgress(i).pct < 100)?.title ?? null;
  const m2f = monthsToFullyFund(profile, items);
  const recovery = reserveRecoveryMonths(effProfile);
  const projection = useMemo(
    () =>
      projectMonthlyAllocation(profile, items, {
        months: 12,
        fromIso: new Date().toISOString(),
        startReserve: effProfile.reserveCurrent,
      }),
    [profile, items, effProfile.reserveCurrent],
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <KpiCards
        reservePct={reservePct}
        futureFunding={liability.total}
        topUnfunded={topUnfunded}
        monthsToFund={m2f}
        surplus={surplus}
      />
      <WhatIfBar
        name={name}
        cost={cost}
        onName={setName}
        onCost={setCost}
        onClear={() => {
          setName('');
          setCost('');
        }}
        sim={sim}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Reserve Health">
          <ReserveGauge
            current={effProfile.reserveCurrent}
            target={profile.reserveTarget}
            recoveryMonths={recovery}
          />
        </Card>
        <Card title="Funding Progress">
          <FundingBars items={active} />
        </Card>
      </div>
      <Card title="Future Liability Breakdown">
        <LiabilityTreemap data={liability.breakdown} />
      </Card>
      <Card title="Goal Timeline">
        <GoalTimeline items={active} />
      </Card>
      <Card title="Monthly Surplus Projection (12 mo)">
        <SurplusProjection data={projection} surplus={surplus} />
      </Card>
    </div>
  );
}
