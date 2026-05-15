/**
 * enriching-transport.ts — Issue #183
 *
 * Decorator over `PublisherTransport`. Behaviour is IDENTICAL for raw event
 * publishing — events are still enqueued / batched / flushed the same way.
 * The only addition: every enqueued event is also fed to the `EventEnricher`
 * so the LLM stage can detect clusters and emit meta-events.
 *
 * The decorator subclasses `PublisherTransport` so existing call sites
 * (sub-orchestrators) accept it without type changes. Since the constructor
 * cannot defer to the parent without re-stating its config, we accept the
 * already-constructed transport via a small adapter pattern: callers pass
 * the regular `PublisherTransportConfig` to this class, which forwards to
 * the parent.
 */

import { PublisherTransport, type PublisherTransportConfig } from '../transport';
import type { PublisherEvent } from '../event-types';
import type { EventEnricher } from './event-enricher';
import type { ClusterContext } from './cluster-detector';

export interface EnrichingTransportConfig extends PublisherTransportConfig {
  enricher: EventEnricher;
  /**
   * Optional per-event context provider — looked up at enqueue time so the
   * enricher sees up-to-date `competitiveFocus`. Returns `undefined` to skip.
   */
  contextProvider?: (ev: PublisherEvent) => ClusterContext | undefined;
}

export class EnrichingTransport extends PublisherTransport {
  private readonly enricher: EventEnricher;
  private readonly contextProvider?: (ev: PublisherEvent) => ClusterContext | undefined;

  constructor(cfg: EnrichingTransportConfig) {
    const { enricher, contextProvider, ...base } = cfg;
    super(base);
    this.enricher = enricher;
    this.contextProvider = contextProvider;
  }

  override enqueue(event: PublisherEvent): void {
    super.enqueue(event);
    // Best-effort — never let enricher errors disturb the main queue.
    try {
      const ctx = this.contextProvider?.(event);
      this.enricher.ingest(event, ctx ?? {});
    } catch {
      // swallow — enricher.ingest already logs
    }
  }
}
