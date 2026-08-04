import { AiFeedbackService } from '../src/ai/feedback.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { LlmService } from '../src/ai/llm.service';

const VALID_FEEDBACK = {
  summary: 'Clean, idiomatic solution.',
  severity: 'info',
  suggestions: [{ title: 'Add a comment', detail: 'Explain the edge case handling.' }],
};

const BASE_SUBMISSION = {
  id: 'sub-1',
  code: 'console.log(1 + 2)',
  language: 'JS',
  status: 'PASSED',
  score: 100,
  problem: { title: 'Sum of Two Numbers', description: 'Print the sum of two integers.' },
  testResults: [
    {
      testCaseId: 'tc-visible',
      status: 'PASS',
      stdout: 'VISIBLE_STDOUT_MARKER',
      stderr: '',
      testCase: { hidden: false },
    },
    {
      testCaseId: 'tc-hidden',
      status: 'PASS',
      stdout: 'HIDDEN_STDOUT_SECRET',
      stderr: '',
      testCase: { hidden: true },
    },
  ],
};

function makeFakePrisma(submission: unknown, upsert = jest.fn().mockResolvedValue(undefined)) {
  const prisma = {
    submission: { findUnique: jest.fn().mockResolvedValue(submission) },
    aiFeedback: { upsert },
  };
  return { prisma: prisma as unknown as PrismaService, upsert };
}

function makeFakeLlm(chat: jest.Mock, modelName = 'test-model') {
  return { modelName, chat } as unknown as LlmService;
}

describe('AiFeedbackService.generateForSubmission', () => {
  it('persists VALID on the first successful attempt, making exactly one LLM call', async () => {
    const chat = jest.fn().mockResolvedValue(JSON.stringify(VALID_FEEDBACK));
    const { prisma, upsert } = makeFakePrisma(BASE_SUBMISSION);
    const service = new AiFeedbackService(prisma, makeFakeLlm(chat));

    await service.generateForSubmission('sub-1');

    expect(chat).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ submissionId: 'sub-1' });
    expect(arg.create.validationStatus).toBe('VALID');
    expect(arg.create.model).toBe('test-model');
    expect(arg.create.content).toEqual(VALID_FEEDBACK);
    expect(arg.update.validationStatus).toBe('VALID');
  });

  it('retries ONCE with the validation error appended, then persists VALID on a 2nd good attempt', async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce('this is not json {{{')
      .mockResolvedValueOnce(JSON.stringify(VALID_FEEDBACK));
    const { prisma, upsert } = makeFakePrisma(BASE_SUBMISSION);
    const service = new AiFeedbackService(prisma, makeFakeLlm(chat));

    await service.generateForSubmission('sub-1');

    expect(chat).toHaveBeenCalledTimes(2);
    const secondPrompt = chat.mock.calls[1][0] as string;
    expect(secondPrompt).toContain('FAILED validation');
    expect(secondPrompt).toContain('not valid JSON');

    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0][0];
    expect(arg.create.validationStatus).toBe('VALID');
    expect(arg.create.content).toEqual(VALID_FEEDBACK);
  });

  it('flags for human review with safe fallback content when both attempts fail validation', async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce('not json at all')
      .mockResolvedValueOnce('{"summary":"ok","severity":"pwned","suggestions":[]}');
    const { prisma, upsert } = makeFakePrisma(BASE_SUBMISSION);
    const service = new AiFeedbackService(prisma, makeFakeLlm(chat));

    await service.generateForSubmission('sub-1');

    expect(chat).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0][0];
    expect(arg.create.validationStatus).toBe('FLAGGED');
    // Never stores unvalidated free text as structured feedback.
    expect(arg.create.content).toEqual({ note: 'AI feedback could not be validated' });
    expect(arg.create.model).toBe('test-model');
  });

  it('flags for human review (without throwing) when the LLM call itself keeps failing', async () => {
    const chat = jest.fn().mockRejectedValue(new Error('network down'));
    const { prisma, upsert } = makeFakePrisma(BASE_SUBMISSION);
    const service = new AiFeedbackService(prisma, makeFakeLlm(chat));

    await expect(service.generateForSubmission('sub-1')).resolves.toBeUndefined();

    expect(chat).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].create.validationStatus).toBe('FLAGGED');
  });

  it('upserts on submissionId (idempotent-ish re-run overwrites the prior row)', async () => {
    const chat = jest.fn().mockResolvedValue(JSON.stringify(VALID_FEEDBACK));
    const { prisma, upsert } = makeFakePrisma(BASE_SUBMISSION);
    const service = new AiFeedbackService(prisma, makeFakeLlm(chat));

    await service.generateForSubmission('sub-1');
    await service.generateForSubmission('sub-1');

    expect(upsert).toHaveBeenCalledTimes(2);
    for (const call of upsert.mock.calls) {
      expect(call[0].where).toEqual({ submissionId: 'sub-1' });
    }
  });

  it('never includes a HIDDEN test case stdout/stderr in the prompt, only a visible sample', async () => {
    const chat = jest.fn().mockResolvedValue(JSON.stringify(VALID_FEEDBACK));
    const { prisma } = makeFakePrisma(BASE_SUBMISSION);
    const service = new AiFeedbackService(prisma, makeFakeLlm(chat));

    await service.generateForSubmission('sub-1');

    const prompt = chat.mock.calls[0][0] as string;
    expect(prompt).toContain('VISIBLE_STDOUT_MARKER');
    expect(prompt).not.toContain('HIDDEN_STDOUT_SECRET');
  });

  it('does nothing (and does not throw) for an unknown submission id', async () => {
    const chat = jest.fn();
    const { prisma, upsert } = makeFakePrisma(null);
    const service = new AiFeedbackService(prisma, makeFakeLlm(chat));

    await expect(service.generateForSubmission('missing')).resolves.toBeUndefined();
    expect(chat).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
