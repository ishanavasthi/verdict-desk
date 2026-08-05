'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * The seeded demo accounts (see apps/api/prisma/seed.ts), all sharing the
 * password below. Listed here so a reviewer can switch roles without digging
 * through the README — the second student exists specifically to show that an
 * unapproved answer stays invisible to students other than the asker.
 */
const DEMO_PASSWORD = 'password';
const DEMO_ACCOUNTS = [
  { email: 'student@verdict.dev', label: 'Student' },
  { email: 'student2@verdict.dev', label: 'Other student' },
  { email: 'teacher@verdict.dev', label: 'Teacher' },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('student@verdict.dev');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.push('/');
        router.refresh();
        return;
      }
      setError(res.status === 401 ? 'Invalid email or password.' : `Login failed (status ${res.status}). Please try again.`);
    } catch {
      setError('Could not reach the server. Is the API running?');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-sm flex-col justify-center px-4 py-10">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <p className="eyebrow mb-2">Enter the courtroom</p>
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Seeded accounts — password{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{DEMO_PASSWORD}</code>. Pick one to
          fill the form:
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {DEMO_ACCOUNTS.map((account) => (
            <Button
              key={account.email}
              type="button"
              variant={email === account.email ? 'secondary' : 'outline'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setEmail(account.email);
                setPassword(DEMO_PASSWORD);
              }}
            >
              {account.label}
            </Button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-md border px-3 py-2 text-sm"
              style={{
                borderColor: 'color-mix(in srgb, var(--fail) 35%, transparent)',
                background: 'color-mix(in srgb, var(--fail) 10%, transparent)',
                color: 'var(--fail)',
              }}
            >
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="mt-1 w-full gap-1.5">
            {submitting && <span className="spinner-on-primary" aria-hidden="true" />}
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </main>
  );
}
