import Link from 'next/link';
import type { Role } from '../lib/api';

/**
 * Shared primary nav — used in the header of every authed page (home,
 * doubts, review, …). "Review queue" only shows for teachers.
 * Pure presentational (no hooks/client APIs), so it renders fine inside
 * Server Components too.
 */
export default function NavLinks({ role }: { role: Role }) {
  return (
    <nav className="nav-links" aria-label="Primary">
      <Link href="/" className="nav-link">
        Problems
      </Link>
      <Link href="/history" className="nav-link">
        History
      </Link>
      <Link href="/doubts" className="nav-link">
        Doubts
      </Link>
      {role === 'TEACHER' && (
        <Link href="/review" className="nav-link">
          Review queue
        </Link>
      )}
    </nav>
  );
}
