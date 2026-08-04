'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Header identity control: initials chip that opens a menu with the account + logout. */
export default function UserMenu({ email, role }: { email: string; role: Role }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const initials = email.slice(0, 2).toUpperCase();

  async function handleLogout() {
    setLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Best-effort: send the user to /login regardless.
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className="gap-2 px-1.5" aria-label="Account menu" />}
      >
        <span className="grid size-7 place-items-center rounded-full bg-primary font-mono text-xs font-semibold text-primary-foreground">
          {initials}
        </span>
        <span className="hidden max-w-[12ch] truncate text-sm text-muted-foreground sm:inline">{email}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-1.5">
          <span className="truncate font-normal">{email}</span>
          <Badge variant="outline" className="w-fit font-mono text-[0.65rem] uppercase tracking-wider">
            {role.toLowerCase()}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" disabled={loading} onClick={handleLogout}>
            {loading ? 'Signing out…' : 'Sign out'}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
