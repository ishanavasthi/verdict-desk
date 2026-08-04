import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/all-exceptions.filter';

/**
 * M5 e2e happy-path test — the ONE deliberately-real test in this repo: real
 * Nest app, real Postgres (via Prisma/`DATABASE_URL`), real Docker grading
 * sandbox. Deliberately kept OUT of the default `pnpm test` (DB/Docker/
 * network-free, see ../../jest.config.js) via its own jest config and the
 * separate `test:e2e` package.json script — see that script for the exact
 * prerequisites.
 *
 * How to run:
 *   docker compose up -d --wait db
 *   pnpm --filter @verdict/api prisma:deploy
 *   pnpm --filter @verdict/api seed
 *   MOCK_LLM=1 pnpm --filter @verdict/api test:e2e
 *
 * Covers, against the real seeded data (see prisma/seed.ts):
 *   1. login as the seeded student
 *   2. POST /submissions a correct solution to "Sum of Two Numbers"
 *   3. poll GET /submissions/:id to a terminal status; assert PASSED/100 AND
 *      that hidden test cases are redacted (no stdout/stderr/timeMs)
 *   4. POST /doubts, then poll GET /doubts/:id until the fire-and-forget AI
 *      draft pipeline (MOCK_LLM=1, no network) lands a PENDING_REVIEW answer
 *   5. login as the seeded teacher, approve the draft (with an edit)
 *   6. confirm the approved+edited answer is visible with the correct
 *      content, and the raw pre-edit AI draft is redacted from the response
 */

const STUDENT_CREDENTIALS = { email: 'student@verdict.dev', password: 'password' };
const TEACHER_CREDENTIALS = { email: 'teacher@verdict.dev', password: 'password' };

// Same "Sum of Two Numbers" solution used by scripts/abuse-demo.sh's case 1:
// reads two newline-separated integers from stdin, prints their sum.
const CORRECT_SUM_SOLUTION =
  'const chunks=[];process.stdin.on("data",d=>chunks.push(d));process.stdin.on("end",()=>{' +
  'const nums=Buffer.concat(chunks).toString("utf8").split("\\n").map(l=>l.trim())' +
  '.filter(l=>l.length>0).map(Number);process.stdout.write(String(nums[0]+nums[1])+"\\n");});';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `poll()` until `isDone()` is true or `timeoutMs` elapses; returns the last observed value either way. */
async function pollUntil<T>(
  poll: () => Promise<T>,
  isDone: (value: T) => boolean,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 90_000, intervalMs = 1_000 } = opts;
  const deadline = Date.now() + timeoutMs;
  let last: T = await poll();
  while (!isDone(last) && Date.now() < deadline) {
    await sleep(intervalMs);
    last = await poll();
  }
  return last;
}

describe('M5 e2e happy path (real app + real Postgres + real Docker sandbox)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Mirror src/main.ts's bootstrap exactly (cookie parsing, validation, the
    // uniform error envelope) so this test exercises the same request
    // pipeline production traffic does.
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('grades a correct submission end-to-end (with hidden-case redaction), then takes a doubt through AI draft -> teacher approval -> visible', async () => {
    const server = app.getHttpServer();
    // Independent cookie jars per role — mirrors two separate browser sessions.
    const student = request.agent(server);
    const teacher = request.agent(server);

    // ---- 1. Log in as the seeded student ----
    const studentLogin = await student.post('/auth/login').send(STUDENT_CREDENTIALS).expect(200);
    expect(studentLogin.body.email).toBe(STUDENT_CREDENTIALS.email);
    expect(studentLogin.body.role).toBe('STUDENT');

    // ---- 2. Find the seeded "Sum of Two Numbers" problem ----
    const problemsRes = await student.get('/problems').expect(200);
    const problem = problemsRes.body.find((p: { title: string }) => p.title === 'Sum of Two Numbers');
    expect(problem).toBeDefined();

    // ---- 3. Submit a correct solution ----
    const createRes = await student
      .post('/submissions')
      .send({ problemId: problem.id, code: CORRECT_SUM_SOLUTION })
      .expect(201);
    const submissionId = createRes.body.id;
    expect(submissionId).toBeDefined();
    expect(createRes.body.status).toBe('QUEUED');

    // ---- 4. Poll GET /submissions/:id to a terminal status ----
    const graded = await pollUntil(
      async () => (await student.get(`/submissions/${submissionId}`).expect(200)).body,
      (s) => s.status === 'PASSED' || s.status === 'FAILED' || s.status === 'ERROR',
    );
    expect(graded.status).toBe('PASSED');
    expect(graded.score).toBe(100);

    // Hidden-case redaction (see src/submissions/redact-results.ts): a hidden
    // row is ONLY {testCaseId, status, hidden:true} — stdout/stderr/timeMs
    // must be entirely absent, never null/empty-string. A visible row keeps
    // the full shape. "Sum of Two Numbers" seeds both kinds.
    const hiddenResults = graded.results.filter((r: any) => r.hidden === true);
    const visibleResults = graded.results.filter((r: any) => r.hidden === false);
    expect(hiddenResults.length).toBeGreaterThan(0);
    expect(visibleResults.length).toBeGreaterThan(0);
    for (const r of hiddenResults) {
      expect(r).not.toHaveProperty('stdout');
      expect(r).not.toHaveProperty('stderr');
      expect(r).not.toHaveProperty('timeMs');
    }
    for (const r of visibleResults) {
      expect(r).toHaveProperty('stdout');
      expect(r).toHaveProperty('stderr');
      expect(r).toHaveProperty('timeMs');
    }

    // ---- 5. Post a doubt (MOCK_LLM=1 so the AI draft pipeline runs with no network call) ----
    const doubtRes = await student
      .post('/doubts')
      .send({
        problemId: problem.id,
        title: 'Why is my sum solution failing?',
        body: 'I keep summing the wrong two lines from stdin — what am I doing wrong?',
      })
      .expect(201);
    const doubtId = doubtRes.body.id;
    expect(doubtId).toBeDefined();

    // ---- 6. Poll the doubt until the fire-and-forget AI draft pipeline lands a PENDING_REVIEW AI answer ----
    const withDraft = await pollUntil(
      async () => (await student.get(`/doubts/${doubtId}`).expect(200)).body,
      (d) => d.answers.some((a: any) => a.authorType === 'AI' && a.state === 'PENDING_REVIEW'),
      { timeoutMs: 30_000, intervalMs: 500 },
    );
    const draftAnswer = withDraft.answers.find((a: any) => a.authorType === 'AI' && a.state === 'PENDING_REVIEW');
    expect(draftAnswer).toBeDefined();
    expect(typeof draftAnswer.content).toBe('string');
    expect(draftAnswer.content.length).toBeGreaterThan(0);

    // ---- 7. Log in as the seeded teacher; the draft shows up in their review queue ----
    const teacherLogin = await teacher.post('/auth/login').send(TEACHER_CREDENTIALS).expect(200);
    expect(teacherLogin.body.role).toBe('TEACHER');

    const queueRes = await teacher.get('/review/queue').expect(200);
    expect(queueRes.body.some((item: any) => item.id === draftAnswer.id)).toBe(true);

    // ---- 8. Approve it, WITH an edit (also exercises pre-edit-content redaction) ----
    const APPROVED_TEXT =
      'Vetted answer: check that you are reading the two numbers in the order given, not reversed.';
    const approveRes = await teacher
      .post(`/answers/${draftAnswer.id}/approve`)
      .send({ editedContent: APPROVED_TEXT })
      .expect(200);
    expect(approveRes.body).toEqual({ id: draftAnswer.id, state: 'APPROVED' });

    // ---- 9. Confirm the approved+edited answer is now visible with the vetted content — the ----
    //         raw pre-edit AI draft must NOT reach the response (see DoubtsController.toDoubtView).
    const afterApproval = await student.get(`/doubts/${doubtId}`).expect(200);
    const approvedAnswer = afterApproval.body.answers.find((a: any) => a.id === draftAnswer.id);
    expect(approvedAnswer).toBeDefined();
    expect(approvedAnswer.state).toBe('APPROVED');
    expect(approvedAnswer.content).toBe(APPROVED_TEXT);
    expect(approvedAnswer.content).not.toBe(draftAnswer.content);
    expect(approvedAnswer.editedContent).toBeNull();
    expect(approvedAnswer.reviewedById).toBeDefined();
  });
});
