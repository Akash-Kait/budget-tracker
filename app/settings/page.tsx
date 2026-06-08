import { Card } from '@/components/Card';
import { ProfileForm } from '@/components/ProfileForm';
import { getProfile } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const profile = await getProfile();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Card title="Financial Profile">
        <ProfileForm initial={profile} />
      </Card>
    </div>
  );
}
