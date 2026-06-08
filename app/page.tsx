import { Card } from '@/components/Card';
import { Money } from '@/components/Money';
import { ProgressBar } from '@/components/ProgressBar';
import { getProfile, getItems } from '@/lib/data';
import { monthlySurplus, reserveDeficit, sortQueue, fundingProgress } from '@/lib/finance';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const profile = await getProfile();
  const items = await getItems();
  const surplus = monthlySurplus(profile);
  const deficit = reserveDeficit(profile);
  const reservePct =
    profile.reserveTarget > 0
      ? Math.round((profile.reserveCurrent / profile.reserveTarget) * 100)
      : 0;

  const topUnfunded = sortQueue(items).find((i) => fundingProgress(i).pct < 100);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="Protected Capital">
          <p className="text-2xl font-bold">
            <Money amount={profile.protectedCapital} />
          </p>
          <p className="mt-1 text-xs text-gray-500">Do not spend</p>
        </Card>
        <Card title="Opportunity Reserve">
          <p className="text-2xl font-bold">
            <Money amount={profile.reserveCurrent} />
          </p>
          <p className="mt-1 text-xs text-gray-500">
            of <Money amount={profile.reserveTarget} /> target
          </p>
          <div className="mt-2">
            <ProgressBar pct={reservePct} />
          </div>
          {deficit > 0 && (
            <p className="mt-1 text-xs text-amber-600">
              Deficit: <Money amount={deficit} />
            </p>
          )}
        </Card>
        <Card title="Monthly Surplus">
          <p className={`text-2xl font-bold ${surplus < 0 ? 'text-red-600' : ''}`}>
            <Money amount={surplus} />
          </p>
          <p className="mt-1 text-xs text-gray-500">
            <Money amount={profile.monthlyIncome} /> − <Money amount={profile.monthlyExpenses} /> −{' '}
            <Money amount={profile.monthlyInvestments} />
          </p>
        </Card>
      </div>
      {topUnfunded && (
        <Card title="Highest-priority unfunded item">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">{topUnfunded.title}</p>
              <p className="text-xs text-gray-500">
                Priority {topUnfunded.priority} · {topUnfunded.type}
              </p>
            </div>
            <p className="text-sm">
              <Money amount={topUnfunded.fundedAmount} /> / <Money amount={topUnfunded.amount} /> (
              {fundingProgress(topUnfunded).pct}%)
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
