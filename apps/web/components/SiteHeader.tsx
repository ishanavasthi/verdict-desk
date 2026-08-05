import type { User } from '@/lib/api';
import Wordmark from './Wordmark';
import NavLinks from './NavLinks';
import UserMenu from './UserMenu';
import ThemeToggle from './theme-toggle';

/**
 * App-wide sticky header, rendered once in the root layout. When there's a
 * signed-in user it shows the primary nav + account menu; on the login screen
 * (no user) it collapses to just the wordmark + theme toggle.
 */
export default function SiteHeader({ user }: { user: User | null }) {
  return (
    <header className="sticky top-0 z-40 min-h-14 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-[1400px] items-center gap-4 px-4 sm:px-6">
        <Wordmark />
        {user && (
          <div className="hidden md:block">
            <NavLinks role={user.role} />
          </div>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          {user && <UserMenu email={user.email} role={user.role} />}
        </div>
      </div>
      {/* Mobile nav row */}
      {user && (
        <div className="border-t border-border/60 px-2 py-1.5 md:hidden">
          <NavLinks role={user.role} />
        </div>
      )}
    </header>
  );
}
