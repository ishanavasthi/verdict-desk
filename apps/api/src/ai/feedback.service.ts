import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from './llm.service';
import { validateFeedback } from './feedback-validation';
import { buildFeedbackPrompt, FeedbackPromptInput } from './feedback-prompt';

export const MAX_ATTEMPTS = 2;

/** Never store/surface unvalidated free-text as if it were structured feedback. */
const FALLBACK_CONTENT: Prisma.InputJsonValue = {
  note: 'AI feedback could not be validated',
};

/**
 * Generates AI code-quality feedback for a graded submission.
 *
 * Pipeline: load submission+problem+results -> build a prompt that wraps all
 * untrusted content (student code, program stdout/stderr) in clearly-labelled
 * UNTRUSTED DATA blocks (feedback-prompt.ts) -> call the LLM -> strip
 * markdown fences and validate against a strict Zod schema
 * (feedback-validation.ts). On validation failure, retry ONCE with the
 * validation error appended as corrective feedback. If the second attempt
 * also fails, flag the row for human review with a safe fallback content
 * (never persist/surface unvalidated free text as structured feedback).
 *
 * Upserts on `submissionId`, so calling this again for the same submission
 * (e.g. a manual re-run) simply overwrites the prior feedback row.
 */
@Injectable()
export class AiFeedbackService {
  private readonly logger = new Logger(AiFeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  async generateForSubmission(submissionId: string): Promise<void> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        problem: { select: { title: true, description: true } },
        testResults: {
          select: {
            testCaseId: true,
            status: true,
            stdout: true,
            stderr: true,
            testCase: { select: { hidden: true } },
          },
        },
      },
    });

    if (!submission) {
      this.logger.error(`generateForSubmission called for unknown submission ${submissionId}`);
      return;
    }

    const resultsSummary = submission.testResults.map((r) => ({
      testCaseId: r.testCaseId,
      status: r.status as string,
    }));
    // Never surface a HIDDEN case's stdout/stderr into a prompt whose output the
    // student ultimately sees — same principle as redact-results.ts.
    const visibleSample = submission.testResults.find((r) => !r.testCase.hidden);

    const promptInput: FeedbackPromptInput = {
      problemTitle: submission.problem.title,
      problemDescription: submission.problem.description,
      code: submission.code,
      language: submission.language as string,
      status: submission.status as string,
      score: submission.score,
      resultsSummary,
      sampleStdout: visibleSample?.stdout,
      sampleStderr: visibleSample?.stderr,
    };

    const modelName = this.llm.modelName;
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const prompt = buildFeedbackPrompt(
        attempt === 1 ? promptInput : { ...promptInput, correctiveError: lastError },
      );

      let raw: string;
      try {
        raw = await this.llm.chat(prompt);
      } catch (err) {
        lastError = `LLM call threw: ${(err as Error).message}`;
        this.logger.error(
          `AI feedback LLM call failed (attempt ${attempt}/${MAX_ATTEMPTS}) for submission ${submissionId}: ${lastError}`,
        );
        continue;
      }

      // Log the RAW LLM output server-side for every attempt (audit trail),
      // regardless of whether it validates.
      this.logger.log(
        `AI feedback raw LLM output (attempt ${attempt}/${MAX_ATTEMPTS}) for submission ${submissionId}: ${raw}`,
      );

      const validation = validateFeedback(raw);
      if (validation.ok) {
        await this.persist(submissionId, 'VALID', validation.value as unknown as Prisma.InputJsonValue, modelName);
        return;
      }

      lastError = validation.error;
      this.logger.warn(
        `AI feedback validation failed (attempt ${attempt}/${MAX_ATTEMPTS}) for submission ${submissionId}: ${lastError}`,
      );
    }

    // Both attempts failed validation (or the LLM call itself kept failing):
    // flag for human review instead of ever storing/surfacing unvalidated text.
    await this.persist(submissionId, 'FLAGGED', FALLBACK_CONTENT, modelName);
  }

  private async persist(
    submissionId: string,
    validationStatus: 'VALID' | 'FLAGGED',
    content: Prisma.InputJsonValue,
    model: string,
  ): Promise<void> {
    await this.prisma.aiFeedback.upsert({
      where: { submissionId },
      create: { submissionId, content, model, validationStatus },
      update: { content, model, validationStatus },
    });
  }
}
