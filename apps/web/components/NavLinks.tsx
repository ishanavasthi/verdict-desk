'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role } from '@/lib/api';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/', label: 'Problems', match: (p: string) => p === '/' || p.startsWith('/problems') },
  { href: '/history', label: 'History', match: (p: string) => p.startsWith('/history') || p.startsWith('/submissions') },
  { href: '/doubts', label: 'Doubts', match: (p: string) => p.startsWith('/doubts') },
] as const;

/**
 * Primary nav, shown in the header of every authed page. "Review" is
 * teacher-only. The active section gets a brass underline — the bench marker.
 */
export default function NavLinks({ role }: { role: Role }) {
  const pathname = usePathname();
  const links =
    role === 'TEACHER'
      ? [...LINKS, { href: '/review', label: 'Review', match: (p: string) => p.startsWith('/review') }]
      : LINKS;

  return (
    <nav className="flex items-center gap-1" aria-label="Primary">
      {links.map((link) => {
        const active = link.match(pathname);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {link.label}
            {active && (
              <span className="absolute inset-x-2.5 -bottom-[7px] h-0.5 rounded-full bg-primary" aria-hidden="true" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
