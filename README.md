# verdict-desk

AI-powered code grading & doubt-resolution portal. Students submit code that is graded against test cases
in a **hardened Docker sandbox**, receive **AI code-quality feedback**, and post doubts to a board where an
**AI drafts answers that a teacher must review** (draft → pending → approved) before other students see them.

> **Status:** M0 (walking skeleton + hardened-sandbox and LLM integration spikes). See milestones below.

## Stack

- **Monorepo** (pnpm workspaces): `apps/web` (Next.js App Router) + `apps/api` (NestJS).
- **PostgreSQL + Prisma.** The answer approval workflow is enforced by **database triggers**, not just app code.
- **Docker-per-submission sandbox.** The API runs on the host and shells out to `docker`; it is intentionally
  **not** containerized (it needs the host Docker socket).
- **LLM:** NVIDIA NIM (OpenAI-compatible) via LangChain. `MOCK_LLM=1` makes every AI feature work with no key.

## Prerequisites

- Node ≥ 20 (developed on 26; a `.nvmrc` pins 20 for CI parity)
- pnpm 9 (`npm i -g pnpm@9` if missing)
- Docker (Docker Desktop or OrbStack) running

## Quick start

```bash
cp .env.example .env      # defaults work out of the box (MOCK_LLM=1, no key needed)
make dev                  # installs, starts Postgres, migrates, seeds, runs web + api
```

Then open http://localhost:3000. The API is at http://localhost:4000 (proxied via `/api/*`).

## Milestones

- **M0** — Skeleton + scary integrations: walking skeleton (page → API → DB), hardened-container hello-world,
  LLM call (MOCK_LLM + live-capable client). ← current
- M1 — Sandbox + grading engine
- M2 — Student flows in UI
- M3 — AI feedback + validation
- M4 — Doubt board + state machine + review
- M5 — Hardening + docs (threat model, flag rationale)

<!-- The threat model / security rationale, sandbox flag table, injection defenses, and the
     Postgres-vs-MERN justification land here in M5. -->
