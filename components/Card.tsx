export function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-hairline bg-surface p-5">
      {title && (
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}
