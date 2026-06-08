import type { Recommendation } from '@/lib/types';

const styles: Record<Recommendation, string> = {
  SAFE: 'bg-accent-weak border-accent/40 text-accent',
  CAUTION: 'bg-warning-weak border-warning/40 text-warning',
  WAIT: 'bg-negative/10 border-negative/40 text-negative',
};

export function RecommendationBanner({ rec, message }: { rec: Recommendation; message: string }) {
  return (
    <div className={`rounded-lg border p-4 ${styles[rec]}`}>
      <p className="text-sm font-bold uppercase tracking-wide">{rec}</p>
      <p className="mt-1 text-sm">{message}</p>
    </div>
  );
}
