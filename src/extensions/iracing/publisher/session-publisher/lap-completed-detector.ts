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

import type { TelemetryFrame, SessionState } from '../session-state';
import type { PublisherEvent } from '../event-types';
import { buildEvent, carRefFromRoster } from '../session-state';

const CAR_COUNT = 64;

export interface LapDetectorContext {
  rigId: string;
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
  const opts = { raceSessionId: ctx.raceSessionId, rigId: ctx.rigId, frame: curr };

  // #196 PR-D: build a position→carIdx map for neighbour-interval computation.
  // We only include cars with a valid position (> 0) and on the same lap or
  // one lap ahead — cross-lap F2Time values are meaningless (≈ lapTime * lapDelta).
  const posToCarIdx = new Map<number, number>();
  for (let j = 0; j < CAR_COUNT; j++) {
    const pos = curr.carIdxPosition[j];
    if (pos > 0) posToCarIdx.set(pos, j);
  }

  for (let i = 0; i < CAR_COUNT; i++) {
    const prevLaps = prev.carIdxLapCompleted[i];
    const currLaps = curr.carIdxLapCompleted[i];

    if (currLaps > prevLaps) {
      const car = carRefFromRoster(state, i);

      const pos = curr.carIdxPosition[i];

      // Compute neighbour intervals using CarIdxF2Time (gap to car ahead) and
      // by looking up the car behind's F2Time.  Skip cross-lap neighbours to
      // avoid stale ~90-second values polluting the payload.
      const aheadIdx  = posToCarIdx.get(pos - 1) ?? -1;
      const behindIdx = posToCarIdx.get(pos + 1) ?? -1;

      const sameLap = (a: number) =>
        a >= 0 && curr.carIdxLapCompleted[a] === currLaps;

      const intervalAheadSec  = (sameLap(aheadIdx) && aheadIdx >= 0)
        ? Math.max(0, curr.carIdxF2Time[i])
        : undefined;
      const intervalBehindSec = (sameLap(behindIdx) && behindIdx >= 0)
        ? Math.max(0, curr.carIdxF2Time[behindIdx])
        : undefined;

      const carAhead  = aheadIdx  >= 0 && intervalAheadSec  !== undefined
        ? carRefFromRoster(state, aheadIdx)  : undefined;
      const carBehind = behindIdx >= 0 && intervalBehindSec !== undefined
        ? carRefFromRoster(state, behindIdx) : undefined;

      events.push(buildEvent(
        'LAP_COMPLETED',
        car,
        {
          lapNumber:          currLaps,
          lapTime:            curr.carIdxLastLapTime[i],
          position:           pos,
          classPosition:      curr.carIdxClassPosition[i],
          gapToLeaderSec:     curr.carIdxF2Time[i],
          intervalAheadSec,
          intervalBehindSec,
          carAhead,
          carBehind,
        },
        opts,
      ));
    }
  }

  return events;
}
