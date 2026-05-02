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
import { PortableSequence, RaceContext, NextSequenceRequest } from './director-types';
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
   * Sent in the POST body to constrain sequence generation.
   */
  getActiveIntents: () => string[];

  /**
   * Function that returns the current live race context from iRacing.
   * Sent as raceContext in the POST body with every sequences/next request.
   * If not provided, a minimal disconnected context is used.
   */
  getRaceContext?: () => RaceContext;

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
   * Optional check-in ID for the current session.
   */
  checkinId?: string;

  /**
   * Optional check-in TTL in seconds.
   * Used to enforce minimum polling frequency (1/4 of TTL) to maintain heartbeat.
   */
  checkinTtlSeconds?: number;

  /**
   * How many ms before the estimated sequence end to fire the pre-fetch request.
   * Only active when onSequenceStarted() is called with a known estimatedDurationMs.
   * Default: 8000ms (8 seconds — accounts for RC two-tier AI latency).
   */
  prefetchLeadMs?: number;

  /**
   * Minimum time after sequence start before firing the pre-fetch.
   * Prevents hammering RC immediately on very short sequences.
   * Default: 2000ms.
   */
  minPrefetchMs?: number;
}

export class CloudPoller {
  private isRunning = false;
  private loopInterval: NodeJS.Timeout | null = null;
  private prefetchTimer: NodeJS.Timeout | null = null;
  private lastCompletedSequenceId: string | null = null;
  private awaitingCompletion = false;
  /** Sequence fetched ahead of time by the pre-fetch timer, held until onSequenceCompleted delivers it. */
  private bufferedSequence: PortableSequence | null = null;
  private readonly idleRetryMs: number;
  private readonly prefetchLeadMs: number;
  private readonly minPrefetchMs: number;

  constructor(
    private authService: AuthService,
    private raceSessionId: string,
    private options: CloudPollerOptions
  ) {
    this.idleRetryMs = options.idleRetryMs ?? 5000;
    this.prefetchLeadMs = options.prefetchLeadMs ?? 8000;
    this.minPrefetchMs = options.minPrefetchMs ?? 2000;
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
    this.awaitingCompletion = false;
    this.bufferedSequence = null;
    if (this.loopInterval) {
      clearTimeout(this.loopInterval);
      this.loopInterval = null;
    }
    if (this.prefetchTimer) {
      clearTimeout(this.prefetchTimer);
      this.prefetchTimer = null;
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
    this.awaitingCompletion = false;

    // Single delivery path: if the pre-fetch stored a sequence, deliver it now.
    // The pre-fetch never calls onSequence directly — only this method does.
    if (this.bufferedSequence) {
      const next = this.bufferedSequence;
      this.bufferedSequence = null;
      this.awaitingCompletion = true;
      console.log(`[CloudPoller] Delivering pre-fetched sequence ${next.id} on completion of ${sequenceId}`);
      this.options.onSequence(next);
      return;
    }

    // No buffer — fall back to immediate fetch
    if (this.isRunning) {
      if (this.loopInterval) {
        clearTimeout(this.loopInterval);
      }
      this.loopInterval = setTimeout(() => this.requestLoop(), 0);
    }
  }

  /**
   * Notify the poller that a new sequence has started executing.
   * If estimatedDurationMs is known, schedules a pre-fetch so the next sequence
   * is ready in the queue the moment the current one finishes.
   *
   * Pre-fetch fires at: max(estimatedDurationMs - prefetchLeadMs, minPrefetchMs)
   *
   * On 200: the sequence is enqueued immediately — zero gap on completion.
   * On 204: silent no-op — onSequenceCompleted drives the next request normally.
   * On error: logged and discarded — normal completion path still works.
   */
  onSequenceStarted(sequenceId: string, estimatedDurationMs?: number): void {
    // Clear any previously scheduled prefetch
    if (this.prefetchTimer) {
      clearTimeout(this.prefetchTimer);
      this.prefetchTimer = null;
    }

    if (!estimatedDurationMs || estimatedDurationMs <= 0 || !this.isRunning) {
      return; // No timing hint — rely on onSequenceCompleted
    }

    const fireAt = Math.max(estimatedDurationMs - this.prefetchLeadMs, this.minPrefetchMs);
    console.log(
      `[CloudPoller] Pre-fetch scheduled in ${fireAt}ms` +
      ` (estimated: ${estimatedDurationMs}ms, lead: ${this.prefetchLeadMs}ms, seq: ${sequenceId})`
    );

    this.prefetchTimer = setTimeout(async () => {
      this.prefetchTimer = null;
      if (!this.isRunning) return;
      await this.firePrefetch();
    }, fireAt);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * One-shot pre-fetch fired during sequence execution to warm up the queue.
   * Stores the result in bufferedSequence — does NOT call onSequence directly.
   * onSequenceCompleted() is the sole delivery path; it reads and clears the buffer.
   *
   * The carCount=0 guard is bypassed here: the pre-fetch fires while a sequence is
   * already executing (which confirmed cars were present when it was dispatched).
   */
  private async firePrefetch(): Promise<void> {
    console.log('[CloudPoller] Firing pre-fetch for next sequence');
    await this.fetchNextSequence({ skipCarCheck: true, storeOnly: true });
  }

  /**
   * Main polling loop.
   * Fetches next sequence and schedules the next iteration based on response.
   */
  private async requestLoop(): Promise<void> {
    if (!this.isRunning) return;

    const delayMs = await this.fetchNextSequence();

    // If we received a sequence, park here — onSequenceCompleted() restarts the loop.
    // Do NOT apply the heartbeat cap in this state: the sequence request itself refreshed
    // the check-in TTL, and applying TTL/4 would re-poll while the sequence is still active.
    if (this.awaitingCompletion) return;

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
  private async fetchNextSequence(opts?: { skipCarCheck?: boolean; storeOnly?: boolean }): Promise<number> {
    const startTime = Date.now();
    const token = await this.authService.getAccessToken();
    if (!token) {
      console.warn('[CloudPoller] No access token available');
      return this.idleRetryMs;
    }

    try {
      // checkinId goes as query param fallback in case SWA strips custom headers
      const params = new URLSearchParams();
      if (this.options.checkinId) {
        params.set('checkinId', this.options.checkinId);
      }

      const baseUrl = `${apiConfig.baseUrl}${apiConfig.endpoints.nextSequence(this.raceSessionId)}`;
      const url = params.toString() ? `${baseUrl}?${params}` : baseUrl;

      // Build POST body per updated OpenAPI spec (POST /sequences/next with raceContext)
      const activeIntents = this.options.getActiveIntents();
      const raceContext: RaceContext = this.options.getRaceContext
        ? this.options.getRaceContext()
        : {
            sessionType: 'Race',
            sessionFlags: 'disconnected',
            lapsRemain: -1,
            carCount: 0,
            drivers: [],
            contextTimestamp: new Date().toISOString(),
          };

      // Skip POST if iRacing has no car data yet — the spec requires a non-empty drivers array.
      // This happens during session load before the driver roster is populated.
      // Pre-fetch calls bypass this check (skipCarCheck=true) since a sequence is already
      // executing which confirms cars were present when it was dispatched.
      if (raceContext.carCount === 0 && !opts?.skipCarCheck) {
        console.log('[CloudPoller] Skipping sequence request — no car data yet (carCount=0), will retry.');
        return this.idleRetryMs;
      }

      const requestBody: NextSequenceRequest = {
        raceContext,
        ...(activeIntents.length > 0 ? { intents: activeIntents } : {}),
        ...(this.lastCompletedSequenceId ? { lastSequenceId: this.lastCompletedSequenceId } : {}),
      };

      console.log('[CloudPoller] POST next sequence for session:', this.raceSessionId,
        `(sessionType=${raceContext.sessionType}, flags=${raceContext.sessionFlags}, cars=${raceContext.carCount})`);

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
        body: JSON.stringify(requestBody),
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
      const executionPath: string = sequenceData.metadata?.executionPath ?? 'unknown';
      console.log(`[CloudPoller] Received sequence: ${sequenceData.id} (executionPath=${executionPath})`);

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
        executionPath,
      });

      if (opts?.storeOnly) {
        // Pre-fetch path: store for delivery by onSequenceCompleted — do not call onSequence here.
        console.log(`[CloudPoller] Pre-fetched sequence ${portable.id} — buffered for next completion`);
        this.bufferedSequence = portable;
        return 0; // unused; pre-fetch doesn't drive the loop
      }

      // Main loop path: deliver immediately and park until completion.
      this.options.onSequence(portable);
      this.awaitingCompletion = true;
      return 3600000; // large sentinel — ignored because awaitingCompletion=true

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
