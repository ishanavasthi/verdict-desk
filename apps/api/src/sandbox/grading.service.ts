import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubmissionStatus, TestCase, TestResultStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SandboxRunnerService } from './runner.service';
import { HarnessCaseResult, computeScore, computeSubmissionStatus, computeVerdict } from './grading-logic';

const DEFAULT_PER_CASE_TIMEOUT_MS = 5000;

interface ParsedHarnessOutput {
  submissionId?: string;
  results?: HarnessCaseResult[];
  fatal?: boolean;
  message?: string;
}

/**
 * Orchestrates end-to-end grading of one submission: run all cases in the
 * hardened sandbox (via `SandboxRunnerService.runSubmission`), interpret the
 * harness's capped JSON output, compute verdicts/score (pure logic in
 * `grading-logic.ts`), and persist everything in a single transaction.
 */
@Injectable()
export class GradingService {
  private readonly logger = new Logger(GradingService.name);
  private readonly perCaseTimeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: SandboxRunnerService,
    private readonly config: ConfigService,
  ) {
    const configured = Number(this.config.get<string>('GRADING_PER_CASE_TIMEOUT_MS'));
    this.perCaseTimeoutMs =
      Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_PER_CASE_TIMEOUT_MS;
  }

  async grade(submissionId: string): Promise<void> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { problem: { include: { testCases: { orderBy: { ordering: 'asc' } } } } },
    });

    if (!submission) {
      this.logger.error(`grade() called for unknown submission ${submissionId}`);
      return;
    }

    await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status: SubmissionStatus.RUNNING },
    });

    const testCases = submission.problem.testCases;
    const cases = testCases.map((tc) => ({ id: tc.id, input: tc.input }));

    let runResult;
    try {
      runResult = await this.runner.runSubmission({
        submissionId,
        code: submission.code,
        cases,
        perCaseTimeoutMs: this.perCaseTimeoutMs,
      });
    } catch (err) {
      await this.markInfraError(
        submissionId,
        testCases,
        `sandbox run threw: ${(err as Error).message}`,
      );
      return;
    }

    let infraErrorMessage: string | undefined;
    let parsed: ParsedHarnessOutput | undefined;

    if (runResult.stdoutTruncated) {
      // Never coerce truncation into a pass — the JSON may be malformed/incomplete.
      infraErrorMessage = 'harness stdout exceeded the host cap (truncated) — grading aborted';
    } else if (runResult.timedOut) {
      infraErrorMessage = 'grading container exceeded the outer wall-clock timeout';
    } else {
      try {
        parsed = JSON.parse(runResult.rawStdout) as ParsedHarnessOutput;
      } catch (err) {
        infraErrorMessage = `failed to parse harness output as JSON: ${(err as Error).message}`;
      }
      if (!infraErrorMessage && parsed?.fatal) {
        infraErrorMessage = `harness reported a fatal error: ${parsed.message ?? 'unknown'}`;
      }
    }

    if (infraErrorMessage) {
      await this.markInfraError(submissionId, testCases, infraErrorMessage);
      return;
    }

    const resultsById = new Map((parsed?.results ?? []).map((r) => [r.id, r]));
    const verdicts = testCases.map((tc) =>
      computeVerdict(
        { id: tc.id, expectedOutput: tc.expectedOutput, weight: tc.weight },
        resultsById.get(tc.id),
      ),
    );
    const score = computeScore(
      verdicts,
      testCases.map((tc) => ({ id: tc.id, expectedOutput: tc.expectedOutput, weight: tc.weight })),
    );
    const status = computeSubmissionStatus(verdicts, false);

    await this.prisma.$transaction([
      ...verdicts.map((v) =>
        this.prisma.testResult.create({
          data: {
            submissionId,
            testCaseId: v.testCaseId,
            status: v.status as TestResultStatus,
            stdout: v.stdout,
            stderr: v.stderr,
            timeMs: Math.round(v.timeMs),
          },
        }),
      ),
      this.prisma.submission.update({
        where: { id: submissionId },
        data: { status: status as SubmissionStatus, score },
      }),
    ]);
  }

  private async markInfraError(
    submissionId: string,
    testCases: Pick<TestCase, 'id'>[],
    diagnostic: string,
  ): Promise<void> {
    this.logger.error(`submission ${submissionId} infra error: ${diagnostic}`);
    const shortDiagnostic = diagnostic.slice(0, 4000);

    await this.prisma.$transaction([
      ...testCases.map((tc) =>
        this.prisma.testResult.create({
          data: {
            submissionId,
            testCaseId: tc.id,
            status: TestResultStatus.ERROR,
            stdout: '',
            stderr: shortDiagnostic,
            timeMs: 0,
          },
        }),
      ),
      this.prisma.submission.update({
        where: { id: submissionId },
        data: { status: SubmissionStatus.ERROR, score: 0 },
      }),
    ]);
  }
}
