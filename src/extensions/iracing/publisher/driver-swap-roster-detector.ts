/**
 * driver-swap-roster-detector.ts — Issue #101
 *
 * Handles two concerns driven by the publisher frame pipeline:
 *
 * 1. DRIVER_SWAP_COMPLETED — emitted when the player car exits pit road
 *    while a swap is pending (set externally by the operator via
 *    PublisherOrchestrator.initiateDriverSwap()).
 *    Payload: swapDurationSec, incomingDriverId, incomingDriverName,
 *             stintNumberStarting (incremented each swap).
 *
 * 2. ROSTER_UPDATED — emitted when the driver roster provided via
 *    context differs from the last known roster stored in session state.
 *    Added/removed entries are computed by diffing Map<carIdx, ref>.
 *    Seeding call (knownRoster is empty) does NOT emit an event — it just
 *    initialises the baseline.
 *
 * Note: DRIVER_SWAP_INITIATED is emitted directly by
 *   PublisherOrchestrator.initiateDriverSwap() (operator-triggered, not
 *   frame-triggered) and therefore does NOT live here.
 */

import type { TelemetryFrame, SessionState } from './session-state';
import { getOrCreateCarState, buildEvent, carRefFromRoster } from './session-state';
import type { PublisherEvent, PublisherCarRef } from './event-types';

export interface DriverSwapRosterContext {
  publisherCode: string;
  raceSessionId: string;
  /** iRacing DriverInfo.DriverCarIdx — required for swap completion detection. */
  playerCarIdx?: number;
  /**
   * Current full roster as parsed from the latest SessionInfo YAML.
   * Pass undefined to skip ROSTER_UPDATED detection this frame.
   */
  currentRoster?: Map<number, PublisherCarRef>;
}

// ---------------------------------------------------------------------------
// detectDriverSwapAndRoster
// ---------------------------------------------------------------------------

export function detectDriverSwapAndRoster(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: DriverSwapRosterContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  if (prev === null) return events;

  const opts = { raceSessionId: ctx.raceSessionId, publisherCode: ctx.publisherCode, frame: curr };
  const playerCarIdx = ctx.playerCarIdx ?? 0;

  // -------------------------------------------------------------------------
  // DRIVER_SWAP_COMPLETED — player exits pit road while a swap is pending
  // -------------------------------------------------------------------------
  if (state.driverSwapPending) {
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
            incomingDriverId:   state.pendingSwapIncomingDriverId,
            incomingDriverName: state.pendingSwapIncomingDriverName,
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

      // Also reset stint-milestone tracking for the new driver
      const cs = getOrCreateCarState(state, playerCarIdx);
      cs.stintStartLap       = curr.carIdxLapCompleted[playerCarIdx];
      cs.firedStintMilestones = new Set();
    }
  }

  // -------------------------------------------------------------------------
  // ROSTER_UPDATED — compare currentRoster to known snapshot
  // -------------------------------------------------------------------------
  if (ctx.currentRoster !== undefined) {
    const current  = ctx.currentRoster;
    const previous = state.knownRoster;

    if (previous.size === 0 && current.size > 0) {
      // First-ever roster seed — just store it without emitting.
      state.knownRoster = new Map(current);
    } else if (previous.size > 0) {
      const added:   PublisherCarRef[] = [];
      const removed: PublisherCarRef[] = [];

      for (const [idx, ref] of current) {
        if (!previous.has(idx)) added.push(ref);
      }
      for (const [idx, ref] of previous) {
        if (!current.has(idx)) removed.push(ref);
      }

      if (added.length > 0 || removed.length > 0) {
        state.knownRoster = new Map(current);
        const rosterCar = carRefFromRoster(state, playerCarIdx);
        if (rosterCar) {
          events.push(buildEvent(
            'ROSTER_UPDATED',
            rosterCar,
            { added, removed },
            opts,
          ));
        }
      }
    }
  }

  return events;
}
