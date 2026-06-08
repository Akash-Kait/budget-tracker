import { Card } from '@/components/Card';
import { Money } from '@/components/Money';
import { ProgressBar } from '@/components/ProgressBar';
import { getProfile, getItems } from '@/lib/data';
import {
  monthlySurplus,
  reserveDeficit,
  sortQueue,
  fundingProgress,
  isActive,
  reserveRecoveryMonths,
  totalFutureLiability,
} from '@/lib/finance';

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

  const recoveryMonths = reserveRecoveryMonths(profile);
  const liability = totalFutureLiability(items);
  const topUnfunded = sortQueue(items.filter(isActive)).find((i) => fundingProgress(i).pct < 100);

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
          <p className="mt-1 text-xs text-gray-500">
            Recovery: {recoveryMonths === null ? '—' : `${recoveryMonths.toFixed(1)} months`}
          </p>
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
      <Card title="Total Future Liability">
        {liability.breakdown.length === 0 ? (
          <p className="text-sm text-gray-500">No outstanding obligations.</p>
        ) : (
          <>
            <ul className="space-y-1 text-sm">
              {liability.breakdown.map((b) => (
                <li key={b.title} className="flex justify-between">
                  <span>{b.title}</span>
                  <Money amount={b.remaining} />
                </li>
              ))}
            </ul>
            <p className="mt-3 flex justify-between border-t border-gray-200 pt-2 font-bold">
              <span>Total</span>
              <Money amount={liability.total} />
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
