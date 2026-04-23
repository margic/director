/**
 * Publisher REST Transport — issue #83
 *
 * Batches PublisherEvent objects and POSTs them to POST /api/telemetry/events.
 * Implements per-spec constraints:
 *   - Max 20 events per request (spec: maxItems: 20)
 *   - 202 Accepted: parse PublisherEventBatchResponse, log invalid events
 *   - 400: drop batch (structural failure), no retry
 *   - 401: re-queue, surface error (caller must refresh token)
 *   - 429: re-queue, exponential backoff (caps at MAX_RETRY_BACKOFF_MS)
 *   - 5xx / network error: re-queue, exponential backoff
 *
 * High-priority events (see HIGH_PRIORITY_EVENTS) bypass the batch interval
 * and trigger an immediate flush.
 *
 * Also exports fetchPublisherConfig() — uses GET /api/publisher-config/{publisherCode}
 * to auto-discover raceSessionId and displayName so the driver only needs their code.
 */

import { HIGH_PRIORITY_EVENTS, type PublisherEvent, type PublisherEventType } from './event-types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BATCH_SIZE = 20; // spec: PublisherEventBatchRequest.events maxItems: 20
const MAX_RETRY_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;

// ---------------------------------------------------------------------------
// Wire types — map directly to OpenAPI schemas
// ---------------------------------------------------------------------------

export interface PublisherEventBatchRequest {
  events: PublisherEvent[];
}

export interface PublisherEventResult {
  id: string;
  status: 'accepted' | 'duplicate' | 'invalid';
  error?: string;
}

export interface PublisherEventBatchResponse {
  accepted: number;
  duplicates: number;
  invalid: number;
  results: PublisherEventResult[];
}

/**
 * Response from GET /api/publisher-config/{publisherCode}
 * Used for auto-configuration — the driver only needs their publisherCode.
 */
export interface PublisherConfigResponse {
  gatewayUrl: string;
  raceSessionId: string;
  id: string;
  driverId: string;
  displayName: string;
  nickname: string;
  iracingName: string;
  publisherCode: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Transport config & status
// ---------------------------------------------------------------------------

export interface PublisherTransportConfig {
  endpointUrl: string;
  batchIntervalMs: number;
  /** Returns a valid Bearer token or null if unauthenticated */
  getAuthToken: () => Promise<string | null>;
  /** Optional status change callback — drives the UI status bar */
  onStatusChange?: (status: TransportStatus) => void;
  /**
   * Injectable fetch implementation.
   * Defaults to the global `fetch`. Override in tests or Electron main process
   * where the global may not be available.
   */
  fetchFn?: typeof fetch;
}

export interface TransportStatus {
  status: 'idle' | 'active' | 'error';
  message?: string;
  eventsQueuedTotal: number;
  lastFlushAt?: number;
}

// ---------------------------------------------------------------------------
// PublisherTransport
// ---------------------------------------------------------------------------

export class PublisherTransport {
  private queue: PublisherEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private eventsQueuedTotal = 0;
  private lastFlushAt: number | undefined;
  /** Unix ms timestamp before which flush() is a no-op (backoff guard) */
  private retryAfter = 0;
  /** Current backoff duration — doubles on each consecutive failure */
  private retryBackoffMs = 0;
  /** Prevents concurrent flush calls */
  private flushing = false;

  private readonly fetch: typeof fetch;
  private readonly onStatusChange?: (s: TransportStatus) => void;

  constructor(private readonly config: PublisherTransportConfig) {
    this.fetch = config.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.onStatusChange = config.onStatusChange;
  }

  /** Start the periodic flush timer. Idempotent — safe to call multiple times. */
  start(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.config.batchIntervalMs);
    this.emitStatus('idle');
  }

  /**
   * Stop the periodic timer and attempt a final flush of any queued events.
   * Awaitable — resolves once the final flush completes (or fails).
   */
  async stop(): Promise<void> {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.queue.length > 0) {
      await this.flush();
    }
  }

  /**
   * Add an event to the queue.
   * High-priority events trigger an immediate flush attempt without waiting
   * for the next timer tick.
   */
  enqueue(event: PublisherEvent): void {
    this.queue.push(event);
    this.eventsQueuedTotal++;
    if (HIGH_PRIORITY_EVENTS.has(event.type as PublisherEventType)) {
      void this.flush();
    }
  }

  /** Number of events currently waiting in the queue (primarily for tests). */
  get queueLength(): number {
    return this.queue.length;
  }

  /**
   * Flush up to MAX_BATCH_SIZE events from the front of the queue.
   * Re-entrant-safe — concurrent calls are dropped while one is in flight.
   * Respects the retry backoff — skips silently while in backoff.
   */
  async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.queue.length === 0) return;
    if (Date.now() < this.retryAfter) return;

    this.flushing = true;
    const batch = this.queue.splice(0, MAX_BATCH_SIZE);

    try {
      const token = await this.config.getAuthToken();
      if (!token) {
        this.queue.unshift(...batch);
        this.emitStatus('error', 'No auth token — events re-queued');
        return;
      }

      this.emitStatus('active');

      let response: Response;
      try {
        response = await this.fetch(this.config.endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ events: batch } satisfies PublisherEventBatchRequest),
        });
      } catch (networkErr) {
        this.queue.unshift(...batch);
        this.applyBackoff();
        this.emitStatus('error', `Network error — retry in ${this.retryBackoffMs}ms`);
        return;
      }

      if (response.status === 202) {
        const result: PublisherEventBatchResponse = await response.json() as PublisherEventBatchResponse;
        this.lastFlushAt = Date.now();
        this.retryBackoffMs = 0;
        this.retryAfter = 0;
        if (result.invalid > 0) {
          for (const r of result.results) {
            if (r.status === 'invalid') {
              console.warn(`[publisher-transport] Event ${r.id} rejected by server: ${r.error ?? 'unknown reason'}`);
            }
          }
        }
        this.emitStatus('idle');
      } else if (response.status === 400) {
        // Structural failure — do not re-queue (would loop forever)
        console.error('[publisher-transport] 400 Bad Request — batch dropped. Body:', await response.text().catch(() => ''));
        this.retryBackoffMs = 0;
        this.retryAfter = 0;
        this.emitStatus('error', '400 Bad Request — batch dropped');
      } else if (response.status === 401) {
        this.queue.unshift(...batch);
        this.emitStatus('error', '401 Unauthorized — check token');
      } else if (response.status === 429) {
        this.queue.unshift(...batch);
        this.applyBackoff();
        this.emitStatus('error', `429 Rate Limited — retry in ${this.retryBackoffMs}ms`);
      } else {
        // 5xx or unexpected
        this.queue.unshift(...batch);
        this.applyBackoff();
        this.emitStatus('error', `HTTP ${response.status} — retry in ${this.retryBackoffMs}ms`);
      }
    } finally {
      this.flushing = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private applyBackoff(): void {
    this.retryBackoffMs = Math.min(
      (this.retryBackoffMs || INITIAL_BACKOFF_MS) * 2,
      MAX_RETRY_BACKOFF_MS,
    );
    this.retryAfter = Date.now() + this.retryBackoffMs;
  }

  private emitStatus(status: TransportStatus['status'], message?: string): void {
    this.onStatusChange?.({
      status,
      message,
      eventsQueuedTotal: this.eventsQueuedTotal,
      lastFlushAt: this.lastFlushAt,
    });
  }
}

// ---------------------------------------------------------------------------
// Publisher config auto-discovery
// ---------------------------------------------------------------------------

/**
 * Fetch publisher configuration from GET /api/publisher-config/{publisherCode}.
 *
 * The publisher rig only needs its `publisherCode` (a short string like "rig-01").
 * Race Control returns the active `raceSessionId`, `displayName`, and `gatewayUrl`.
 * The settings UI can call this to auto-populate fields on behalf of the driver.
 *
 * @throws Error if unauthenticated, code not found (404), or session not provisioned (503)
 */
export async function fetchPublisherConfig(
  publisherCode: string,
  getAuthToken: () => Promise<string | null>,
  baseUrl = 'https://simracecenter.com',
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<PublisherConfigResponse> {
  const token = await getAuthToken();
  if (!token) throw new Error('fetchPublisherConfig: no auth token available');

  const url = `${baseUrl}/api/publisher-config/${encodeURIComponent(publisherCode)}`;
  const res = await fetchFn(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`fetchPublisherConfig: HTTP ${res.status}${body ? ` — ${body}` : ''}`);
  }

  return res.json() as Promise<PublisherConfigResponse>;
}
