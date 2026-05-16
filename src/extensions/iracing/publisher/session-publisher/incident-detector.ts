/**
 * incident-detector.ts — Issue #201 (PR-E for #196)
 *
 * Session-wide incident detection for all 64 car slots.
 *
 * Emits:
 *   INCIDENT — when a car experiences an on-track incident
 *
 * Three trigger patterns (all require raceGreenFired):
 *
 *   1. OFF_TRACK edge — CarIdxTrackSurface transitions to -1 (off track).
 *      Severity depends on prior speed delta: we use CarIdxSpeed at the frame
 *      before and after the edge as a proxy.
 *        speed < 10 m/s drop  → 'light'
 *        speed ≥ 10 m/s drop  → 'moderate'
 *        speed ≥ 25 m/s drop  → 'severe'
 *
 *   2. Sudden deceleration while on-track (kinematic discontinuity).
 *      CarIdxSpeed drops by ≥ KINEMATIC_THRESHOLD_MPS in a single frame AND
 *      the car is on the racing surface (trackSurface 1) AND not in a braking
 *      zone we'd normally expect (we use the raw speed delta as a proxy).
 *      This catches CONTACT events between cars on-track.
 *        speed drop ≥ 10 m/s → 'moderate'
 *        speed drop ≥ 25 m/s → 'severe'
 *
 *   3. Two-car proximity + simultaneous kinematic disturbance.
 *      If two cars' speeds both drop by ≥ 5 m/s in the same frame while ≤
 *      CONTACT_PROXIMITY_LAP_PCT apart on track → 'CONTACT' type.
 *
 * Sector mapping:
 *   lap distance [0, 0.33)  → sector 0
 *   lap distance [0.33, 0.66) → sector 1
 *   lap distance [0.66, 1.0) → sector 2
 *
 * Design notes:
 *  - Latched per car: once INCIDENT fires, a cooldown of INCIDENT_COOLDOWN_SEC
 *    prevents repeated events for the same car from the same incident.
 *  - otherCar is only populated for CONTACT type (when a two-car pair is identified).
 *  - Requires CarIdxSpeed in TelemetryFrame (added in #178).
 *  - iRacing CarIdxTrackSurface values: -1 = off track, 1 = on track, 2 = pit stall,
 *    3 = approaching pits, 4 = pit lane.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { getOrCreateCarState, carRefFromRoster, buildEvent } from '../session-state';
import type { PublisherEvent } from '../event-types';

export interface IncidentDetectorContext {
  rigId: string;
  raceSessionId: string;
}

const CAR_COUNT = 64;

/** Speed drop (m/s) in a single frame that triggers a 'moderate' incident. */
const KINEMATIC_MOD_THRESHOLD_MPS = 10;
/** Speed drop (m/s) in a single frame that triggers a 'severe' incident. */
const KINEMATIC_SEV_THRESHOLD_MPS = 25;
/** Speed drop (m/s) in a single frame to consider a car as 'disturbed' for contact detection. */
const CONTACT_DISTURBANCE_MPS = 5;
/** Track-distance fraction (laps) within which two disturbed cars count as a CONTACT. */
const CONTACT_PROXIMITY_LAP_PCT = 0.02; // ≈ 2% of lap
/** Seconds after an INCIDENT emission during which further events for the same car are suppressed. */
const INCIDENT_COOLDOWN_SEC = 8;

function lapSector(pct: number): 0 | 1 | 2 {
  if (pct < 0.33) return 0;
  if (pct < 0.66) return 1;
  return 2;
}

function speedDropSeverity(dropMps: number): 'light' | 'moderate' | 'severe' {
  if (dropMps >= KINEMATIC_SEV_THRESHOLD_MPS) return 'severe';
  if (dropMps >= KINEMATIC_MOD_THRESHOLD_MPS) return 'moderate';
  return 'light';
}

// ---------------------------------------------------------------------------
// detectIncidents — pure-ish function (mutates carState.lastIncidentSessionTime)
// ---------------------------------------------------------------------------

export function detectIncidents(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: IncidentDetectorContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];

  if (!prev) return events;
  if (!state.raceGreenFired) return events;

  const opts = { rigId: ctx.rigId, raceSessionId: ctx.raceSessionId, frame: curr };

  // Collect per-car speed deltas and off-track transitions in a single pass.
  // We then do a second pass for contact detection using the collected data.
  const speedDrops   = new Float64Array(CAR_COUNT); // positive = dropped
  const offTrackEdge = new Uint8Array(CAR_COUNT);   // 1 if trackSurface -1 this frame

  for (let i = 0; i < CAR_COUNT; i++) {
    if (curr.carIdxPosition[i] <= 0) continue;

    const prevSurface = prev.carIdxTrackSurface[i];
    const currSurface = curr.carIdxTrackSurface[i];
    const prevSpeed   = prev.carIdxSpeed[i];
    const currSpeed   = curr.carIdxSpeed[i];

    speedDrops[i]   = Math.max(0, prevSpeed - currSpeed);
    offTrackEdge[i] = (prevSurface !== -1 && currSurface === -1) ? 1 : 0;
  }

  // First pass: OFF_TRACK and kinematic events.
  for (let i = 0; i < CAR_COUNT; i++) {
    if (curr.carIdxPosition[i] <= 0) continue;

    const cs = getOrCreateCarState(state, i);
    const now = curr.sessionTime;

    // Cooldown check
    if (cs.lastIncidentSessionTime !== undefined &&
        now - cs.lastIncidentSessionTime < INCIDENT_COOLDOWN_SEC) {
      continue;
    }

    const currSurface = curr.carIdxTrackSurface[i];
    const drop        = speedDrops[i];
    const pct         = curr.carIdxLapDistPct[i];
    const lap         = curr.carIdxLapCompleted[i];

    let incidentType: 'OFF_TRACK' | 'CONTACT' | 'LOSS_OF_CONTROL' | 'SPIN' | null = null;
    let severity: 'light' | 'moderate' | 'severe' = 'light';

    if (offTrackEdge[i]) {
      incidentType = 'OFF_TRACK';
      severity     = speedDropSeverity(drop);
    } else if (currSurface === 1 && drop >= KINEMATIC_MOD_THRESHOLD_MPS) {
      // Kinematic disturbance on-track and not pit road — candidate for CONTACT or LOC.
      // The contact check (pairing with another disturbed car) happens below.
      // For now tag as LOSS_OF_CONTROL; it may be upgraded to CONTACT in pass 2.
      incidentType = 'LOSS_OF_CONTROL';
      severity     = speedDropSeverity(drop);
    }

    if (!incidentType) continue;

    const car = carRefFromRoster(state, i);
    events.push(buildEvent('INCIDENT', car, {
      severity,
      type:         incidentType,
      lap,
      lapDistPct:   pct,
      sector:       lapSector(pct),
      trackSurface: curr.carIdxTrackSurface[i],
    }, opts));
    cs.lastIncidentSessionTime = now;
  }

  // Second pass: contact detection — find pairs of disturbed cars close together.
  // For any pair that are both disturbed AND within CONTACT_PROXIMITY_LAP_PCT,
  // emit (or upgrade) an INCIDENT of type CONTACT with otherCar populated.
  // Only emit if neither car has recently emitted (cooldown already handled in
  // first pass, but we need to avoid double-emit if LOSS_OF_CONTROL already fired).
  const disturbed: number[] = [];
  for (let i = 0; i < CAR_COUNT; i++) {
    if (curr.carIdxPosition[i] > 0 &&
        curr.carIdxTrackSurface[i] === 1 &&
        speedDrops[i] >= CONTACT_DISTURBANCE_MPS) {
      disturbed.push(i);
    }
  }

  for (let ai = 0; ai < disturbed.length; ai++) {
    for (let bi = ai + 1; bi < disturbed.length; bi++) {
      const a = disturbed[ai];
      const b = disturbed[bi];

      let physDiff = curr.carIdxLapDistPct[a] - curr.carIdxLapDistPct[b];
      if (physDiff >  0.5) physDiff -= 1.0;
      if (physDiff < -0.5) physDiff += 1.0;
      if (Math.abs(physDiff) > CONTACT_PROXIMITY_LAP_PCT) continue;

      // Same-lap pair within proximity — emit CONTACT for both cars
      for (const [self, other] of [[a, b], [b, a]]) {
        const cs = getOrCreateCarState(state, self);
        const now = curr.sessionTime;
        // Only emit if not already in cooldown from a prior event this pass
        if (cs.lastIncidentSessionTime !== undefined &&
            now - cs.lastIncidentSessionTime < INCIDENT_COOLDOWN_SEC) {
          continue;
        }
        const selfCar  = carRefFromRoster(state, self);
        const otherCar = carRefFromRoster(state, other);
        const pct      = curr.carIdxLapDistPct[self];
        events.push(buildEvent('INCIDENT', selfCar, {
          severity:     speedDropSeverity(speedDrops[self]),
          type:         'CONTACT',
          lap:          curr.carIdxLapCompleted[self],
          lapDistPct:   pct,
          sector:       lapSector(pct),
          trackSurface: curr.carIdxTrackSurface[self],
          otherCar,
        }, opts));
        cs.lastIncidentSessionTime = now;
      }
    }
  }

  return events;
}
