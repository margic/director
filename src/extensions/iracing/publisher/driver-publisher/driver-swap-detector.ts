/**
 * driver-swap-detector.ts — DIR-1
 *
 * Driver-pipeline slice of the former driver-swap-roster-detector.ts.
 * Handles telemetry-triggered driver swap completion:
 *
 *   DRIVER_SWAP_COMPLETED — emitted when the player car exits pit road
 *     while a swap is pending (set externally by the operator via the
 *     top-level orchestrator's initiateDriverSwap() method).
 *     Payload: swapDurationSec, incomingDriverId, incomingDriverName,
 *              stintNumberStarting (incremented each swap).
 *
 * Note: DRIVER_SWAP_INITIATED is emitted directly by the top-level
 *   orchestrator via initiateDriverSwap() (operator-triggered, not
 *   frame-triggered) and therefore does NOT live here.
 *
 * Note: ROSTER_UPDATED belongs to the session pipeline and lives in
 *   session-publisher/roster-detector.ts.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { getOrCreateCarState, buildEvent, carRefFromRoster } from '../session-state';
import type { PublisherEvent } from '../event-types';

export interface DriverSwapDetectorContext {
  rigId: string;
  raceSessionId: string;
  /** iRacing DriverInfo.DriverCarIdx — required for swap completion detection. */
  playerCarIdx?: number;
}

// ---------------------------------------------------------------------------
// detectDriverSwap
// ---------------------------------------------------------------------------

export function detectDriverSwap(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: DriverSwapDetectorContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  if (prev === null) return events;
  if (!state.driverSwapPending) return events;

  const opts = { raceSessionId: ctx.raceSessionId, rigId: ctx.rigId, frame: curr };
  const playerCarIdx = ctx.playerCarIdx ?? 0;

  const prevOnPit = prev.carIdxOnPitRoad[playerCarIdx] !== 0;
  const currOnPit = curr.carIdxOnPitRoad[playerCarIdx] !== 0;

  if (prevOnPit && !currOnPit) {
    const swapDurationSec =
      state.pendingSwapInitiatedSessionTime > 0
        ? Math.max(0, curr.sessionTime - state.pendingSwapInitiatedSessionTime)
        : 0;

    // Increment stint counter — the incoming driver is starting a new stint.
    state.playerStintNumber += 1;

    const swapBaseRef = carRefFromRoster(state, playerCarIdx);
    if (swapBaseRef) {
      events.push(buildEvent(
        'DRIVER_SWAP_COMPLETED',
        { ...swapBaseRef, driverName: state.pendingSwapIncomingDriverName },
        {
          swapDurationSec,
          incomingDriverId:    state.pendingSwapIncomingDriverId,
          incomingDriverName:  state.pendingSwapIncomingDriverName,
          stintNumberStarting: state.playerStintNumber,
        },
        opts,
      ));
    }

    // Clear pending swap state
    state.driverSwapPending = false;
    state.pendingSwapOutgoingDriverId = '';
    state.pendingSwapIncomingDriverId = '';
    state.pendingSwapIncomingDriverName = '';
    state.pendingSwapInitiatedSessionTime = 0;

    // Reset stint-milestone tracking for the new driver
    const cs = getOrCreateCarState(state, playerCarIdx);
    cs.stintStartLap        = curr.carIdxLapCompleted[playerCarIdx];
    cs.firedStintMilestones = new Set();
  }

  return events;
}
