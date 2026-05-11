/**
 * pit-window-detector.ts — Issue #155
 *
 * Emits IN_PIT_WINDOW (once per stint) and FUEL_PROJECTION (at most once
 * per lap) for the player car. Reads the trend fields populated by the
 * RaceStateAggregator — does not maintain its own state.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { buildEvent, carRefFromRoster, getOrCreateCarState } from '../session-state';
import type { PublisherEvent } from '../event-types';

let unsetPlayerCarIdxWarned = false;

export interface PitWindowContext {
  rigId: string;
  raceSessionId: string;
  playerCarIdx: number;
  /** Optional override; defaults to estimatedStintLaps from session state. */
  fuelProjectionThresholdLaps?: number;
}

export function detectPitWindow(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: PitWindowContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  if (ctx.playerCarIdx < 0) {
    if (!unsetPlayerCarIdxWarned) {
      unsetPlayerCarIdxWarned = true;
      // eslint-disable-next-line no-console
      console.warn('[pit-window-detector] playerCarIdx unset; skipping');
    }
    return events;
  }

  const cs = getOrCreateCarState(state, ctx.playerCarIdx);
  const opts = { raceSessionId: ctx.raceSessionId, rigId: ctx.rigId, frame: curr };
  const playerRef = carRefFromRoster(state, ctx.playerCarIdx);
  if (!playerRef) return events;

  // ---- IN_PIT_WINDOW — fires once when inPitWindow flips false → true ----
  if (cs.inPitWindow && !state.inPitWindowFired) {
    const stintLen = state.estimatedStintLaps;
    const lapsRemaining = Math.max(0, stintLen - cs.lapsSinceLastPit);
    events.push(buildEvent(
      'IN_PIT_WINDOW',
      playerRef,
      { lapsRemainingInStint: lapsRemaining, estimatedStintLaps: stintLen },
      opts,
    ));
    state.inPitWindowFired = true;
  }
  // Reset the latch when the stint resets (lapsSinceLastPit goes back to 0
  // after a pit exit handled elsewhere) — keyed off inPitWindow being false.
  if (!cs.inPitWindow) state.inPitWindowFired = false;

  // ---- FUEL_PROJECTION — at most once per lap when projection is low ----
  const lapNumber = curr.carIdxLapCompleted[ctx.playerCarIdx];
  const fuelPerLap = state.playerFuelPerLap;
  const projected = cs.estimatedFuelLapsRemaining;
  if (
    fuelPerLap > 0
    && projected > 0
    && state.fuelProjectionLastLap !== lapNumber
  ) {
    const threshold = ctx.fuelProjectionThresholdLaps ?? state.estimatedStintLaps;
    if (threshold > 0 && projected <= threshold) {
      events.push(buildEvent(
        'FUEL_PROJECTION',
        playerRef,
        {
          projectedLaps: round2(projected),
          fuelLevel: round2(curr.fuelLevel),
          fuelPerLap: round2(fuelPerLap),
          thresholdLaps: threshold,
        },
        opts,
      ));
      state.fuelProjectionLastLap = lapNumber;
    }
  }

  return events;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
