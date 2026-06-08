import Link from 'next/link';

const links = [
  { href: '/', label: 'Dashboard' },
  { href: '/queue', label: 'Priority Queue' },
  { href: '/ranking', label: 'Ranking' },
  { href: '/timeline', label: 'Timeline' },
  { href: '/wishlist', label: 'Wishlist' },
  { href: '/history', label: 'History' },
  { href: '/wealth', label: 'Wealth' },
  { href: '/simulator', label: 'Simulator' },
  { href: '/settings', label: 'Settings' },
];

export function Nav() {
  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-hairline bg-surface/60 px-6 py-3 backdrop-blur">
      <span className="mr-4 font-semibold tracking-tight text-text">
        <span className="text-accent">₹</span> Priority Planner
      </span>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
