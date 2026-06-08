import Link from 'next/link';

const links = [
  { href: '/', label: 'Dashboard' },
  { href: '/queue', label: 'Priority Queue' },
  { href: '/ranking', label: 'Ranking' },
  { href: '/timeline', label: 'Timeline' },
  { href: '/wishlist', label: 'Wishlist' },
  { href: '/history', label: 'History' },
  { href: '/simulator', label: 'Simulator' },
  { href: '/settings', label: 'Settings' },
];

export function Nav() {
  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-gray-200 bg-white px-6 py-3">
      <span className="mr-4 font-bold text-gray-900">₹ Priority Planner</span>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
