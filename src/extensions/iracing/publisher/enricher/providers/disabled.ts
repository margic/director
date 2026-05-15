/**
 * disabled.ts — Issue #183
 *
 * No-op provider used when the enricher is configured off. Construction is
 * cheap and `enrich()` always rejects so calling code can short-circuit on
 * `enabled === false`.
 */

import type { ClusterRequest, EnricherProvider, ProviderResponse } from '../provider';

export class DisabledProvider implements EnricherProvider {
  readonly name = 'disabled' as const;
  readonly enabled = false;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async enrich(_req: ClusterRequest, _signal: AbortSignal): Promise<ProviderResponse> {
    throw new Error('DisabledProvider.enrich called — caller must check `enabled`');
  }
}
