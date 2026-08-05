import Link from 'next/link';
import PageShell from '@/components/PageShell';
import { Button } from '@/components/ui/button';

/**
 * Shown by `notFound()` (problem/doubt/submission pages call it for an id that
 * doesn't exist, isn't yours, or is malformed) and for any unmatched route.
 * Without this file those land on Next's stock unstyled 404 with no way back
 * into the app — the header still renders (it's in the layout), but the page
 * itself should offer the way out.
 */
export default function NotFound() {
  return (
    <PageShell
      eyebrow="No such case"
      title="Not found"
      description="This page doesn't exist — or it belongs to someone else's docket."
    >
      <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Check the address, or head back to the problem list.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button size="sm" nativeButton={false} render={<Link href="/" />}>
            Problems
          </Button>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/doubts" />}>
            Doubts
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
