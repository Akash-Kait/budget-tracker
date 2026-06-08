export function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  // Funding progress is a generic status, not a gain/loss — uses accent (+ amber when low),
  // never the reserved --positive token.
  const color = clamped >= 100 ? 'bg-accent' : clamped >= 50 ? 'bg-accent/70' : 'bg-warning';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div className={`h-full ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}
