'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Profile } from '@/lib/types';

const fields: { key: keyof Profile; label: string }[] = [
  { key: 'reserveTarget', label: 'Reserve Target' },
  { key: 'reserveCurrent', label: 'Reserve Current' },
  { key: 'monthlyIncome', label: 'Monthly Income' },
  { key: 'monthlyExpenses', label: 'Monthly Expenses' },
  { key: 'monthlyInvestments', label: 'Monthly Investments' },
];

export function ProfileForm({ initial }: { initial: Profile }) {
  const router = useRouter();
  const [form, setForm] = useState<Profile>(initial);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => (
        <label key={f.key} className="text-sm">
          <span className="mb-1 block text-muted">{f.label}</span>
          <input
            type="number"
            className="w-full rounded-md border border-hairline bg-surface-2 px-2 py-1 text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent-weak"
            value={form[f.key]}
            onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })}
          />
        </label>
      ))}
      <div className="col-span-full">
        <button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg transition-opacity hover:opacity-90">
          Save
        </button>
        {saved && <span className="ml-3 text-sm text-accent">Saved</span>}
      </div>
    </form>
  );
}
