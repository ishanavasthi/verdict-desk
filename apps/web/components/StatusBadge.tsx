import { cn } from '@/lib/utils';
import { chipClass, type Outcome } from '@/lib/status';

/**
 * A small semantic status chip (pass/fail/warn/info/pending). Uses the shared
 * `.chip-*` utilities so pass-green / fail-red / warn-amber read consistently
 * in both themes. `dot` adds a leading status dot.
 */
export default function StatusBadge({
  outcome,
  children,
  dot = false,
  className,
}: {
  outcome: Outcome;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return <span className={cn('chip', chipClass(outcome), dot && 'chip-dot', className)}>{children}</span>;
}
