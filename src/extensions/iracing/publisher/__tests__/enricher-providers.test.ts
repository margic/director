/**
 * enricher-providers.test.ts — Issue #183
 */
import { describe, it, expect } from 'vitest';
import { DisabledProvider } from '../enricher/providers/disabled';
import { MockProvider } from '../enricher/providers/mock';
import { OpenAIProvider } from '../enricher/providers/openai';
import { AzureOpenAIProvider } from '../enricher/providers/azure-openai';
import { OllamaProvider } from '../enricher/providers/ollama';
import type { ClusterRequest } from '../enricher/provider';

const cluster: ClusterRequest = {
  kind: 'incident',
  startTime: 100,
  endTime: 105,
  events: [
    {
      id: 'a', raceSessionId: 's', type: 'OFF_TRACK', timestamp: 0,
      sessionTime: 100, sessionTick: 0,
      car: { carIdx: 0, carNumber: '7', driverName: 'Test' },
      payload: {} as any,
    },
  ],
};

describe('DisabledProvider', () => {
  it('reports enabled=false', () => {
    const p = new DisabledProvider();
    expect(p.enabled).toBe(false);
  });
  it('throws when called', async () => {
    const p = new DisabledProvider();
    const ac = new AbortController();
    await expect(p.enrich(cluster, ac.signal)).rejects.toThrow();
  });
});

describe('MockProvider', () => {
  it('returns a canned response', async () => {
    const p = new MockProvider();
    const ac = new AbortController();
    const r = await p.enrich(cluster, ac.signal);
    expect(r.headline).toBe('Mock headline');
    expect(r.severity).toBe('minor');
    expect(r.tokensIn).toBe(50);
    expect(p.callCount).toBe(1);
  });

  it('rejects on abort', async () => {
    const p = new MockProvider({ hang: true });
    const ac = new AbortController();
    const promise = p.enrich(cluster, ac.signal);
    ac.abort();
    await expect(promise).rejects.toThrow(/Abort/);
  });
});

describe('OpenAIProvider', () => {
  it('parses a successful response and merges usage', async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"headline":"hi","narrative":"long enough","severity":"minor","confidence":0.5}' } }],
          usage: { prompt_tokens: 12, completion_tokens: 7 },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const p = new OpenAIProvider({ apiKey: 'k', model: 'gpt-4o-mini', fetchFn });
    const r = await p.enrich(cluster, new AbortController().signal);
    expect(r.headline).toBe('hi');
    expect(r.tokensIn).toBe(12);
    expect(r.tokensOut).toBe(7);
    expect(r.model).toBe('gpt-4o-mini');
  });

  it('throws on non-2xx', async () => {
    const fetchFn = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const p = new OpenAIProvider({ apiKey: 'k', model: 'm', fetchFn });
    await expect(p.enrich(cluster, new AbortController().signal)).rejects.toThrow(/HTTP 500/);
  });

  it('throws on invalid JSON content', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] }), { status: 200 })) as unknown as typeof fetch;
    const p = new OpenAIProvider({ apiKey: 'k', model: 'm', fetchFn });
    await expect(p.enrich(cluster, new AbortController().signal)).rejects.toThrow();
  });
});

describe('AzureOpenAIProvider', () => {
  it('builds the deployment URL with api-version', async () => {
    let captured = '';
    const fetchFn = (async (url: string) => {
      captured = url;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"headline":"x","narrative":"y here","severity":"minor","confidence":0.1}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const p = new AzureOpenAIProvider({
      endpoint: 'https://r.openai.azure.com/',
      deployment: 'mydeploy',
      apiVersion: '2024-02-15',
      apiKey: 'k',
      fetchFn,
    });
    await p.enrich(cluster, new AbortController().signal);
    expect(captured).toContain('/openai/deployments/mydeploy/chat/completions?api-version=2024-02-15');
  });
});

describe('OllamaProvider', () => {
  it('uses prompt_eval_count + eval_count for token accounting', async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          message: { content: '{"headline":"a","narrative":"bbbb cccc","severity":"minor","confidence":0.4}' },
          prompt_eval_count: 33,
          eval_count: 11,
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const p = new OllamaProvider({ model: 'llama3', fetchFn });
    const r = await p.enrich(cluster, new AbortController().signal);
    expect(r.tokensIn).toBe(33);
    expect(r.tokensOut).toBe(11);
    expect(r.model).toBe('llama3');
  });
});
