import { Dashboard } from '@/components/dashboard/Dashboard';
import { getProfile, getItems, getWealthAssets } from '@/lib/data';
import { totalWealth } from '@/lib/wealth';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [profile, items, assets] = await Promise.all([
    getProfile(),
    getItems(),
    getWealthAssets(),
  ]);
  return <Dashboard profile={profile} items={items} totalWealth={totalWealth(assets)} />;
}
