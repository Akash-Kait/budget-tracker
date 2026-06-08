import { formatINR } from '@/lib/format';

export function Money({ amount }: { amount: number }) {
  return <span>{formatINR(amount)}</span>;
}
