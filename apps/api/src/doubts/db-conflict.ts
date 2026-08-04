/**
 * PURE, network/DB-free classifier for the two failure modes a guarded CAS
 * write against the `answers` table can hit, both of which must map to HTTP
 * 409 (never 500):
 *   1. The CAS predicate matched zero rows (state already moved — handled by
 *      the caller checking `updateMany(...).count === 0`, not this function).
 *   2. The Postgres trigger itself rejected the write (`answers_insert_guard_trg`
 *      / `answers_transition_guard_trg` RAISE EXCEPTION ... USING ERRCODE =
 *      'check_violation'`, SQLSTATE 23514). Prisma can surface this either as
 *      a `PrismaClientKnownRequestError` (code P2010, "raw query failed" —
 *      the fallback code Prisma uses for an unrecognized DB error) or as a
 *      plain Error/PrismaClientUnknownRequestError whose message contains
 *      the raw Postgres error text. This function recognizes both shapes by
 *      duck-typing rather than importing Prisma's error classes, so it's
 *      trivially unit-testable with synthetic errors.
 */
export function isTriggerGuardError(err: unknown): boolean {
  const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined;
  if (code === 'P2010') return true;

  const message = errorMessage(err);
  return /illegal answer (insert|state transition)|check_violation|\b23514\b/i.test(message);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
}
