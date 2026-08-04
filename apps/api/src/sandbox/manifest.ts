/**
 * Builds the manifest written to `<hostTmpDir>/manifest.json`, which is mounted
 * read-only into the container at `/work/manifest.json` and read by
 * `harness.js`. Kept as a pure function (no side effects) so it's unit
 * testable without Docker.
 *
 * SECURITY: the manifest deliberately carries ONLY `{ id, input }` per case —
 * never `expectedOutput`, `weight`, or `hidden`. The container must not be
 * able to read its own answer key. `buildManifest` enforces this structurally
 * by re-mapping each case to exactly `{ id, input }`, so passing a richer
 * object (e.g. a full Prisma `TestCase`) as `cases` can never leak extra
 * fields into the manifest.
 */
export interface ManifestCase {
  id: string;
  input: string;
}

export interface SandboxManifest {
  submissionId: string;
  perCaseTimeoutMs: number;
  maxCaseStdoutBytes: number;
  maxCaseStderrBytes: number;
  cases: ManifestCase[];
}

export const DEFAULT_MAX_CASE_STDOUT_BYTES = 64 * 1024; // 64 KiB
export const DEFAULT_MAX_CASE_STDERR_BYTES = 8 * 1024; // 8 KiB

export interface BuildManifestInput {
  submissionId: string;
  perCaseTimeoutMs: number;
  /**
   * Accepts anything STRUCTURALLY compatible with `{id, input}` — a richer
   * type (e.g. a full Prisma `TestCase` with expectedOutput/weight/hidden) is
   * fine to pass in, since `buildManifest` always re-maps to exactly
   * `{id, input}` below; extra fields never reach the output.
   */
  cases: ReadonlyArray<{ id: string; input: string }>;
  maxCaseStdoutBytes?: number;
  maxCaseStderrBytes?: number;
}

export function buildManifest(input: BuildManifestInput): SandboxManifest {
  return {
    submissionId: input.submissionId,
    perCaseTimeoutMs: input.perCaseTimeoutMs,
    maxCaseStdoutBytes: input.maxCaseStdoutBytes ?? DEFAULT_MAX_CASE_STDOUT_BYTES,
    maxCaseStderrBytes: input.maxCaseStderrBytes ?? DEFAULT_MAX_CASE_STDERR_BYTES,
    // Re-map (not spread) each case to strictly {id, input} — this is the
    // least-privilege guarantee: expectedOutput/weight/hidden can NEVER leak.
    cases: input.cases.map((c) => ({ id: c.id, input: c.input })),
  };
}
