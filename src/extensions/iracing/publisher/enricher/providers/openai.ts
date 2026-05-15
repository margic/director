/**
 * openai.ts — Issue #183
 *
 * OpenAI Chat Completions adapter. Uses JSON-mode (`response_format`) so the
 * model is forced to emit valid JSON. Honours the abort signal for timeout.
 */

import type { ClusterRequest, EnricherProvider, ProviderResponse } from '../provider';
import { SYSTEM_PROMPT, buildUserPrompt } from '../prompts';
import { parseLlmJson, validateLlmJson } from '../schema';

export interface OpenAIProviderConfig {
  apiKey: string;
  model: string;
  /** Defaults to https://api.openai.com */
  baseUrl?: string;
  /** Custom fetch (tests inject a stub). */
  fetchFn?: typeof fetch;
}

export class OpenAIProvider implements EnricherProvider {
  readonly name = 'openai' as const;
  readonly enabled = true;
  private readonly fetch: typeof fetch;
  private readonly baseUrl: string;
  constructor(private readonly cfg: OpenAIProviderConfig) {
    if (!cfg.apiKey) throw new Error('OpenAIProvider: apiKey is required');
    if (!cfg.model) throw new Error('OpenAIProvider: model is required');
    this.fetch = cfg.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = cfg.baseUrl ?? 'https://api.openai.com';
  }

  async enrich(req: ClusterRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const start = Date.now();
    const res = await this.fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(req) },
        ],
      }),
      signal,
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      throw new Error(`OpenAI HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenAI: empty completion');
    const parsed = validateLlmJson(parseLlmJson(content));
    return {
      ...parsed,
      tokensIn: body.usage?.prompt_tokens ?? 0,
      tokensOut: body.usage?.completion_tokens ?? 0,
      latencyMs,
      model: this.cfg.model,
    };
  }
}
