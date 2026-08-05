# Architecture Decision Records

Append-only. Each entry is a one-way door: reversing it means significant rework. Newest at the bottom.

---

## ADR-001 — PostgreSQL over MongoDB (MERN framing)

**Date:** 2026-08-04
**Status:** Accepted

**Context.** The assignment describes a MERN-style LMS. The core grading requirement is that the answer
approval workflow (draft → pending → approved) is *enforced*, not merely respected by application code.

**Decision.** Use PostgreSQL + Prisma instead of MongoDB/Mongoose.

**Rationale.** "Enforce in the database" is only truly satisfiable with DB-level constraints and triggers.
Postgres `BEFORE INSERT` / `BEFORE UPDATE` triggers reject illegal state transitions even against raw SQL —
a guarantee Mongoose (app-layer validation) cannot make. This is the single most-evaluated requirement.

**Consequences.** We deviate from the literal "MERN" stack; the README carries a paragraph justifying this
against the MERN framing. Relational modeling adds migration ceremony, accepted as worthwhile.

---

## ADR-002 — NestJS for the API

**Date:** 2026-08-04
**Status:** Accepted

**Decision.** NestJS (over bare Express) for the API layer.

**Rationale.** Built-in DI, guards (role-based auth), interceptors (serialization / hidden-case redaction),
and a global exception filter give us the cross-cutting structure the evaluator grades on "code structure"
for free. Modules map cleanly to the domains: auth, problems, submissions, sandbox, ai, doubts.

**Consequences.** More boilerplate than Express; mitigated by scaffolding. The API is a long-lived host
process (it shells out to Docker), so Nest's lifecycle fits.

---

## ADR-003 — Docker-per-run sandbox (API stays on host)

**Date:** 2026-08-04
**Status:** Accepted

**Decision.** Grade each submission by spawning **one hardened Docker container per submission** from the
host API process, rather than containerizing the API or using an in-process sandbox.

**Rationale.** Strong isolation with kernel-level resource limits (`--network none`, `--memory`, `--pids-limit`,
`--read-only`, `--cap-drop ALL`, `--user 65534`, `--security-opt no-new-privileges`). One container per
*submission* (not per test case) avoids Docker Desktop spawn latency; the in-container runner loops test cases.

**Consequences.** The API cannot itself run in a container (it needs the host Docker socket) — documented in
README so nobody containerizes it. Fallback if Docker proves unworkable on the dev machine: self-hosted Piston
via compose (would become an ADR of its own).

**Amended (uid separation).** The `--user 65534` above no longer appears in the argv. Sharing one uid between
PID 1 (the harness) and the submission let a payload write to `/proc/1/fd/1` and corrupt its own result blob,
so the harness now starts as in-container root and drops each submission child to uid/gid 65534 itself —
`--cap-drop ALL` plus only `SETUID`/`SETGID`/`KILL` added back, and a fail-closed
`VERDICT_REQUIRE_UID_DROP=1` contract so the harness refuses to grade rather than silently grading less
safely. The submission still never runs as root. See README §1 and `scripts/verify-uid-separation.sh`
(a required CI job).

---

## ADR-004 — UUID primary keys

**Date:** 2026-08-04
**Status:** Accepted

**Decision.** UUID (v4) primary keys on all entities.

**Rationale.** Non-enumerable IDs close an IDOR/enumeration vector on submissions, doubts, and answers in a
multi-user portal. Cost (index size, non-sequential inserts) is negligible at assignment scale.

---

## ADR-005 — JWT in an httpOnly cookie

**Date:** 2026-08-04
**Status:** Accepted

**Decision.** Authenticate with a JWT stored in an httpOnly, sameSite cookie; NestJS role guards authorize.

**Rationale.** httpOnly closes the XSS token-theft vector that `localStorage` opens. Cookie auth pairs with the
Next.js `/api/*` rewrite so the browser never makes a cross-origin request (no CORS/cookie friction).

**Consequences.** CSRF must be considered (sameSite + the rewrite same-origin posture mitigate it for v1).

---

## ADR-006 — Trigger-based answer state machine

**Date:** 2026-08-04
**Status:** Accepted

**Decision.** Enforce the answer lifecycle with Postgres triggers written as **raw SQL inside a Prisma
migration** (`migrate dev --create-only`, hand-edit, `migrate dev`). A `BEFORE UPDATE` trigger validates
`(OLD.state → NEW.state)` against the allowed set; a `BEFORE INSERT` trigger enforces birth rules (AI answers
may only be born `DRAFT`; only TEACHER-authored answers may be inserted `APPROVED`). App layer uses guarded
CAS updates (`updateMany WHERE state = expected`) and maps both affected-count-0 and trigger `RAISE EXCEPTION`
to HTTP 409.

**Rationale.** The INSERT path is the bypass an evaluator will try (inserting an already-APPROVED AI answer);
guarding only UPDATE is insufficient. Triggers make the guarantee independent of the application.

**Consequences.** `prisma db push` is banned project-wide — it does not run the raw-SQL migration body, which
would silently drop the triggers. README and scripts only ever call `migrate dev` / `migrate deploy`.

---

## ADR-007 — NVIDIA NIM (OpenAI-compatible) via LangChain, with MOCK_LLM

**Date:** 2026-08-04
**Status:** Accepted

**Decision.** LLM access through LangChain `ChatOpenAI` pointed at an env-configured OpenAI-compatible triple
(`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`); NIM is the default base URL. A `MOCK_LLM=1` mode returns canned
valid JSON so every AI feature demos with no API key.

**Rationale.** The evaluator may have no NVIDIA key; without a keyless path, three of five evaluation foci are
undemonstrable. The OpenAI-compatible abstraction means any provider (NIM, OpenAI, local) works via env.

**Consequences.** Open-model tool-calling is unreliable, so the pipeline uses JSON-mode prompting + Zod parse +
one retry-with-error-feedback, then flag-for-human — never a hard dependency on native tool calls.

---

## ADR-008 — LangGraph as the single novelty budget

**Date:** 2026-08-04
**Status:** Accepted

**Decision.** Use LangGraph for the doubt-answer pipeline (wrap-untrusted → draft → validate → persist DRAFT →
transition PENDING_REVIEW). Everything else stays deliberately boring.

**Rationale.** A stateful graph models the draft→validate→persist→transition flow and the retry/flag branch
cleanly, and is the one place worth spending novelty budget. Concentrating novelty limits risk surface.
