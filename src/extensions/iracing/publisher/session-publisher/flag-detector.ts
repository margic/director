/**
 * flag-detector.ts — Issue #89
 *
 * Tier 1 flag events detected by diffing the SessionFlags bitmask between
 * consecutive TelemetryFrames (rising-edge detection only).
 *
 * Events:
 *   FLAG_GREEN            — Green bit rises
 *   FLAG_WHITE            — White bit rises
 *   FLAG_YELLOW_LOCAL     — Yellow bit rises WITHOUT the Caution bit set
 *   FLAG_YELLOW_FULL_COURSE — Yellow+Caution compound becomes fully set
 *                            (handles both simultaneous rise and caution
 *                             escalating an existing local yellow)
 *
 * Tier 4 flags (FLAG_RED, FLAG_BLUE_DRIVER, FLAG_BLACK_DRIVER, …) are
 * deferred to issue #99.
 *
 * Design: pure function — no side-effects, no state mutations.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import type { PublisherEvent } from '../event-types';
import { buildEvent } from '../session-state';
import {
  FLAG_CHECKERED,
  FLAG_WHITE,
  FLAG_GREEN,
  FLAG_YELLOW,
  FLAG_CAUTION,
} from './session-lifecycle-detector';

// Re-export so consumers importing from flag-detector directly still work.
export { FLAG_CHECKERED, FLAG_WHITE, FLAG_GREEN, FLAG_YELLOW, FLAG_CAUTION };

export interface FlagDetectorContext {
  publisherCode: string;
  raceSessionId: string;
}

// ---------------------------------------------------------------------------
// detectFlags — pure function
// ---------------------------------------------------------------------------

/**
 * @param prev  Previous TelemetryFrame, or null on first poll (no baseline →
 *              no events emitted)
 * @param curr  Current TelemetryFrame
 * @param state Per-session state (not mutated; passed through to buildEvent)
 * @param ctx   Static publisher context
 * @returns     Array of flag events (may be empty)
 */
export function detectFlags(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: FlagDetectorContext,
): PublisherEvent[] {
  if (prev === null) return [];

  const events: PublisherEvent[] = [];
  const prevFlags = prev.sessionFlags;
  const currFlags = curr.sessionFlags;
  const opts = { raceSessionId: ctx.raceSessionId, publisherCode: ctx.publisherCode, frame: curr };
  const nocar = { carIdx: -1, carNumber: '', driverName: '' };

  /** True when `bit` was off in prev and is on in curr. */
  const rose = (bit: number) => (currFlags & bit) !== 0 && (prevFlags & bit) === 0;

  // -------------------------------------------------------------------------
  // FLAG_GREEN
  // -------------------------------------------------------------------------
  if (rose(FLAG_GREEN)) {
    events.push(buildEvent('FLAG_GREEN', nocar, {}, opts));
  }

  // -------------------------------------------------------------------------
  // FLAG_WHITE
  // -------------------------------------------------------------------------
  if (rose(FLAG_WHITE)) {
    events.push(buildEvent('FLAG_WHITE', nocar, {}, opts));
  }

  // -------------------------------------------------------------------------
  // FLAG_YELLOW_FULL_COURSE vs FLAG_YELLOW_LOCAL
  //
  // Full-course: both Yellow AND Caution are now set AND they were not both
  // set previously (so we fire exactly once on the transition, whether the
  // bits rise simultaneously or the caution escalates an existing local yellow).
  //
  // Local: Yellow bit rises while Caution is NOT currently set.
  // -------------------------------------------------------------------------
  const isFullCourse    = (currFlags & FLAG_YELLOW) !== 0 && (currFlags & FLAG_CAUTION) !== 0;
  const wasFullCourse   = (prevFlags & FLAG_YELLOW) !== 0 && (prevFlags & FLAG_CAUTION) !== 0;

  if (isFullCourse && !wasFullCourse) {
    events.push(buildEvent('FLAG_YELLOW_FULL_COURSE', nocar, {}, opts));
  } else if (rose(FLAG_YELLOW) && !isFullCourse) {
    // Yellow rose but Caution is not set → local yellow
    events.push(buildEvent('FLAG_YELLOW_LOCAL', nocar, {}, opts));
  }

  return events;
}
