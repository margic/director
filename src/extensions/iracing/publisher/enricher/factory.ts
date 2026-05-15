/**
 * factory.ts — Issue #183
 *
 * Build an `EnricherProvider` from director settings. Returns the no-op
 * `DisabledProvider` when configuration is missing or `provider === 'disabled'`.
 */

import type { EnricherProvider, EnricherProviderName } from './provider';
import { DisabledProvider } from './providers/disabled';
import { OpenAIProvider } from './providers/openai';
import { AzureOpenAIProvider } from './providers/azure-openai';
import { OllamaProvider } from './providers/ollama';

export interface EnricherSettings {
  /** When omitted or `'disabled'`, the enricher does nothing. */
  provider?: EnricherProviderName;
  /** Provider-specific opts. Shape depends on `provider`. */
  openai?: { apiKey: string; model: string; baseUrl?: string };
  azureOpenai?: {
    endpoint: string;
    deployment: string;
    apiVersion: string;
    apiKey: string;
  };
  ollama?: { baseUrl?: string; model: string };
}

export function createProvider(s: EnricherSettings | undefined, fetchFn?: typeof fetch): EnricherProvider {
  if (!s || !s.provider || s.provider === 'disabled') return new DisabledProvider();
  switch (s.provider) {
    case 'openai':
      if (!s.openai) throw new Error('Enricher: openai settings missing');
      return new OpenAIProvider({ ...s.openai, fetchFn });
    case 'azure-openai':
      if (!s.azureOpenai) throw new Error('Enricher: azureOpenai settings missing');
      return new AzureOpenAIProvider({ ...s.azureOpenai, fetchFn });
    case 'ollama':
      if (!s.ollama) throw new Error('Enricher: ollama settings missing');
      return new OllamaProvider({ ...s.ollama, fetchFn });
    case 'mock':
      // Mock provider is test-only — never returned from production settings.
      throw new Error('Enricher: mock provider must be wired explicitly in tests');
    default: {
      const _exhaustive: never = s.provider;
      throw new Error(`Enricher: unknown provider ${_exhaustive as string}`);
    }
  }
}
