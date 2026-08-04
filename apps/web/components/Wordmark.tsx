import Link from 'next/link';

/**
 * The verdict-desk wordmark: a small brass gavel-mark set against the name in
 * the display face. `verdict` in brass, `-desk` muted — the judge, then the
 * bench it sits on.
 */
export default function Wordmark({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="group flex items-center gap-2" aria-label="verdict-desk home">
      <GavelMark className="size-5 text-primary transition-transform group-hover:-rotate-12" />
      <span className="font-heading text-[0.95rem] font-semibold tracking-tight">
        <span className="text-primary">verdict</span>
        <span className="text-muted-foreground">-desk</span>
      </span>
    </Link>
  );
}

function GavelMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m14.5 12.5-8 8a2.12 2.12 0 1 1-3-3l8-8" />
      <path d="m16 16 6-6" />
      <path d="m8 8 6-6" />
      <path d="m9 7 8 8" />
      <path d="m21 11-8-8" />
    </svg>
  );
}
