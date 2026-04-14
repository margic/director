/**
 * cloud-poller.ts
 *
 * Extracted polling loop from DirectorService.
 * Responsible for:
 * - Fetching next sequence from Race Control API
 * - Handling response codes (200, 204, 410)
 * - Respecting Retry-After headers
 * - Reporting active intents to Race Control
 * - Invoking callbacks for sequence arrival and session end
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
  private loopInterval: NodeJS.Timeout | null = null;
  private lastCompletedSequenceId: string | null = null;
  private readonly idleRetryMs: number;

  constructor(
    private authService: AuthService,
    private raceSessionId: string,
    private options: CloudPollerOptions
  ) {
    this.idleRetryMs = options.idleRetryMs ?? 5000;
  }

  /**
   * Start the polling loop.
   */
  start(): void {
    if (this.isRunning) {
      console.warn('[CloudPoller] Already running');
      return;
    }
    console.log(`[CloudPoller] Starting polling for session: ${this.raceSessionId}`);
    this.isRunning = true;
    this.requestLoop();
  }

  /**
   * Stop the polling loop.
   */
  stop(): void {
    if (!this.isRunning) return;
    console.log('[CloudPoller] Stopping polling');
    this.isRunning = false;
    if (this.loopInterval) {
      clearTimeout(this.loopInterval);
      this.loopInterval = null;
    }
  }

  /**
   * Check if the poller is currently running.
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
   * Notify the poller that a sequence has completed execution.
   * Updates lastCompletedSequenceId so it's sent with the next request.
   * Triggers immediate retry (no delay) since execution consumed the time.
   */
  onSequenceCompleted(sequenceId: string): void {
    this.lastCompletedSequenceId = sequenceId;
    // Trigger immediate retry — execution itself consumed the time (10-60s typically)
    if (this.isRunning) {
      if (this.loopInterval) {
        clearTimeout(this.loopInterval);
      }
      this.loopInterval = setTimeout(() => this.requestLoop(), 0);
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Main polling loop.
   * Fetches next sequence and schedules the next iteration based on response.
   */
  private async requestLoop(): Promise<void> {
    if (!this.isRunning) return;

    const delayMs = await this.fetchNextSequence();

    // Schedule next iteration if still running
    if (this.isRunning) {
      let interval = delayMs;

      // Heartbeat floor rate contract: poll at min(interval, checkinTtlSeconds / 4)
      // to prevent check-in TTL from lapsing during long Retry-After intervals.
      if (this.options.checkinId && this.options.checkinTtlSeconds) {
        const maxIntervalMs = (this.options.checkinTtlSeconds * 1000) / 4;
        interval = Math.min(interval, maxIntervalMs);
      }

      this.loopInterval = setTimeout(() => this.requestLoop(), interval);
    }
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

      // Handle non-2xx responses
      if (!response.ok) {
        console.error(`[CloudPoller] Failed to fetch next sequence: ${response.status} ${response.statusText}`);
        telemetryService.trackDependency(
          'RaceControl API', url, duration, false, response.status, 'HTTP',
          { sessionId: this.raceSessionId }
        );
        return this.idleRetryMs;
      }

      // Handle 200 OK — sequence received
      const sequenceData: any = await response.json();
      console.log('[CloudPoller] Received sequence:', JSON.stringify(sequenceData, null, 2));

      telemetryService.trackDependency(
        'RaceControl API', url, duration, true, response.status, 'HTTP',
        { sessionId: this.raceSessionId }
      );

      // Normalize API response — validates PortableSequence format (steps/intent)
      const portable = normalizeApiResponse(sequenceData);

      telemetryService.trackEvent('Sequence.Received', {
        sequenceId: portable.id,
        sessionId: this.raceSessionId,
        stepCount: portable.steps.length.toString(),
        priority: String(portable.priority || false),
      });

      // Invoke callback to enqueue the sequence in SequenceScheduler
      this.options.onSequence(portable);

      // Don't request next sequence immediately — wait for execution completion callback
      // (onSequenceCompleted will trigger immediate retry)
      // Return a large delay that will be cleared by onSequenceCompleted
      return 3600000; // 1 hour (effectively infinite, will be cleared)

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
