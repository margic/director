/**
 * lap-completed-detector.ts — Issue #94
 *
 * Detects `LAP_COMPLETED` events by watching for increments in
 * `carIdxLapCompleted` across consecutive TelemetryFrames.
 *
 * Covers all 64 car slots in a single pass. One event fires per car per
 * completed lap; no duplicates even if multiple cars cross the line in the
 * same poll window.
 */

import type { TelemetryFrame, SessionState } from './session-state';
import type { PublisherEvent } from './event-types';
import { buildEvent, carRefFromRoster } from './session-state';

const CAR_COUNT = 64;

export interface LapDetectorContext {
  publisherCode: string;
  raceSessionId: string;
}

// ---------------------------------------------------------------------------
// detectLapCompleted — pure function
// ---------------------------------------------------------------------------

/**
 * @param prev  Previous TelemetryFrame, or null on first poll after connect
 * @param curr  Current TelemetryFrame
 * @param state Mutable per-session state (used only for buildEvent opts here)
 * @param ctx   Static publisher context
 * @returns     Array of LAP_COMPLETED events (may be empty)
 */
export function detectLapCompleted(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: LapDetectorContext,
): PublisherEvent[] {
  if (prev === null) return [];

  const events: PublisherEvent[] = [];
  const opts = { raceSessionId: ctx.raceSessionId, publisherCode: ctx.publisherCode, frame: curr };

  for (let i = 0; i < CAR_COUNT; i++) {
    const prevLaps = prev.carIdxLapCompleted[i];
    const currLaps = curr.carIdxLapCompleted[i];

    if (currLaps > prevLaps) {
      const car = carRefFromRoster(state, i);

      events.push(buildEvent(
        'LAP_COMPLETED',
        car,
        {
          lapNumber:      currLaps,
          lapTime:        curr.carIdxLastLapTime[i],
          position:       curr.carIdxPosition[i],
          classPosition:  curr.carIdxClassPosition[i],
          gapToLeaderSec: curr.carIdxF2Time[i],
        },
        opts,
      ));
    }
  }

  return events;
}
