import { Dashboard } from '@/components/dashboard/Dashboard';
import { getProfile, getItems } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [profile, items] = await Promise.all([getProfile(), getItems()]);
  return <Dashboard profile={profile} items={items} />;
}
