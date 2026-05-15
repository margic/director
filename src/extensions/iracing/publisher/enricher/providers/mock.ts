/**
 * mock.ts — Issue #183
 *
 * Deterministic provider used in tests. Returns a canned response after an
 * optional artificial delay. Honours the abort signal — on abort it rejects
 * with `AbortError`.
 */

import type { ClusterRequest, EnricherProvider, ProviderResponse } from '../provider';

export interface MockProviderOptions {
  /** Delay before resolving (ms). Defaults to 0 (synchronous). */
  delayMs?: number;
  /** Override the response. */
  response?: Partial<ProviderResponse>;
  /** When true, never resolves until aborted (used to test timeouts). */
  hang?: boolean;
}

export class MockProvider implements EnricherProvider {
  readonly name = 'mock' as const;
  readonly enabled = true;
  callCount = 0;
  constructor(private readonly opts: MockProviderOptions = {}) {}

  enrich(req: ClusterRequest, signal: AbortSignal): Promise<ProviderResponse> {
    this.callCount += 1;
    return new Promise<ProviderResponse>((resolve, reject) => {
      const onAbort = () => reject(new Error('AbortError'));
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      if (this.opts.hang) return; // never settle on its own
      const delay = this.opts.delayMs ?? 0;
      const finish = () => {
        signal.removeEventListener('abort', onAbort);
        resolve({
          headline: 'Mock headline',
          narrative: `Mock narrative for ${req.kind} cluster of ${req.events.length} events.`,
          severity: 'minor',
          confidence: 0.5,
          tokensIn: 50,
          tokensOut: 25,
          latencyMs: delay,
          model: 'mock-model',
          ...this.opts.response,
        });
      };
      if (delay <= 0) finish();
      else setTimeout(finish, delay);
    });
  }
}
