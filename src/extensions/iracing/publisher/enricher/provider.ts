/**
 * provider.ts — Issue #183
 *
 * Provider abstraction for the EventEnricher LLM stage. Pluggable so the
 * publisher can be configured for OpenAI, Azure-OpenAI, a local Ollama
 * server, or fully disabled.
 */

import type { PublisherEvent, PublisherEventType } from '../event-types';

export type EnricherProviderName =
  | 'openai'
  | 'azure-openai'
  | 'ollama'
  | 'mock'
  | 'disabled';

/** Cluster kinds the enricher recognises. */
export type ClusterKind = 'incident' | 'battle' | 'stint';

/**
 * One clustered batch of events handed to the LLM provider for narration.
 * Pure data — no live references.
 */
export interface ClusterRequest {
  kind: ClusterKind;
  startTime: number;
  endTime: number;
  events: readonly PublisherEvent[];
}

/**
 * Strict-shape response the provider must produce. Anything that does not
 * validate is dropped by the enricher (with a parse-error counter bump).
 */
export interface ProviderResponse {
  headline: string;
  narrative: string;
  severity: 'minor' | 'major' | 'race-defining';
  confidence: number;
  /** Token accounting reported by the provider. */
  tokensIn: number;
  tokensOut: number;
  /** Wall-clock latency observed by the provider adapter. */
  latencyMs: number;
  /** Provider-reported model identifier (echoed back into the meta-event). */
  model: string;
}

/**
 * Provider adapter interface. Implementations MUST honour the timeout and
 * either return a validated `ProviderResponse` or throw.
 */
export interface EnricherProvider {
  readonly name: EnricherProviderName;
  /** Indicates the provider is disabled — used by the enricher to short-circuit. */
  readonly enabled: boolean;
  /**
   * Run a clustering job. Implementations should respect the abort signal.
   * Throws on timeout, network error, or invalid response shape.
   */
  enrich(req: ClusterRequest, signal: AbortSignal): Promise<ProviderResponse>;
}

/** Helper — list of event types eligible for incident clustering. */
export const INCIDENT_EVENT_TYPES: ReadonlySet<PublisherEventType> = new Set<PublisherEventType>([
  'OFF_TRACK',
  'CONTACT_DETECTED',
  'PLAYER_STOPPED',
  'STOPPED_ON_TRACK',
  'BIG_HIT',
  'SPIN_DETECTED',
]);
