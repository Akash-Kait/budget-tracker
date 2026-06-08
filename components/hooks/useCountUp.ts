import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '@/components/hooks/usePrefersReducedMotion';

/**
 * Animates 0 → target (easeOutCubic) for hero figures. Honors reduced-motion by jumping straight to
 * the final value. The value is always real text, so no information depends on the animation.
 */
export function useCountUp(target: number, durationMs = 800): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target, durationMs, reduced]);

  return value;
}
