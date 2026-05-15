/**
 * azure-openai.ts — Issue #183
 *
 * Azure-OpenAI Chat Completions adapter. Differences vs the public OpenAI
 * endpoint: requires `endpoint`, `deployment`, and `apiVersion`; uses an
 * `api-key` header instead of bearer auth.
 */

import type { ClusterRequest, EnricherProvider, ProviderResponse } from '../provider';
import { SYSTEM_PROMPT, buildUserPrompt } from '../prompts';
import { parseLlmJson, validateLlmJson } from '../schema';

export interface AzureOpenAIProviderConfig {
  /** Azure resource endpoint, e.g. `https://my-resource.openai.azure.com`. */
  endpoint: string;
  /** Deployment name configured in Azure. */
  deployment: string;
  /** API version, e.g. `2024-02-15-preview`. */
  apiVersion: string;
  apiKey: string;
  fetchFn?: typeof fetch;
}

export class AzureOpenAIProvider implements EnricherProvider {
  readonly name = 'azure-openai' as const;
  readonly enabled = true;
  private readonly fetch: typeof fetch;
  constructor(private readonly cfg: AzureOpenAIProviderConfig) {
    if (!cfg.endpoint) throw new Error('AzureOpenAIProvider: endpoint is required');
    if (!cfg.deployment) throw new Error('AzureOpenAIProvider: deployment is required');
    if (!cfg.apiVersion) throw new Error('AzureOpenAIProvider: apiVersion is required');
    if (!cfg.apiKey) throw new Error('AzureOpenAIProvider: apiKey is required');
    this.fetch = cfg.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  async enrich(req: ClusterRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const start = Date.now();
    const url = `${this.cfg.endpoint.replace(/\/$/, '')}/openai/deployments/${this.cfg.deployment}/chat/completions?api-version=${this.cfg.apiVersion}`;
    const res = await this.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.cfg.apiKey,
      },
      body: JSON.stringify({
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(req) },
        ],
      }),
      signal,
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) throw new Error(`AzureOpenAI HTTP ${res.status}`);
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error('AzureOpenAI: empty completion');
    const parsed = validateLlmJson(parseLlmJson(content));
    return {
      ...parsed,
      tokensIn: body.usage?.prompt_tokens ?? 0,
      tokensOut: body.usage?.completion_tokens ?? 0,
      latencyMs,
      model: this.cfg.deployment,
    };
  }
}
