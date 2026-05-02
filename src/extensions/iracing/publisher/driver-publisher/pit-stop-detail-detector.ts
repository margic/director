/**
 * pit-stop-detail-detector.ts — Issue #96
 *
 * Tier 2 pit stop state machine. Extends the Tier 1 PIT_ENTRY / PIT_EXIT
 * events with detailed stop-level analytics:
 *
 *   PIT_STOP_BEGIN    — car arrives in pit stall (CarIdxTrackSurface → 2)
 *   PIT_STOP_END      — car leaves pit stall (surface leaves 2)
 *   OUT_LAP           — car completes its first flying lap after PIT_EXIT
 *   FUEL_LOW          — FuelLevelPct crosses < 0.10 then < 0.05 (one-shot each)
 *   FUEL_LEVEL_CHANGE — FuelLevel jumps by ≥ threshold (player refuel detection)
 *
 * Track surface state machine satisfied by the issue: 1→3→4→2→4→3→1
 *   OnTrack(1) → ApproachingPits(3) → PitLane(4) → PitStall(2)
 *   → PitLane(4) → ApproachingPits(3) → OnTrack(1)
 *
 * Design notes:
 *   - Uses `prev` frame directly for all transition detection — no run-order
 *     dependency on pit-incident-detector.
 *   - FUEL_LOW and FUEL_LEVEL_CHANGE are player-only (FuelLevel / FuelLevelPct
 *     are iRacing player-only telemetry variables).
 *   - PIT_STOP_BEGIN/END fire for all 64 car slots; only the player car
 *     carries non-zero fuel fields in the payload.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { getOrCreateCarState, buildEvent, carRefFromRoster } from '../session-state';
import type { PublisherEvent } from '../event-types';

const CAR_COUNT = 64;

const TRACK_PIT_STALL = 2; // iRacing: irsdk_TrkLoc PitStall

const FUEL_LOW_THRESHOLDS = [0.10, 0.05] as const;

/** Minimum FuelLevel increase (litres) that triggers FUEL_LEVEL_CHANGE. */
export const DEFAULT_FUEL_JUMP_THRESHOLD_L = 1.0;

export interface PitStopDetailContext {
  rigId: string;
  raceSessionId: string;
  /** iRacing DriverInfo.DriverCarIdx — required for player-specific events. */
  playerCarIdx?: number;
  /**
   * Minimum FuelLevel increase (litres) to fire FUEL_LEVEL_CHANGE.
   * Defaults to DEFAULT_FUEL_JUMP_THRESHOLD_L (1.0 L).
   */
  fuelJumpThresholdL?: number;
}

// ---------------------------------------------------------------------------
// detectPitStopDetail
// ---------------------------------------------------------------------------

export function detectPitStopDetail(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: PitStopDetailContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  if (prev === null) {
    // Seed player fuel tracking on first frame.
    if (state.playerFuelAtLapStart === 0) {
      state.playerFuelAtLapStart = curr.fuelLevel;
    }
    return events;
  }

  const opts = { raceSessionId: ctx.raceSessionId, rigId: ctx.rigId, frame: curr };
  const playerCarIdx = ctx.playerCarIdx ?? 0;
  const fuelJumpThreshold = ctx.fuelJumpThresholdL ?? DEFAULT_FUEL_JUMP_THRESHOLD_L;

  // -------------------------------------------------------------------------
  // Per-car: PIT_STOP_BEGIN, PIT_STOP_END, OUT_LAP
  // -------------------------------------------------------------------------
  for (let i = 0; i < CAR_COUNT; i++) {
    const cs = getOrCreateCarState(state, i);
    const prevSurface = prev.carIdxTrackSurface[i];
    const currSurface = curr.carIdxTrackSurface[i];
    const prevOnPit   = prev.carIdxOnPitRoad[i] !== 0;
    const currOnPit   = curr.carIdxOnPitRoad[i] !== 0;
    const car         = carRefFromRoster(state, i);

    // -----------------------------------------------------------------------
    // PIT_STOP_BEGIN — surface transitions into PitStall (2)
    // -----------------------------------------------------------------------
    if (currSurface === TRACK_PIT_STALL && prevSurface !== TRACK_PIT_STALL) {
      cs.pitStallArrivalTime        = curr.sessionTime;
      cs.pitStallArrivalFuelLevel   = i === playerCarIdx ? curr.fuelLevel : 0;

      if (car) {
        events.push(buildEvent(
          'PIT_STOP_BEGIN',
          car,
          {
            arrivalSessionTime: curr.sessionTime,
            fuelLevelOnEntry:   cs.pitStallArrivalFuelLevel,
          },
          opts,
        ));
      }
    }

    // -----------------------------------------------------------------------
    // PIT_STOP_END — surface transitions out of PitStall (2)
    // -----------------------------------------------------------------------
    if (prevSurface === TRACK_PIT_STALL && currSurface !== TRACK_PIT_STALL) {
      const serviceDurationSec = cs.pitStallArrivalTime !== null
        ? curr.sessionTime - cs.pitStallArrivalTime
        : 0;

      const fuelLevelDelta = (i === playerCarIdx && cs.pitStallArrivalFuelLevel !== null)
        ? curr.fuelLevel - cs.pitStallArrivalFuelLevel
        : 0;

      if (car) {
        events.push(buildEvent(
          'PIT_STOP_END',
          car,
          {
            serviceDurationSec,
            fuelLevelDelta,
          },
          opts,
        ));
      }

      cs.pitStallArrivalTime      = null;
      cs.pitStallArrivalFuelLevel = null;
    }

    // -----------------------------------------------------------------------
    // OUT_LAP detection
    //
    // Step 1 — set flag when car exits pit road (onPitRoad true→false)
    // Step 2 — clear flag and emit when car completes its first lap
    // -----------------------------------------------------------------------
    if (prevOnPit && !currOnPit) {
      cs.onOutLap             = true;
      cs.pitExitLapsCompleted = curr.carIdxLapCompleted[i];
    }

    if (cs.onOutLap) {
      const currLaps = curr.carIdxLapCompleted[i];
      const exitLaps = cs.pitExitLapsCompleted ?? currLaps;
      if (currLaps > exitLaps) {
        cs.onOutLap             = false;
        cs.pitExitLapsCompleted = null;
        if (car) events.push(buildEvent('OUT_LAP', car, {}, opts));
      }
    }
  }

  // -------------------------------------------------------------------------
  // Player-only: FUEL_LOW + FUEL_LEVEL_CHANGE + fuel-per-lap tracking
  // -------------------------------------------------------------------------

  // Update per-lap fuel consumption estimate when player completes a lap.
  const prevPlayerLaps = prev.carIdxLapCompleted[playerCarIdx];
  const currPlayerLaps = curr.carIdxLapCompleted[playerCarIdx];
  if (currPlayerLaps > prevPlayerLaps) {
    const fuelUsed = state.playerFuelAtLapStart - curr.fuelLevel;
    if (fuelUsed > 0) state.playerFuelPerLap = fuelUsed;
    state.playerFuelAtLapStart = curr.fuelLevel;
  }

  // FUEL_LOW — one-shot per threshold per session
  for (const threshold of FUEL_LOW_THRESHOLDS) {
    if (
      !state.firedFuelLowThresholds.has(threshold) &&
      curr.fuelLevelPct < threshold
    ) {
      const fuelCar = carRefFromRoster(state, playerCarIdx);
      if (fuelCar) {
        state.firedFuelLowThresholds.add(threshold);
        const estimatedLapsRemaining = state.playerFuelPerLap > 0
          ? Math.floor(curr.fuelLevel / state.playerFuelPerLap)
          : 0;

        events.push(buildEvent(
          'FUEL_LOW',
          fuelCar,
          {
            threshold,
            fuelLevelPct:            curr.fuelLevelPct,
            estimatedLapsRemaining,
          },
          opts,
        ));
      }
    }
  }

  // FUEL_LEVEL_CHANGE — player refuel detection (FuelLevel jumps up)
  if (curr.fuelLevel > prev.fuelLevel + fuelJumpThreshold) {
    const fuelCar = carRefFromRoster(state, playerCarIdx);
    if (fuelCar) {
      const delta = curr.fuelLevel - prev.fuelLevel;
      events.push(buildEvent(
        'FUEL_LEVEL_CHANGE',
        fuelCar,
        {
          previousLevel: prev.fuelLevel,
          newLevel:      curr.fuelLevel,
          deltaLitres:   delta,
        },
        opts,
      ));
    }
  }

  return events;
}
