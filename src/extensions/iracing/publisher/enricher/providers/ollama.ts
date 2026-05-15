/**
 * ollama.ts — Issue #183
 *
 * Local Ollama adapter (`/api/chat` endpoint). Token counts come from
 * `prompt_eval_count` / `eval_count`. Latency is measured locally.
 */

import type { ClusterRequest, EnricherProvider, ProviderResponse } from '../provider';
import { SYSTEM_PROMPT, buildUserPrompt } from '../prompts';
import { parseLlmJson, validateLlmJson } from '../schema';

export interface OllamaProviderConfig {
  /** Defaults to `http://localhost:11434`. */
  baseUrl?: string;
  model: string;
  fetchFn?: typeof fetch;
}

export class OllamaProvider implements EnricherProvider {
  readonly name = 'ollama' as const;
  readonly enabled = true;
  private readonly fetch: typeof fetch;
  private readonly baseUrl: string;
  constructor(private readonly cfg: OllamaProviderConfig) {
    if (!cfg.model) throw new Error('OllamaProvider: model is required');
    this.fetch = cfg.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = cfg.baseUrl ?? 'http://localhost:11434';
  }

  async enrich(req: ClusterRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const start = Date.now();
    const res = await this.fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.cfg.model,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(req) },
        ],
      }),
      signal,
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const body = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const content = body.message?.content;
    if (!content) throw new Error('Ollama: empty completion');
    const parsed = validateLlmJson(parseLlmJson(content));
    return {
      ...parsed,
      tokensIn: body.prompt_eval_count ?? 0,
      tokensOut: body.eval_count ?? 0,
      latencyMs,
      model: this.cfg.model,
    };
  }
}
