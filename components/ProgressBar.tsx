export function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const color = clamped >= 100 ? 'bg-green-500' : clamped >= 50 ? 'bg-blue-500' : 'bg-amber-500';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
      <div className={`h-full ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}
