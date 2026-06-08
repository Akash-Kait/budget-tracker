'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Profile } from '@/lib/types';

const fields: { key: keyof Profile; label: string }[] = [
  { key: 'protectedCapital', label: 'Protected Capital' },
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
          <span className="mb-1 block text-gray-600">{f.label}</span>
          <input
            type="number"
            className="w-full rounded-md border border-gray-300 px-2 py-1"
            value={form[f.key]}
            onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })}
          />
        </label>
      ))}
      <div className="col-span-full">
        <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          Save
        </button>
        {saved && <span className="ml-3 text-sm text-green-600">Saved</span>}
      </div>
    </form>
  );
}
