'use client';
import { useId, useState } from 'react';

// A Wealth Panel whose header is a real toggle button: clicking collapses/expands the holding rows
// while the title + total stay visible (collapsed = overview, you still see the section total). State
// is per-session only (useState) — intentionally NOT persisted; it resets to the collapsed default on
// reload. The height animates via the grid-rows 0fr↔1fr trick (smooth, no fixed-height measuring) to
// match the reactive feel of the treemap hover; the chevron rotates in step.
export function CollapsibleHoldingsPanel({
  title,
  right,
  defaultCollapsed = true,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const regionId = useId();

  return (
    <section className="rounded-2xl border border-hairline bg-surface p-5 transition-colors hover:border-hairline-strong">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        aria-controls={regionId}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2">
          <svg
            viewBox="0 0 24 24"
            className={`h-3.5 w-3.5 shrink-0 text-faint transition-transform duration-200 ease-out ${collapsed ? '-rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{title}</span>
        </span>
        {right}
      </button>

      {/* grid-rows 0fr→1fr animates height without measuring; inner overflow-hidden clips during the
          transition, and the top margin lives inside it so it collapses away too. */}
      <div
        id={regionId}
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}
      >
        <div className="overflow-hidden">
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </section>
  );
}
