// Dark surface primitive for the Wealth dashboard. Distinct from the shared (light) Card so the
// Planning pages keep their light treatment while Wealth is fully dark.
export function Panel({
  title,
  right,
  children,
  className = '',
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-hairline bg-surface p-5 transition-colors hover:border-hairline-strong ${className}`}
    >
      {(title || right) && (
        <div className="mb-4 flex items-center justify-between">
          {title && (
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
              {title}
            </h2>
          )}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}
