import { Injectable, Logger } from '@nestjs/common';
import { Annotation, END, StateGraph } from '@langchain/langgraph';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../ai/llm.service';
import { buildDoubtDraftPrompt } from './doubt-prompt';
import { validateAnswer } from './answer-validation';

/** Initial attempt (1) + ONE retry with the validation error appended as corrective feedback. */
export const MAX_DRAFT_ATTEMPTS = 2;

const FLAGGED_DRAFT_CONTENT =
  'AI draft could not be validated after multiple attempts and was flagged for review; ' +
  'it was never submitted to the review queue.';

/**
 * LangGraph StateGraph for the AI doubt-draft pipeline:
 *   wrap (build the untrusted-data-wrapped prompt)
 *     -> draft (LlmService.chat)
 *     -> validate (fence-strip + strict Zod: { answer: string(1..4000) })
 *     -> [invalid AND attempts remain] loop back to wrap (retry with corrective error)
 *     -> [valid, or attempts exhausted] end
 *
 * Persisting to the DB (INSERT Answer, CAS DRAFT->PENDING_REVIEW, ReviewAudit)
 * happens OUTSIDE the graph in `run()`, based on the graph's final state —
 * keeps the graph itself pure/testable against a fake LlmService with no
 * Prisma involved, and keeps the DB side effects in one obvious place.
 */
const DraftState = Annotation.Root({
  title: Annotation<string>,
  body: Annotation<string>,
  prompt: Annotation<string>({
    reducer: (_prev: string, next: string) => next,
    default: () => '',
  }),
  raw: Annotation<string | undefined>({
    reducer: (_prev: string | undefined, next: string | undefined) => next,
    default: () => undefined,
  }),
  answer: Annotation<string | undefined>({
    reducer: (_prev: string | undefined, next: string | undefined) => next,
    default: () => undefined,
  }),
  error: Annotation<string | undefined>({
    reducer: (_prev: string | undefined, next: string | undefined) => next,
    default: () => undefined,
  }),
  attempt: Annotation<number>({
    reducer: (_prev: number, next: number) => next,
    default: () => 0,
  }),
});

type DraftStateT = typeof DraftState.State;

export interface AiDraftInput {
  doubtId: string;
  title: string;
  body: string;
}

@Injectable()
export class AiDraftPipeline {
  private readonly logger = new Logger(AiDraftPipeline.name);
  private readonly graph: any;

  // Constructor param typed as the concrete LlmService class (not a narrower
  // interface) so Nest's DI can resolve it via reflection metadata. Tests
  // that don't need real Nest DI can still pass any object shaped like
  // `{ chat(prompt: string): Promise<string> }` cast `as unknown as LlmService`.
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {
    this.graph = this.buildGraph();
  }

  private buildGraph() {
    const wrap = (state: DraftStateT): Partial<DraftStateT> => ({
      prompt: buildDoubtDraftPrompt({
        title: state.title,
        body: state.body,
        correctiveError: state.error,
      }),
    });

    const draft = async (state: DraftStateT): Promise<Partial<DraftStateT>> => {
      const raw = await this.llm.chat(state.prompt);
      return { raw, attempt: state.attempt + 1 };
    };

    const validate = (state: DraftStateT): Partial<DraftStateT> => {
      const result = validateAnswer(state.raw ?? '');
      if (result.ok) {
        return { answer: result.value.answer, error: undefined };
      }
      return { answer: undefined, error: result.error };
    };

    const routeAfterValidate = (state: DraftStateT): 'retry' | 'done' => {
      if (state.answer !== undefined) return 'done';
      return state.attempt < MAX_DRAFT_ATTEMPTS ? 'retry' : 'done';
    };

    return new StateGraph(DraftState)
      .addNode('wrap', wrap)
      .addNode('draft', draft)
      .addNode('validate', validate)
      .addEdge('__start__', 'wrap')
      .addEdge('wrap', 'draft')
      .addEdge('draft', 'validate')
      .addConditionalEdges('validate', routeAfterValidate, { retry: 'wrap', done: END })
      .compile();
  }

  /**
   * Fire-and-forget entrypoint (called from DoubtsController right after a
   * doubt is created): owns its own try/catch end-to-end and NEVER throws —
   * the caller relies on that to never fail the POST /doubts request.
   */
  async run(input: AiDraftInput): Promise<void> {
    try {
      const result = await this.graph.invoke({
        title: input.title,
        body: input.body,
      });

      if (result.answer !== undefined) {
        await this.persistSuccess(input.doubtId, result.answer);
      } else {
        await this.persistFailure(input.doubtId, result.error);
      }
    } catch (err) {
      this.logger.error(
        `AI draft pipeline threw for doubt ${input.doubtId}: ${(err as Error).message}`,
      );
      try {
        await this.persistFailure(input.doubtId, (err as Error).message);
      } catch (persistErr) {
        this.logger.error(
          `also failed to persist a flagged AI draft record for doubt ${input.doubtId}: ${(persistErr as Error).message}`,
        );
      }
    }
  }

  /**
   * A validated draft: INSERT Answer{authorType:AI, state:DRAFT} (legal per
   * answers_insert_guard_trg), then a guarded CAS DRAFT->PENDING_REVIEW
   * (updateMany where id AND state='DRAFT'), then a ReviewAudit row. If the
   * CAS somehow loses a race (unexpected — nothing else touches a
   * freshly-inserted AI answer), the answer is simply left DRAFT rather than
   * silently surfaced as PENDING.
   */
  private async persistSuccess(doubtId: string, answer: string): Promise<void> {
    const created = await this.prisma.answer.create({
      data: { doubtId, authorType: 'AI', state: 'DRAFT', content: answer },
    });

    const transitioned = await this.prisma.answer.updateMany({
      where: { id: created.id, state: 'DRAFT' },
      data: { state: 'PENDING_REVIEW' },
    });

    if (transitioned.count === 1) {
      await this.prisma.reviewAudit.create({
        data: {
          answerId: created.id,
          action: 'ai_submit',
          fromState: 'DRAFT',
          toState: 'PENDING_REVIEW',
          actorId: null,
        },
      });
      this.logger.log(
        `AI draft for doubt ${doubtId} submitted to the review queue (answer ${created.id})`,
      );
    } else {
      this.logger.warn(
        `AI draft for doubt ${doubtId} (answer ${created.id}) could not be CAS-transitioned to ` +
          'PENDING_REVIEW (unexpected concurrent modification) — left DRAFT.',
      );
    }
  }

  /**
   * Both attempts failed schema validation (or the LLM call itself threw):
   * a bad AI draft must never reach the review queue as PENDING_REVIEW. We
   * still record a DRAFT-state Answer row (never CAS-transitioned) for
   * auditability, with safe, non-model-generated fallback content — mirrors
   * AiFeedbackService's FLAGGED fallback (never persist/surface unvalidated
   * free text) — and log/flag it server-side.
   */
  private async persistFailure(doubtId: string, error: string | undefined): Promise<void> {
    await this.prisma.answer.create({
      data: { doubtId, authorType: 'AI', state: 'DRAFT', content: FLAGGED_DRAFT_CONTENT },
    });
    this.logger.warn(
      `AI draft for doubt ${doubtId} FAILED validation after ${MAX_DRAFT_ATTEMPTS} attempt(s); ` +
        `left DRAFT (never reaches the review queue as PENDING_REVIEW). Last error: ${error}`,
    );
  }
}
