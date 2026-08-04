import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';

/**
 * Prompts that want the MOCK client to return an `{ answer: string }` shape
 * (the M4 doubt-draft pipeline) instead of the default AI-feedback shape
 * (`{ summary, severity, suggestions }`, M3) include this marker string in
 * their instructions. Keeps LlmService a single shared seam for every AI
 * feature without hard-coding feature-specific branching on prompt content.
 */
export const DOUBT_ANSWER_SCHEMA_MARKER = 'verdict-desk-doubt-answer-schema-v1';

/**
 * Provider-agnostic (OpenAI-compatible) chat client.
 *
 * When MOCK_LLM is truthy we bypass the network entirely and return a canned,
 * valid JSON string so every AI feature works with NO API key. Otherwise we call
 * an OpenAI-compatible endpoint (NVIDIA NIM by default) via LangChain's ChatOpenAI.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly mock: boolean;
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.mock = isTruthy(this.config.get<string>('MOCK_LLM'));
    this.baseURL =
      this.config.get<string>('LLM_BASE_URL') ?? 'https://integrate.api.nvidia.com/v1';
    this.apiKey = this.config.get<string>('LLM_API_KEY') ?? '';
    this.model =
      this.config.get<string>('LLM_MODEL') ?? 'meta/llama-3.1-8b-instruct';

    this.logger.log(
      `LlmService active in ${this.mock ? 'MOCK' : 'LIVE'} mode (model=${this.model}, baseURL=${this.baseURL})`,
    );
  }

  get isMock(): boolean {
    return this.mock;
  }

  /** The configured model id (used e.g. to stamp `AiFeedback.model`). */
  get modelName(): string {
    return this.model;
  }

  async chat(prompt: string): Promise<string> {
    if (this.mock) {
      return this.mockResponse(prompt);
    }

    if (!this.apiKey) {
      throw new Error(
        'LLM_API_KEY is empty and MOCK_LLM is not set; cannot make a live call.',
      );
    }

    const client = new ChatOpenAI({
      apiKey: this.apiKey,
      model: this.model,
      configuration: {
        baseURL: this.baseURL,
        // The openai SDK's Node shim defaults to the `node-fetch` package.
        // Some OpenAI-compatible gateways (incl. NVIDIA NIM, for slower
        // "reasoning" models) hold the connection open for a long time before
        // the first byte; node-fetch has been observed to drop those
        // connections (`FetchError: ... ETIMEDOUT`) in some network
        // environments. Node's native `fetch` (global since Node 18) handles
        // the same long-lived responses reliably, so prefer it explicitly.
        // Cast via `any`: the openai SDK's `Fetch` type and lib.dom's global
        // `fetch` type diverge slightly across TS lib configs (ts-jest vs.
        // tsc), so a narrower cast is brittle here.
        fetch: globalThis.fetch as any,
      },
    });

    const res = await client.invoke(prompt);
    const content = res.content;
    if (typeof content === 'string') {
      return content;
    }
    // content can be an array of message parts on some providers — coalesce to text.
    return Array.isArray(content)
      ? content
          .map((part) =>
            typeof part === 'string'
              ? part
              : 'text' in part && typeof part.text === 'string'
                ? part.text
                : '',
          )
          .join('')
      : String(content);
  }

  /**
   * Canned, deterministic, valid JSON so downstream JSON.parse always
   * succeeds with NO network call and NO API key. Branches on
   * DOUBT_ANSWER_SCHEMA_MARKER so both AI features validate cleanly in MOCK
   * mode: the M3 AiFeedback strict schema (summary/severity/suggestions —
   * see ai/feedback-validation.ts) by default, or the M4 doubt-draft strict
   * schema ({ answer: string } — see doubts/answer-validation.ts) when the
   * prompt is the doubt-draft prompt.
   */
  private mockResponse(prompt: string): string {
    if (prompt.includes(DOUBT_ANSWER_SCHEMA_MARKER)) {
      return JSON.stringify({
        answer:
          `Mock AI draft answer (MOCK_LLM enabled, no network call made; prompt was ${prompt.length} chars). ` +
          'This draft is only ever shown after a teacher reviews and approves it.',
      });
    }

    return JSON.stringify({
      summary: `Mock LLM response (MOCK_LLM enabled, no network call made; prompt was ${prompt.length} chars).`,
      severity: 'info',
      suggestions: [
        {
          title: 'Mock suggestion',
          detail: 'This is a deterministic, canned suggestion returned by the MOCK LLM client — no network call was made.',
        },
      ],
    });
  }
}

function isTruthy(v: string | undefined): boolean {
  if (v === undefined) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}
