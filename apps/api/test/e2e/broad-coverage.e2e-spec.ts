import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/all-exceptions.filter';

/**
 * M6 e2e broadening — extends happy-path.e2e-spec.ts's real-app/real-DB
 * coverage with the flows that spec deliberately left out: teacher review
 * (approve AND reject), rate limiting, input caps, MCQ/INTEGER objective
 * grading, and AI-feedback regeneration.
 *
 * Same run prerequisites as happy-path.e2e-spec.ts:
 *   docker compose up -d --wait db
 *   pnpm --filter @verdict/api prisma:deploy
 *   pnpm --filter @verdict/api seed
 *   MOCK_LLM=1 pnpm --filter @verdict/api test:e2e
 *
 * Self-contained/re-runnable: every extra user this file needs is created
 * directly via Prisma with a run-unique email (upsert-safe), never assuming
 * an empty DB.
 */

const STUDENT_CREDENTIALS = { email: 'student@verdict.dev', password: 'password' };
const TEACHER_CREDENTIALS = { email: 'teacher@verdict.dev', password: 'password' };
const EXTRA_PASSWORD = 'password';

// Same "Sum of Two Numbers" solution used by happy-path.e2e-spec.ts.
const CORRECT_SUM_SOLUTION =
  'const chunks=[];process.stdin.on("data",d=>chunks.push(d));process.stdin.on("end",()=>{' +
  'const nums=Buffer.concat(chunks).toString("utf8").split("\\n").map(l=>l.trim())' +
  '.filter(l=>l.length>0).map(Number);process.stdout.write(String(nums[0]+nums[1])+"\\n");});';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil<T>(
  poll: () => Promise<T>,
  isDone: (value: T) => boolean,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 30_000, intervalMs = 500 } = opts;
  const deadline = Date.now() + timeoutMs;
  let last: T = await poll();
  while (!isDone(last) && Date.now() < deadline) {
    await sleep(intervalMs);
    last = await poll();
  }
  return last;
}

describe('M6 e2e broadened coverage (real app + real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const runId = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

  // POST /auth/login is throttled per client IP (DEFAULT_LOGIN_PER_MIN = 10,
  // see rate-limit.config.ts), and every login in this in-process suite
  // shares one IP against one in-memory ThrottlerStorage — regardless of
  // which account logs in. So the seeded student/teacher log in ONCE here
  // and their authenticated agents are reused by every describe below,
  // keeping this file's total real login count comfortably under the limit
  // ahead of the dedicated rate-limit spec (which deliberately bursts past it).
  let student: ReturnType<typeof request.agent>;
  let teacher: ReturnType<typeof request.agent>;

  /** Creates (upsert-safe) a STUDENT user directly via Prisma with a run-unique email. */
  async function makeStudent(tag: string): Promise<{ email: string; password: string }> {
    const email = `m6-${tag}-${runId}@verdict.dev`;
    const passwordHash = await bcrypt.hash(EXTRA_PASSWORD, 10);
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, passwordHash, role: Role.STUDENT, name: `M6 ${tag}` },
    });
    return { email, password: EXTRA_PASSWORD };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = new PrismaClient();

    const server = app.getHttpServer();
    student = request.agent(server);
    teacher = request.agent(server);
    await student.post('/auth/login').send(STUDENT_CREDENTIALS).expect(200);
    await teacher.post('/auth/login').send(TEACHER_CREDENTIALS).expect(200);
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('teacher review: approve', () => {
    it('AI draft -> PENDING_REVIEW (hidden from a second student) -> teacher approves -> visible to a second student', async () => {
      const server = app.getHttpServer();
      const other = request.agent(server);
      const otherCreds = await makeStudent('review-approve-other');
      await other.post('/auth/login').send(otherCreds).expect(200);

      const doubtRes = await student
        .post('/doubts')
        .send({ title: `Approve-flow doubt ${runId}`, body: 'Why does my loop never terminate?' })
        .expect(201);
      const doubtId = doubtRes.body.id;

      const withDraft = await pollUntil(
        async () => (await student.get(`/doubts/${doubtId}`).expect(200)).body,
        (d) => d.answers.some((a: any) => a.authorType === 'AI' && a.state === 'PENDING_REVIEW'),
      );
      const draftAnswer = withDraft.answers.find(
        (a: any) => a.authorType === 'AI' && a.state === 'PENDING_REVIEW',
      );
      expect(draftAnswer).toBeDefined();

      // While pending, a non-author, non-teacher student sees no answers at all.
      const otherWhilePending = await other.get(`/doubts/${doubtId}`).expect(200);
      expect(otherWhilePending.body.answers.some((a: any) => a.id === draftAnswer.id)).toBe(false);

      await teacher.post(`/answers/${draftAnswer.id}/approve`).send({}).expect(200);

      const otherAfterApproval = await other.get(`/doubts/${doubtId}`).expect(200);
      const seen = otherAfterApproval.body.answers.find((a: any) => a.id === draftAnswer.id);
      expect(seen).toBeDefined();
      expect(seen.state).toBe('APPROVED');
    });
  });

  describe('teacher review: reject with reason', () => {
    it('teacher rejects with a reason -> author sees REJECTED + reviewNote; a second student sees nothing', async () => {
      const server = app.getHttpServer();
      const other = request.agent(server);
      const otherCreds = await makeStudent('review-reject-other');
      await other.post('/auth/login').send(otherCreds).expect(200);

      const doubtRes = await student
        .post('/doubts')
        .send({ title: `Reject-flow doubt ${runId}`, body: 'My binary search off-by-one — why?' })
        .expect(201);
      const doubtId = doubtRes.body.id;

      const withDraft = await pollUntil(
        async () => (await student.get(`/doubts/${doubtId}`).expect(200)).body,
        (d) => d.answers.some((a: any) => a.authorType === 'AI' && a.state === 'PENDING_REVIEW'),
      );
      const draftAnswer = withDraft.answers.find(
        (a: any) => a.authorType === 'AI' && a.state === 'PENDING_REVIEW',
      );
      expect(draftAnswer).toBeDefined();

      const REASON = 'This draft misidentifies the failing edge case — rejecting for now.';
      await teacher.post(`/answers/${draftAnswer.id}/reject`).send({ reason: REASON }).expect(200);

      const authorView = await student.get(`/doubts/${doubtId}`).expect(200);
      const rejected = authorView.body.answers.find((a: any) => a.id === draftAnswer.id);
      expect(rejected).toBeDefined();
      expect(rejected.state).toBe('REJECTED');
      expect(rejected.reviewNote).toBe(REASON);

      const otherView = await other.get(`/doubts/${doubtId}`).expect(200);
      expect(otherView.body.answers.some((a: any) => a.id === draftAnswer.id)).toBe(false);
    });
  });

  describe('input caps', () => {
    it('rejects code over 64KB with 400', async () => {
      const problemsRes = await student.get('/problems').expect(200);
      const problem = problemsRes.body.find((p: { title: string }) => p.title === 'Sum of Two Numbers');
      expect(problem).toBeDefined();

      const oversizedCode = 'a'.repeat(64 * 1024 + 1);
      await student.post('/submissions').send({ problemId: problem.id, code: oversizedCode }).expect(400);
    });

    it('rejects a doubt title over 200 chars with 400', async () => {
      const oversizedTitle = 'x'.repeat(201);
      await student
        .post('/doubts')
        .send({ title: oversizedTitle, body: 'body text' })
        .expect(400);
    });
  });

  describe('MCQ/INTEGER objective grading', () => {
    it('grades MCQ instantly and never leaks answerKey in raw responses', async () => {
      const problemsRes = await student.get('/problems').expect(200);
      const mcq = problemsRes.body.find((p: { title: string }) => p.title === 'Docker Network Isolation');
      expect(mcq).toBeDefined();

      const detailRes = await student.get(`/problems/${mcq.id}`).expect(200);
      expect(JSON.stringify(detailRes.body)).not.toContain('answerKey');

      // Correct option (seeded answerKey: 'a').
      const correctRes = await student
        .post('/submissions')
        .send({ problemId: mcq.id, code: 'a' })
        .expect(201);
      expect(correctRes.body.status).toBe('PASSED');
      const correctView = await student.get(`/submissions/${correctRes.body.id}`).expect(200);
      expect(correctView.body.score).toBe(100);
      expect(correctView.body.feedbackStatus).toBe('SKIPPED');
      expect(JSON.stringify(correctView.body)).not.toContain('answerKey');

      // Wrong option.
      const wrongRes = await student
        .post('/submissions')
        .send({ problemId: mcq.id, code: 'b' })
        .expect(201);
      expect(wrongRes.body.status).toBe('FAILED');
      const wrongView = await student.get(`/submissions/${wrongRes.body.id}`).expect(200);
      expect(wrongView.body.score).toBe(0);
      expect(wrongView.body.feedbackStatus).toBe('SKIPPED');

      // Malformed option id.
      await student.post('/submissions').send({ problemId: mcq.id, code: 'not-a-real-option' }).expect(400);
    });

    it('grades INTEGER answers instantly', async () => {
      const problemsRes = await student.get('/problems').expect(200);
      const integer = problemsRes.body.find(
        (p: { title: string }) => p.title === 'Complete Binary Tree Nodes',
      );
      expect(integer).toBeDefined();

      // Seeded answerKey: '31'.
      const correctRes = await student
        .post('/submissions')
        .send({ problemId: integer.id, code: '31' })
        .expect(201);
      expect(correctRes.body.status).toBe('PASSED');

      const wrongRes = await student
        .post('/submissions')
        .send({ problemId: integer.id, code: '30' })
        .expect(201);
      expect(wrongRes.body.status).toBe('FAILED');

      // Malformed (not an integer).
      await student.post('/submissions').send({ problemId: integer.id, code: 'thirty-one' }).expect(400);
    });
  });

  describe('AI feedback regeneration', () => {
    it('regenerates FLAGGED feedback to READY; rejects when already READY; 404s for a non-owner', async () => {
      const server = app.getHttpServer();
      const other = request.agent(server);
      const otherCreds = await makeStudent('regen-other');
      await other.post('/auth/login').send(otherCreds).expect(200);

      const problemsRes = await student.get('/problems').expect(200);
      const problem = problemsRes.body.find((p: { title: string }) => p.title === 'Sum of Two Numbers');
      expect(problem).toBeDefined();

      const createRes = await student
        .post('/submissions')
        .send({ problemId: problem.id, code: CORRECT_SUM_SOLUTION })
        .expect(201);
      const submissionId = createRes.body.id;

      // Wait for grading + mock AI feedback to land as READY.
      const ready = await pollUntil(
        async () => (await student.get(`/submissions/${submissionId}`).expect(200)).body,
        (s) => s.feedbackStatus === 'READY' || s.feedbackStatus === 'FAILED',
        { timeoutMs: 60_000, intervalMs: 1_000 },
      );
      expect(ready.feedbackStatus).toBe('READY');

      // Force it into FLAGGED directly, bypassing the LLM, per task instructions.
      await prisma.aiFeedback.update({
        where: { submissionId },
        data: { validationStatus: 'FLAGGED' },
      });
      const flagged = await student.get(`/submissions/${submissionId}`).expect(200);
      expect(flagged.body.feedbackStatus).toBe('FAILED');

      // Non-owner gets 404 (existence never leaked).
      await other.post(`/submissions/${submissionId}/feedback/regenerate`).expect(404);

      const regenRes = await student.post(`/submissions/${submissionId}/feedback/regenerate`).expect(202);
      expect(regenRes.body.feedbackStatus).toBe('PENDING');

      const regenerated = await pollUntil(
        async () => (await student.get(`/submissions/${submissionId}`).expect(200)).body,
        (s) => s.feedbackStatus === 'READY' || s.feedbackStatus === 'FAILED',
        { timeoutMs: 30_000, intervalMs: 500 },
      );
      expect(regenerated.feedbackStatus).toBe('READY');

      // Already READY -> 409.
      await student.post(`/submissions/${submissionId}/feedback/regenerate`).expect(409);
    });
  });

  // MUST run last in this file: /auth/login is throttled by client IP (no
  // req.user exists yet at login time — see RateLimitGuard), and this
  // in-process app's ThrottlerStorage is in-memory and shared across every
  // `it` in this file. Bursting it here would 429 any login attempted by a
  // later test in this same file, regardless of which user logs in.
  describe('rate limiting: /auth/login', () => {
    it('bursts past the 10/min login limit and gets a 429', async () => {
      const creds = await makeStudent('ratelimit');
      const server = app.getHttpServer();

      let sawTooManyRequests = false;
      for (let i = 0; i < 15; i++) {
        // eslint-disable-next-line no-await-in-loop
        const res = await request(server).post('/auth/login').send(creds);
        if (res.status === 429) {
          sawTooManyRequests = true;
          break;
        }
        expect(res.status).toBe(200);
      }
      expect(sawTooManyRequests).toBe(true);
    });
  });
});
