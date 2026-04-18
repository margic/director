/**
 * cloud-poller.ts
 *
 * Event-driven sequence fetcher for the Director Loop.
 * Responsible for:
 * - Fetching next sequence from Race Control API
 * - Handling response codes (200, 204, 410)
 * - Respecting Retry-After headers
 * - Reporting active intents to Race Control
 * - Invoking callbacks for sequence arrival and session end
 *
 * Fetch-on-completion model (per OpenAPI spec):
 * - On start: makes a single initial fetch
 * - On 200 (sequence received): stops fetching, waits for onSequenceCompleted()
 * - On 204 (no sequence): schedules a single retry (Retry-After or idleRetryMs)
 * - On onSequenceCompleted(): immediately fetches the next sequence
 *
 * Does NOT execute sequences directly — delegates to SequenceScheduler via onSequence callback.
 */

import { AuthService } from './auth-service';
import { PortableSequence, RaceContext } from './director-types';
import { normalizeApiResponse } from './normalizer';
import { apiConfig } from './auth-config';
import { telemetryService } from './telemetry-service';

export interface CloudPollerOptions {
  /**
   * Idle retry interval when RC returns 204 (no sequence available).
   * Default: 5000ms (5 seconds)
   */
  idleRetryMs?: number;

  /**
   * Function that returns the list of currently active intent handlers.
   * Sent as the `intents` query parameter to constrain sequence generation.
   */
  getActiveIntents: () => string[];

  /**
   * Callback invoked when a sequence is received from the API.
   * Should enqueue the sequence in SequenceScheduler.
   */
  onSequence: (sequence: PortableSequence) => void;

  /**
   * Callback invoked when the API returns 410 Gone (session ended).
   * Should stop the polling loop and clean up resources.
   */
  onSessionEnded: () => void;

  /**
   * Returns a live race context snapshot for the Tier-2 Executor model.
   * Included as `raceContext` in the POST body to /sequences/next.
   */
  getRaceContext?: () => RaceContext | null;

  /**
   * Optional check-in ID for the current session.
   */
  checkinId?: string;

  /**
   * Optional check-in TTL in seconds.
   * Used to enforce minimum polling frequency (1/4 of TTL) to maintain heartbeat.
   */
  checkinTtlSeconds?: number;
}

export class CloudPoller {
  private isRunning = false;
  private pendingRetry: NodeJS.Timeout | null = null;
  private lastCompletedSequenceId: string | null = null;
  private awaitingCompletion = false;
  private retried401 = false;
  private readonly idleRetryMs: number;

  constructor(
    private authService: AuthService,
    private raceSessionId: string,
    private options: CloudPollerOptions
  ) {
    this.idleRetryMs = options.idleRetryMs ?? 5000;
  }

  /**
   * Start the fetcher. Makes a single initial request.
   */
  start(): void {
    if (this.isRunning) {
      console.warn('[CloudPoller] Already running');
      return;
    }
    console.log(`[CloudPoller] Starting for session: ${this.raceSessionId}`);
    this.isRunning = true;
    this.awaitingCompletion = false;
    this.fetchNext();
  }

  /**
   * Stop the fetcher and cancel any pending retry.
   */
  stop(): void {
    if (!this.isRunning) return;
    console.log('[CloudPoller] Stopping');
    this.isRunning = false;
    this.awaitingCompletion = false;
    this.retried401 = false;
    if (this.pendingRetry) {
      clearTimeout(this.pendingRetry);
      this.pendingRetry = null;
    }
  }

  /**
   * Check if the fetcher is currently running.
   */
  isPolling(): boolean {
    return this.isRunning;
  }

  /**
   * Update the check-in ID and TTL for heartbeat management.
   */
  updateCheckin(checkinId: string, checkinTtlSeconds: number): void {
    this.options.checkinId = checkinId;
    this.options.checkinTtlSeconds = checkinTtlSeconds;
  }

  /**
   * Clear the check-in ID and TTL.
   */
  clearCheckin(): void {
    this.options.checkinId = undefined;
    this.options.checkinTtlSeconds = undefined;
  }

  /**
   * Notify the fetcher that a sequence has completed execution.
   * This is the primary trigger for fetching the next sequence.
   * Only fetches if we are actually waiting for a completion signal.
   */
  onSequenceCompleted(sequenceId: string): void {
    this.lastCompletedSequenceId = sequenceId;
    if (!this.isRunning) return;

    if (!this.awaitingCompletion) {
      console.warn(`[CloudPoller] onSequenceCompleted('${sequenceId}') called but not awaiting completion — ignoring`);
      return;
    }

    console.log(`[CloudPoller] Sequence '${sequenceId}' completed — fetching next`);
    this.awaitingCompletion = false;
    // Cancel any pending retry (e.g. heartbeat) before fetching
    if (this.pendingRetry) {
      clearTimeout(this.pendingRetry);
      this.pendingRetry = null;
    }
    this.fetchNext();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Single fetch attempt. Handles the response and decides what to do next:
   * - 200: deliver sequence, enter awaitingCompletion state (no more fetching)
   * - 204: schedule a single retry after Retry-After or idleRetryMs
   * - 410: stop (session ended)
   * - error/other: schedule a retry after idleRetryMs
   */
  private async fetchNext(): Promise<void> {
    if (!this.isRunning) return;

    const delayMs = await this.fetchNextSequence();

    // If we received a sequence (awaitingCompletion=true), don't schedule any retry.
    // The next fetch will be triggered by onSequenceCompleted().
    if (this.awaitingCompletion || !this.isRunning) return;

    // Schedule a single retry for 204/error cases
    this.scheduleRetry(delayMs);
  }

  /**
   * Schedule a single retry fetch after the given delay.
   * Respects the heartbeat floor rate for check-in TTL.
   */
  private scheduleRetry(delayMs: number): void {
    if (!this.isRunning) return;

    let interval = delayMs;

    // Heartbeat floor rate contract: retry at min(interval, checkinTtlSeconds / 4)
    // to prevent check-in TTL from lapsing during long Retry-After intervals.
    if (this.options.checkinId && this.options.checkinTtlSeconds) {
      const maxIntervalMs = (this.options.checkinTtlSeconds * 1000) / 4;
      interval = Math.min(interval, maxIntervalMs);
    }

    this.pendingRetry = setTimeout(() => {
      this.pendingRetry = null;
      this.fetchNext();
    }, interval);
  }

  /**
   * Fetch the next sequence from the Race Control API.
   * Returns the delay in milliseconds before the next request should be made.
   *
   * Return values:
   * - idleRetryMs: No sequence available (204 without Retry-After)
   * - n > 0: Retry-After header specified delay in milliseconds
   * - 0: Should not happen (sequences are no longer executed here)
   */
  private async fetchNextSequence(): Promise<number> {
    const startTime = Date.now();
    const token = await this.authService.getAccessToken();
    if (!token) {
      console.warn('[CloudPoller] No access token available');
      return this.idleRetryMs;
    }

    try {
      // Build POST body per RFC #203 — race context is the primary input
      // to the Tier-2 Executor model's decision.
      const body: Record<string, unknown> = {};

      if (this.lastCompletedSequenceId) {
        body.lastSequenceId = this.lastCompletedSequenceId;
      }

      const activeIntents = this.options.getActiveIntents();
      if (activeIntents.length > 0) {
        body.intents = activeIntents;
      }

      if (this.options.getRaceContext) {
        const ctx = this.options.getRaceContext();
        if (ctx) {
          body.raceContext = ctx;
        }
      }

      const url = `${apiConfig.baseUrl}${apiConfig.endpoints.nextSequence(this.raceSessionId)}`;
      console.log('[CloudPoller] Requesting next sequence from:', url);

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      if (this.options.checkinId) {
        headers['X-Checkin-Id'] = this.options.checkinId;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const duration = Date.now() - startTime;

      // Handle 410 Gone — session has ended (COMPLETED or CANCELED)
      if (response.status === 410) {
        console.log('[CloudPoller] Session ended (410 Gone). Stopping polling.');
        telemetryService.trackDependency(
          'RaceControl API', url, duration, true, 410, 'HTTP',
          { sessionId: this.raceSessionId, result: 'session-ended' }
        );
        this.stop();
        this.options.onSessionEnded();
        return this.idleRetryMs; // Won't be used since we stopped
      }

      // Handle 204 No Content — no sequence available
      if (response.status === 204) {
        const retryAfter = response.headers.get('Retry-After');
        console.log(`[CloudPoller] No new sequence available (204)${retryAfter ? `, Retry-After: ${retryAfter}s` : ''}`);
        telemetryService.trackDependency(
          'RaceControl API', url, duration, true, 204, 'HTTP',
          { sessionId: this.raceSessionId, result: 'no-sequence' }
        );

        // Respect Retry-After header if present
        if (retryAfter) {
          const retryMs = parseInt(retryAfter, 10) * 1000;
          if (!isNaN(retryMs) && retryMs > 0) {
            return retryMs;
          }
        }
        return this.idleRetryMs;
      }

      // Handle 401 Unauthorized — could be expired OAuth token OR invalid check-in.
      // The API returns 401 for both cases when enforcement mode is active.
      // Log the response body to distinguish, then try refreshing the token once.
      if (response.status === 401 && !this.retried401) {
        const body = await response.text().catch(() => '');
        console.warn(`[CloudPoller] 401 Unauthorized — ${body || 'no response body'}`);
        console.warn(`[CloudPoller] checkinId=${this.options.checkinId ?? 'none'}`);
        this.retried401 = true;
        telemetryService.trackDependency(
          'RaceControl API', url, duration, false, 401, 'HTTP',
          { sessionId: this.raceSessionId, action: 'token-refresh', body }
        );
        const freshToken = await this.authService.getAccessToken(true);
        if (freshToken) {
          return 0; // Retry immediately with the refreshed token
        }
        console.error('[CloudPoller] Token refresh failed — cannot recover');
        return this.idleRetryMs;
      }

      // Handle non-2xx responses
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(`[CloudPoller] Failed to fetch next sequence: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`);
        telemetryService.trackDependency(
          'RaceControl API', url, duration, false, response.status, 'HTTP',
          { sessionId: this.raceSessionId, body }
        );
        return this.idleRetryMs;
      }

      // Successful request — reset 401 retry flag
      this.retried401 = false;

      // Handle 200 OK — sequence received
      const sequenceData: any = await response.json();
      console.log('[CloudPoller] Received sequence:', JSON.stringify(sequenceData, null, 2));

      // Phase 7: Extract execution path metadata for observability (#76)
      const executionPath = sequenceData.metadata?.executionPath as string | undefined;

      telemetryService.trackDependency(
        'RaceControl API', url, duration, true, response.status, 'HTTP',
        { sessionId: this.raceSessionId, ...(executionPath && { executionPath }) }
      );

      // Normalize API response — validates PortableSequence format (steps/intent)
      const portable = normalizeApiResponse(sequenceData);

      if (executionPath) {
        console.log(`[CloudPoller] Sequence '${portable.id}' executionPath: ${executionPath} (${duration}ms)`);
      }

      telemetryService.trackEvent('Sequence.Received', {
        sequenceId: portable.id,
        sessionId: this.raceSessionId,
        stepCount: portable.steps.length.toString(),
        priority: String(portable.priority || false),
        ...(executionPath && { executionPath }),
      });

      // Invoke callback to enqueue the sequence in SequenceScheduler
      this.options.onSequence(portable);

      // Enter awaiting-completion state: no more fetching until onSequenceCompleted()
      this.awaitingCompletion = true;
      return 0; // Not used — fetchNext() checks awaitingCompletion and skips scheduling

    } catch (error) {
      console.error('[CloudPoller] Error fetching sequence:', error);
      const duration = Date.now() - startTime;
      telemetryService.trackDependency(
        'RaceControl API',
        `${apiConfig.baseUrl}${apiConfig.endpoints.nextSequence(this.raceSessionId)}`,
        duration,
        false,
        0,
        'HTTP',
        { error: (error as Error).message }
      );
      telemetryService.trackException(error as Error, {
        operation: 'fetchNextSequence',
        sessionId: this.raceSessionId,
      });
      return this.idleRetryMs;
    }
  }
}
