export function formatINR(amount: number): string {
  const rounded = Math.round(amount);
  const formatted = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(rounded);
  return `₹${formatted}`;
}

export function formatMonth(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function daysUntil(targetIso: string, fromIso: string): number {
  const ms = new Date(targetIso).getTime() - new Date(fromIso).getTime();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  return Math.max(0, days);
}
