/**
 * event-enricher.ts — Issue #183
 *
 * Top-level coordinator. Accepts every emitted `PublisherEvent`, runs the
 * pure `ClusterDetector`, dispatches "ready" clusters to the configured
 * `EnricherProvider`, and emits validated meta-events back via the supplied
 * `emitMetaEvent` callback.
 *
 * Operates entirely OUT-of-band:
 *   - Provider calls are async with a per-call timeout (`AbortSignal`).
 *   - A shared `TokenBudget` short-circuits further calls when exhausted.
 *   - Failures (timeout / parse-error / network) are counted and logged but
 *     never block raw event publishing — the enricher is strictly additive.
 */

import { randomUUID } from 'node:crypto';

import type {
  EventPayloadMap,
  IncidentSummaryPayload,
  BattleSummaryPayload,
  StintSummaryPayload,
  PublisherCarRef,
  PublisherEvent,
  PublisherEventType,
} from '../event-types';
import { ClusterDetector, type ClusterContext } from './cluster-detector';
import type { ClusterRequest, EnricherProvider } from './provider';
import { TokenBudget } from './token-budget';

export interface EnricherCounters {
  clustersDetected: number;
  providerCalls: number;
  providerErrors: number;
  parseErrors: number;
  timeouts: number;
  budgetSkips: number;
  emitted: number;
}

export interface EventEnricherConfig {
  provider: EnricherProvider;
  /** Token cap for the lifetime of this enricher (resettable). */
  tokenBudgetCap?: number;
  /** Per-call timeout in ms. Defaults to 5000. */
  callTimeoutMs?: number;
  /**
   * Where to put validated meta-events. Implementations should forward to
   * the publisher transport so the Race Control API receives them just like
   * raw events. The enricher does NOT call the transport directly — keeps
   * the dependency one-way and easy to test.
   */
  emitMetaEvent: (ev: PublisherEvent) => void;
  /** Optional structured logger. */
  log?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
  /** Race session id stamped into every emitted meta-event. */
  raceSessionId: string;
  /** Optional rig id stamped into every emitted meta-event. */
  rigId?: string;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_BUDGET = 100_000;

const META_TYPE_BY_KIND: Record<ClusterRequest['kind'], PublisherEventType> = {
  incident: 'INCIDENT_SUMMARY',
  battle: 'BATTLE_SUMMARY',
  stint: 'STINT_SUMMARY',
};

export class EventEnricher {
  private readonly detector = new ClusterDetector();
  private readonly budget: TokenBudget;
  private readonly callTimeoutMs: number;
  readonly counters: EnricherCounters = {
    clustersDetected: 0,
    providerCalls: 0,
    providerErrors: 0,
    parseErrors: 0,
    timeouts: 0,
    budgetSkips: 0,
    emitted: 0,
  };

  constructor(private readonly cfg: EventEnricherConfig) {
    this.budget = new TokenBudget(cfg.tokenBudgetCap ?? DEFAULT_BUDGET);
    this.callTimeoutMs = cfg.callTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** True when the enricher will actually call the LLM. False = no-op. */
  get enabled(): boolean {
    return this.cfg.provider.enabled;
  }

  /**
   * Ingest one raw publisher event + optional cluster context (e.g.
   * `competitiveFocus` from `DriverState.derived`). Fires off zero or more
   * provider calls in the background — never throws.
   */
  ingest(ev: PublisherEvent, ctx: ClusterContext = {}): void {
    if (!this.enabled) return;
    let clusters: ClusterRequest[];
    try {
      clusters = this.detector.ingest(ev, ctx);
    } catch (err) {
      this.cfg.log?.('error', 'enricher: detector threw', err);
      return;
    }
    for (const c of clusters) {
      this.counters.clustersDetected += 1;
      void this.dispatch(c);
    }
  }

  private async dispatch(cluster: ClusterRequest): Promise<void> {
    if (this.budget.isExhausted()) {
      this.counters.budgetSkips += 1;
      this.cfg.log?.('warn', 'enricher: token budget exhausted, skipping cluster', {
        kind: cluster.kind,
      });
      return;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.callTimeoutMs);
    this.counters.providerCalls += 1;
    try {
      const resp = await this.cfg.provider.enrich(cluster, ac.signal);
      this.budget.consume(resp.tokensIn, resp.tokensOut);
      const ev = this.buildMetaEvent(cluster, resp);
      this.cfg.emitMetaEvent(ev);
      this.counters.emitted += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Abort')) {
        this.counters.timeouts += 1;
        this.cfg.log?.('warn', 'enricher: provider call timed out', { kind: cluster.kind });
      } else if (msg.toLowerCase().includes('json') || msg.includes('must be')) {
        this.counters.parseErrors += 1;
        this.cfg.log?.('warn', 'enricher: provider response failed validation', { msg });
      } else {
        this.counters.providerErrors += 1;
        this.cfg.log?.('warn', 'enricher: provider call failed', { msg });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private buildMetaEvent(
    cluster: ClusterRequest,
    resp: Awaited<ReturnType<EnricherProvider['enrich']>>,
  ): PublisherEvent {
    const last = cluster.events[cluster.events.length - 1];
    const cars = uniqueCars(cluster.events);
    const rawTypes = uniqueTypes(cluster.events);
    const type = META_TYPE_BY_KIND[cluster.kind];
    const base = {
      startTime: cluster.startTime,
      endTime: cluster.endTime,
      involvedCars: cars,
      rawEventTypes: rawTypes,
      llmHeadline: resp.headline,
      llmNarrative: resp.narrative,
      severity: resp.severity,
      confidence: resp.confidence,
      llm: {
        provider: this.cfg.provider.name as
          | 'openai'
          | 'azure-openai'
          | 'ollama'
          | 'mock',
        model: resp.model,
        latencyMs: resp.latencyMs,
        tokensIn: resp.tokensIn,
        tokensOut: resp.tokensOut,
      },
    };
    let payload: EventPayloadMap[typeof type];
    if (type === 'INCIDENT_SUMMARY') payload = base as IncidentSummaryPayload;
    else if (type === 'BATTLE_SUMMARY') payload = base as BattleSummaryPayload;
    else payload = base as StintSummaryPayload;
    return {
      id: randomUUID(),
      raceSessionId: this.cfg.raceSessionId,
      rigId: this.cfg.rigId,
      type,
      timestamp: Date.now(),
      sessionTime: last.sessionTime,
      sessionTick: last.sessionTick,
      car: cars[0] ?? last.car,
      payload,
      context: last.context,
    };
  }
}

function uniqueCars(events: readonly PublisherEvent[]): PublisherCarRef[] {
  const seen = new Set<number>();
  const out: PublisherCarRef[] = [];
  for (const ev of events) {
    if (!ev.car) continue;
    if (seen.has(ev.car.carIdx)) continue;
    seen.add(ev.car.carIdx);
    out.push(ev.car);
  }
  return out;
}

function uniqueTypes(events: readonly PublisherEvent[]): PublisherEventType[] {
  const seen = new Set<PublisherEventType>();
  const out: PublisherEventType[] = [];
  for (const ev of events) {
    if (seen.has(ev.type)) continue;
    seen.add(ev.type);
    out.push(ev.type);
  }
  return out;
}
