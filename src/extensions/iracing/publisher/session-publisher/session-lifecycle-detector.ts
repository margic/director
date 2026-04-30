/**
 * session-lifecycle-detector.ts — Issue #90
 *
 * Detects session lifecycle transitions from consecutive TelemetryFrames and
 * emits the appropriate publisher events:
 *
 *   SESSION_LOADED      — sessionUniqueId changes; resets per-session state cache
 *   SESSION_STATE_CHANGE — SessionState enum value changes
 *   RACE_GREEN          — transition into Racing state with Green flag set
 *   RACE_CHECKERED      — Checkered flag bit set OR state transitions to Checkered
 *   SESSION_ENDED       — state transitions to CoolDown, or new sessionUniqueId
 *
 * Design: pure-ish function — receives prev (nullable) and curr frames plus the
 * mutable SessionState. Returns an array of events to enqueue; never calls the
 * transport directly. State mutations (lastSessionState, previousFrame) are the
 * caller's responsibility after this function returns.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import type { PublisherEvent } from '../event-types';
import { buildEvent } from '../session-state';

// ---------------------------------------------------------------------------
// iRacing SessionState enum values
// ---------------------------------------------------------------------------

export const SESSION_STATE = {
  Invalid:     0,
  GetInCar:    1,
  Warmup:      2,
  ParadeLaps:  3,
  Racing:      4,
  Checkered:   5,
  CoolDown:    6,
} as const;

// iRacing SessionFlags bitmasks
export const FLAG_CHECKERED   = 0x0001;
export const FLAG_WHITE       = 0x0002;
export const FLAG_GREEN       = 0x0004;
export const FLAG_YELLOW      = 0x0008;
export const FLAG_CAUTION     = 0x4000; // full-course caution

// ---------------------------------------------------------------------------
// Detector context — caller passes this in (populated from extension config)
// ---------------------------------------------------------------------------

export interface SessionLifecycleContext {
  publisherCode: string;
  raceSessionId: string;
  /** trackName from session YAML (cached by extension) */
  trackName?: string;
}

// ---------------------------------------------------------------------------
// detectSessionLifecycle
// ---------------------------------------------------------------------------

/**
 * Called once per telemetry poll with the previous and current frames.
 *
 * @param prev    Previous TelemetryFrame, or null on first poll after connect
 * @param curr    Current TelemetryFrame
 * @param state   Mutable per-session state; this function reads it but does NOT
 *                update `previousFrame` — the caller does that after enqueue.
 * @param ctx     Static context (publisherCode, raceSessionId, etc.)
 * @returns       Array of events to enqueue (may be empty)
 */
export function detectSessionLifecycle(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: SessionLifecycleContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];

  // Sentinel car ref — lifecycle events are session-wide, not car-specific
  const nocar = { carIdx: -1, carNumber: '', driverName: '' };

  const opts = {
    raceSessionId: ctx.raceSessionId,
    publisherCode: ctx.publisherCode,
    frame: curr,
  };

  // -------------------------------------------------------------------------
  // SESSION_LOADED — sessionUniqueId changed (new subsession / session reset)
  // Also fires SESSION_ENDED for the previous session.
  // -------------------------------------------------------------------------
  if (prev !== null && curr.sessionUniqueId !== prev.sessionUniqueId) {
    // Close out the old session first
    events.push(buildEvent('SESSION_ENDED', nocar, {}, opts));

    events.push(buildEvent('SESSION_LOADED', nocar, {
      sessionUniqueId: curr.sessionUniqueId,
      trackName: ctx.trackName ?? '',
      seriesName: '',
      sessionType: '',
      totalLaps: 0,
    }, opts));

    return events; // No further transition detection until next frame
  }

  // -------------------------------------------------------------------------
  // SESSION_STATE_CHANGE — SessionState enum value changed
  // -------------------------------------------------------------------------
  const prevState = prev?.sessionState ?? state.lastSessionState;
  const currState = curr.sessionState;

  if (prevState !== currState && prevState !== -1) {
    events.push(buildEvent('SESSION_STATE_CHANGE', nocar, {
      previousState: prevState,
      newState: currState,
    }, opts));

    // RACE_GREEN — transition TO Racing while green flag bit is set
    if (currState === SESSION_STATE.Racing && (curr.sessionFlags & FLAG_GREEN) !== 0) {
      const startType = prevState === SESSION_STATE.ParadeLaps ? 'rolling' : 'standing';
      events.push(buildEvent('RACE_GREEN', nocar, { startType }, opts));
    }

    // RACE_CHECKERED — transition TO Checkered state
    if (currState === SESSION_STATE.Checkered) {
      events.push(buildEvent('RACE_CHECKERED', nocar, {}, opts));
    }

    // SESSION_ENDED — transition TO CoolDown
    if (currState === SESSION_STATE.CoolDown) {
      events.push(buildEvent('SESSION_ENDED', nocar, {}, opts));
    }
  }

  // -------------------------------------------------------------------------
  // RACE_CHECKERED — flag bit fires before/without a state transition
  // Guard: only emit once; skip if already emitted above via state transition.
  // -------------------------------------------------------------------------
  const checkeredAlreadyFired = state.lastSessionState >= SESSION_STATE.Checkered;
  if (!checkeredAlreadyFired && (curr.sessionFlags & FLAG_CHECKERED) !== 0) {
    const alreadyEmittedViaState = currState === SESSION_STATE.Checkered && prevState !== SESSION_STATE.Checkered;
    if (!alreadyEmittedViaState) {
      events.push(buildEvent('RACE_CHECKERED', nocar, {}, opts));
    }
  }

  return events;
}
