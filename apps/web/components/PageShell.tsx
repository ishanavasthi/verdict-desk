import { cn } from '@/lib/utils';

/**
 * Standard centered page frame + heading used by every non-workspace page, so
 * spacing, width, and the eyebrow/title rhythm stay consistent across the app.
 */
export default function PageShell({
  eyebrow,
  title,
  description,
  actions,
  width = 'md',
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  width?: 'md' | 'lg';
  children: React.ReactNode;
}) {
  return (
    <main className={cn('mx-auto px-4 py-8 sm:px-6', width === 'lg' ? 'max-w-5xl' : 'max-w-3xl')}>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </main>
  );
}
