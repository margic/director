/**
 * contact-detector.ts — Issue #180
 *
 * Detects player-car contact / hard hits using the vehicle dynamics fields
 * added in #178 (LatAccel / LongAccel / VertAccel / YawRate).
 *
 * Trigger (1-frame edge from prev → curr):
 *   - |LatAccel|  > 25 m/s²  (≈ 2.5 g lateral)
 *   - |LongAccel| > 30 m/s²  (≈ 3 g longitudinal — hard impact, not normal braking)
 *   - |VertAccel| > 30 m/s²  (≈ 3 g vertical — kerb / barrier strike)
 *   - |YawRate|   > π rad/s  (≥ 180°/s — definitive spin)
 *   AND prev frame did NOT already exceed any threshold (edge detection — avoids
 *   a single sustained event firing every frame).
 *
 * Resolution:
 *   On trigger we capture cause + initial peaks into DriverState.pendingContact
 *   and continue tracking peaks for CONTACT_RESOLUTION_WINDOW_SEC (1 s). When
 *   the window elapses we compute severity from the peak speed drop and emit
 *   CONTACT_DETECTED.
 *
 * Severity (computed at end of window):
 *   - light    : speed drop < 20 %
 *   - moderate : speed drop 20–50 %
 *   - severe   : speed drop > 50 %  OR  yawRate sustained > π rad/s for > 0.5 s
 *
 * Cause classification:
 *   - car_contact   — another car was within CONTACT_PROXIMITY_LAP_DIST_PCT of
 *                     the player on the trigger frame or in the previous 2 frames
 *   - solo_incident — no nearby car (kerb-strike / wall / off-track airborne)
 *
 * NOTE on proximity: spec #180 calls for a per-car (lat, lon) ring; iRacing
 * only exposes Lat/Lon as scalars for the player car, so this implementation
 * uses `carIdxLapDistPct` proximity as a sensible proxy.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import type { PublisherEvent, PublisherCarRef } from '../event-types';
import { buildEvent, carRefFromRoster } from '../session-state';
import { CONTACT_PROXIMITY_RING_CAPACITY, type DriverState, type PendingContactState } from '../driver-state';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CONTACT_LAT_ACCEL_THRESHOLD  = 25;
export const CONTACT_LONG_ACCEL_THRESHOLD = 30;
export const CONTACT_VERT_ACCEL_THRESHOLD = 30;
export const CONTACT_YAW_RATE_THRESHOLD   = Math.PI;

/** Resolution window — peaks tracked, speed drop measured to compute severity. */
export const CONTACT_RESOLUTION_WINDOW_SEC = 1.0;

/** Cooldown after emission to avoid back-to-back duplicates (~5 s @ 60 Hz). */
export const CONTACT_COOLDOWN_TICKS = 300;

/**
 * Number of consecutive frames with |yawRate| > π required to escalate severity
 * to 'severe' on a sustained spin (>0.5 s @ 60 Hz).
 */
export const CONTACT_YAW_SUSTAIN_FRAMES = 30;

/** Severity threshold: speed drop fraction (0.0–1.0). */
export const CONTACT_SEVERE_DROP_PCT   = 0.5;
export const CONTACT_MODERATE_DROP_PCT = 0.2;

/**
 * Proximity threshold in lapDistPct units. ~0.0015 ≈ 7.5 m on a 5 km track,
 * ~3 m on a 2 km track — close enough to constitute a hit while avoiding
 * matching cars one corner away.
 */
export const CONTACT_PROXIMITY_LAP_DIST_PCT = 0.0015;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

let unsetPlayerCarIdxWarned = false;

export interface ContactDetectorContext {
  rigId: string;
  raceSessionId: string;
  playerCarIdx: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

export function exceedsContactThresholds(frame: TelemetryFrame): boolean {
  return (
    Math.abs(frame.latAccel)  > CONTACT_LAT_ACCEL_THRESHOLD  ||
    Math.abs(frame.longAccel) > CONTACT_LONG_ACCEL_THRESHOLD ||
    Math.abs(frame.vertAccel) > CONTACT_VERT_ACCEL_THRESHOLD ||
    Math.abs(frame.yawRate)   > CONTACT_YAW_RATE_THRESHOLD
  );
}

/** Shortest signed distance between two lap fractions, accounting for wrap. */
export function lapDistPctDistance(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, 1 - raw);
}

/**
 * Classifies the trigger as `car_contact` (closest other car within proximity
 * threshold on this or any previous frame in the ring) or `solo_incident`.
 * Returns the contact car ref when classification is car_contact.
 */
export function classifyContactCause(
  curr: TelemetryFrame,
  state: SessionState,
  driverState: DriverState,
  playerCarIdx: number,
): { cause: 'car_contact' | 'solo_incident'; contactCar?: PublisherCarRef } {
  const playerLap     = curr.carIdxLapCompleted[playerCarIdx];
  const playerLapPct  = curr.carIdxLapDistPct[playerCarIdx];

  // Walk every car against the trigger frame + every snapshot in the ring.
  // The closest match across all frames wins.
  let bestCarIdx  = -1;
  let bestDistPct = CONTACT_PROXIMITY_LAP_DIST_PCT;

  const checkFrame = (lapDistPctArr: Float32Array, refLapPct: number): void => {
    for (let i = 0; i < lapDistPctArr.length; i++) {
      if (i === playerCarIdx) continue;
      // Must be a known car in the roster — sentinel zeros for empty slots
      // would otherwise produce false positives at lapDistPct=0.
      if (!state.knownRoster.has(i)) continue;
      // Same lap requirement (lapped cars at the same lapDistPct aren't contact).
      if (curr.carIdxLapCompleted[i] !== playerLap) continue;
      const d = lapDistPctDistance(refLapPct, lapDistPctArr[i]);
      if (d < bestDistPct) {
        bestDistPct = d;
        bestCarIdx  = i;
      }
    }
  };

  checkFrame(curr.carIdxLapDistPct, playerLapPct);
  for (const snap of driverState.proximityRing) {
    if (snap.length > playerCarIdx) {
      checkFrame(snap, snap[playerCarIdx]);
    }
  }

  if (bestCarIdx >= 0) {
    const ref = carRefFromRoster(state, bestCarIdx);
    return { cause: 'car_contact', contactCar: ref };
  }
  return { cause: 'solo_incident' };
}

export function computeContactSeverity(
  pending: PendingContactState,
  speedAfter: number,
): 'light' | 'moderate' | 'severe' {
  const before = Math.max(pending.speedBefore, 1);
  const drop   = (pending.speedBefore - speedAfter) / before;
  if (drop > CONTACT_SEVERE_DROP_PCT) return 'severe';
  if (pending.yawSustainedFrames > CONTACT_YAW_SUSTAIN_FRAMES) return 'severe';
  if (drop >= CONTACT_MODERATE_DROP_PCT) return 'moderate';
  return 'light';
}

/** Pushes a snapshot of carIdxLapDistPct into the bounded proximity ring. */
export function pushProximitySnapshot(driverState: DriverState, frame: TelemetryFrame): void {
  driverState.proximityRing.push(frame.carIdxLapDistPct.slice());
  while (driverState.proximityRing.length > CONTACT_PROXIMITY_RING_CAPACITY) {
    driverState.proximityRing.shift();
  }
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export function detectContact(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  driverState: DriverState,
  ctx: ContactDetectorContext,
): PublisherEvent[] {
  const playerCarIdx = ctx.playerCarIdx;
  if (playerCarIdx < 0) {
    if (!unsetPlayerCarIdxWarned) {
      unsetPlayerCarIdxWarned = true;
      // eslint-disable-next-line no-console
      console.warn('[contact-detector] playerCarIdx unset; skipping frame');
    }
    return [];
  }

  // Always update the proximity ring so the next trigger has historical context.
  pushProximitySnapshot(driverState, curr);

  if (prev === null) return [];

  const events: PublisherEvent[] = [];
  const opts = { raceSessionId: ctx.raceSessionId, rigId: ctx.rigId, frame: curr };

  // -------------------------------------------------------------------------
  // Resolution window — track peaks, finalise when window has elapsed.
  // -------------------------------------------------------------------------
  if (driverState.pendingContact) {
    const p = driverState.pendingContact;
    p.peakLatAccel  = Math.max(p.peakLatAccel,  Math.abs(curr.latAccel));
    p.peakLongAccel = Math.max(p.peakLongAccel, Math.abs(curr.longAccel));
    p.peakVertAccel = Math.max(p.peakVertAccel, Math.abs(curr.vertAccel));
    p.peakYawRate   = Math.max(p.peakYawRate,   Math.abs(curr.yawRate));
    if (Math.abs(curr.yawRate) > CONTACT_YAW_RATE_THRESHOLD) {
      p.yawSustainedFrames++;
    }

    if (curr.sessionTime - p.startSessionTime >= CONTACT_RESOLUTION_WINDOW_SEC) {
      const playerRef = carRefFromRoster(state, playerCarIdx);
      if (playerRef) {
        const severity = computeContactSeverity(p, curr.speed);
        events.push(buildEvent('CONTACT_DETECTED', playerRef, {
          cause: p.cause,
          contactCar: p.contactCar,
          severity,
          peakLatAccel:   p.peakLatAccel,
          peakLongAccel:  p.peakLongAccel,
          peakVertAccel:  p.peakVertAccel,
          peakYawRate:    p.peakYawRate,
          speedBeforeMps: p.speedBefore,
          speedAfterMps:  curr.speed,
          trackSurface:   p.trackSurface,
          lapDistPct:     p.lapDistPct,
        }, opts));
      }
      driverState.contactDetectedCooldownUntilTick = curr.sessionTick + CONTACT_COOLDOWN_TICKS;
      driverState.pendingContact = null;
    }
    return events;
  }

  // -------------------------------------------------------------------------
  // Trigger detection — edge from prev → curr, respecting cooldown.
  // -------------------------------------------------------------------------
  if (curr.sessionTick < driverState.contactDetectedCooldownUntilTick) return [];

  const prevTrig = exceedsContactThresholds(prev);
  const currTrig = exceedsContactThresholds(curr);
  if (!currTrig || prevTrig) return [];

  const { cause, contactCar } = classifyContactCause(curr, state, driverState, playerCarIdx);
  driverState.pendingContact = {
    startSessionTime:   curr.sessionTime,
    startTick:          curr.sessionTick,
    speedBefore:        prev.speed,
    peakLatAccel:       Math.abs(curr.latAccel),
    peakLongAccel:      Math.abs(curr.longAccel),
    peakVertAccel:      Math.abs(curr.vertAccel),
    peakYawRate:        Math.abs(curr.yawRate),
    yawSustainedFrames: Math.abs(curr.yawRate) > CONTACT_YAW_RATE_THRESHOLD ? 1 : 0,
    cause,
    contactCar,
    trackSurface:       curr.carIdxTrackSurface[playerCarIdx],
    lapDistPct:         curr.carIdxLapDistPct[playerCarIdx],
  };

  return [];
}

/** @internal — test-only reset of the warn-once latch. */
export function _resetContactDetectorWarnings(): void {
  unsetPlayerCarIdxWarned = false;
}
