import type { Recommendation } from '@/lib/types';

const styles: Record<Recommendation, string> = {
  SAFE: 'bg-green-50 border-green-300 text-green-800',
  CAUTION: 'bg-amber-50 border-amber-300 text-amber-800',
  WAIT: 'bg-red-50 border-red-300 text-red-800',
};

export function RecommendationBanner({ rec, message }: { rec: Recommendation; message: string }) {
  return (
    <div className={`rounded-lg border p-4 ${styles[rec]}`}>
      <p className="text-sm font-bold uppercase tracking-wide">{rec}</p>
      <p className="mt-1 text-sm">{message}</p>
    </div>
  );
}
