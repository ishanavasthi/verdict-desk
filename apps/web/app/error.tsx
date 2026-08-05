'use client';

import Link from 'next/link';
import PageShell from '@/components/PageShell';
import { Button } from '@/components/ui/button';

/**
 * Route-level error boundary. Without it, an unhandled throw in any server
 * component (most likely: the API went away mid-render) drops the user on
 * Next's stock error page with no navigation.
 *
 * `error.message` is deliberately NOT rendered: in production Next replaces it
 * with a digest anyway, and echoing a server-side failure string to the browser
 * is the same mistake the API's exception filter exists to prevent.
 */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageShell
      eyebrow="Mistrial"
      title="Something went wrong"
      description="The page couldn't be rendered. This is usually the API being unreachable."
    >
      <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Try again — if it keeps failing, check that the API is running (
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">make dev</code>).
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button size="sm" onClick={reset}>
            Try again
          </Button>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/" />}>
            Problems
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
