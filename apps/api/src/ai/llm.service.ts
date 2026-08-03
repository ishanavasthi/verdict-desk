import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';

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
      configuration: { baseURL: this.baseURL },
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

  /** Canned, deterministic, valid JSON so downstream JSON.parse always succeeds. */
  private mockResponse(prompt: string): string {
    return JSON.stringify({
      summary: 'Mock LLM response (MOCK_LLM enabled, no network call made).',
      severity: 'info',
      model: this.model,
      promptChars: prompt.length,
    });
  }
}

function isTruthy(v: string | undefined): boolean {
  if (v === undefined) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}
