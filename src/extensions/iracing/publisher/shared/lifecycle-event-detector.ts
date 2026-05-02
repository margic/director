/**
 * lifecycle-event-detector.ts — Issue #92
 *
 * Emits publisher lifecycle events:
 *
 *   PUBLISHER_HELLO       — on extension activate with publisher.enabled=true
 *   PUBLISHER_HEARTBEAT   — 30s, only when no other event was emitted in the last 30 seconds
 *   PUBLISHER_GOODBYE     — on extension deactivate / app shutdown
 *   IRACING_CONNECTED     — when iRacing shared memory becomes available
 *   IRACING_DISCONNECTED  — when iRacing shared memory is lost
 *
 * Design: stateful class (tracks last emission time for heartbeat suppression).
 * The `getNow` clock is injected for testability.
 */

import { randomUUID } from 'crypto';
import type { PublisherEvent, PublisherEventType, EventPayloadMap } from '../event-types';

// ---------------------------------------------------------------------------
// Context passed by the orchestrator
// ---------------------------------------------------------------------------

export interface LifecycleDetectorContext {
  rigId: string;
  raceSessionId: string;
  /** Semver version string from the extension manifest */
  version: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 30_000;
const CAPABILITIES = ['telemetry-v1'];
const NOCAR = { carIdx: -1, carNumber: '', driverName: '' };

// ---------------------------------------------------------------------------
// LifecycleEventDetector
// ---------------------------------------------------------------------------

export class LifecycleEventDetector {
  /** Timestamp (ms) of the last emitted event — used for heartbeat suppression. */
  private lastEventAt = 0;

  /**
   * @param getNow  Injectable clock — defaults to `Date.now`. Swap in tests for
   *                deterministic time control.
   */
  constructor(private readonly getNow: () => number = () => Date.now()) {}

  // ---------------------------------------------------------------------------
  // Public lifecycle hooks
  // ---------------------------------------------------------------------------

  /**
   * Call once when the publisher becomes active (publisher.enabled flipped to
   * true, or on extension activate if already enabled).
   */
  onActivate(ctx: LifecycleDetectorContext): PublisherEvent[] {
    const event = this.build('PUBLISHER_HELLO', ctx, {
      version: ctx.version,
      capabilities: [...CAPABILITIES],
    });
    this.notifyEventEmitted();
    return [event];
  }

  /**
   * Call on extension deactivate or app shutdown.
   */
  onDeactivate(ctx: LifecycleDetectorContext): PublisherEvent[] {
    const event = this.build('PUBLISHER_GOODBYE', ctx, {});
    this.notifyEventEmitted();
    return [event];
  }

  /**
   * Call when iRacing connection state changes.
   * Emits `IRACING_CONNECTED` (connected=true) or `IRACING_DISCONNECTED` (connected=false).
   */
  onConnectionChange(connected: boolean, ctx: LifecycleDetectorContext): PublisherEvent[] {
    const event = connected
      ? this.build('IRACING_CONNECTED', ctx, {})
      : this.build('IRACING_DISCONNECTED', ctx, {});
    this.notifyEventEmitted();
    return [event];
  }

  /**
   * Call at ~30s intervals from the telemetry poll loop.
   * Returns a `PUBLISHER_HEARTBEAT` event ONLY if no other event was emitted in
   * the past 30 seconds. Returns an empty array otherwise.
   */
  checkHeartbeat(ctx: LifecycleDetectorContext): PublisherEvent[] {
    const now = this.getNow();
    if (now - this.lastEventAt >= HEARTBEAT_INTERVAL_MS) {
      const event = this.build('PUBLISHER_HEARTBEAT', ctx, {});
      this.lastEventAt = now;
      return [event];
    }
    return [];
  }

  /**
   * Notify the detector that an event was enqueued to the transport.
   * Must be called by the orchestrator after every event from any detector so
   * that the heartbeat suppression window resets correctly.
   */
  notifyEventEmitted(): void {
    this.lastEventAt = this.getNow();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private build<T extends PublisherEventType>(
    type: T,
    ctx: LifecycleDetectorContext,
    payload: EventPayloadMap[T],
  ): PublisherEvent<T> {
    return {
      id: randomUUID(),
      raceSessionId: ctx.raceSessionId,
      rigId: ctx.rigId,
      type,
      timestamp: this.getNow(),
      sessionTime: 0,
      sessionTick: 0,
      car: NOCAR,
      payload,
    };
  }
}
