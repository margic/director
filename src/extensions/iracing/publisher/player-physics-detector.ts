/**
 * player-physics-detector.ts — Issue #99 (Tier 4 polish)
 *
 * Detects player-car physics events:
 *
 *   SPIN_DETECTED    — Steering wheel reversal + speed drop (player only)
 *   BIG_HIT          — High SteeringWheelPctTorque spike + sudden speed drop
 *   SLOW_CAR_AHEAD   — Player closing rapidly on a significantly slower car
 *
 * Design:
 *   - All events have cooldowns (tick-based) to avoid flooding on sustained
 *     conditions.
 *   - SLOW_CAR_AHEAD only fires when the player is actively racing (speed above
 *     MIN_ACTIVE_SPEED_MPS), preventing false positives in pit lane.
 *   - Mutates SessionState cooldown fields on emission.
 */

import type { TelemetryFrame, SessionState } from './session-state';
import type { PublisherEvent } from './event-types';
import { buildEvent, carRefFromRoster } from './session-state';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** SPIN_DETECTED — minimum absolute steering angle (radians) each side of
 *  the reversal must have, to filter out tiny oscillations. */
export const SPIN_STEERING_MIN_RAD  = 0.35; // ~20 degrees

/** SPIN_DETECTED — player speed must be ABOVE this for a spin to be detected.
 *  Prevents triggering while stationary in pit or at race start. */
export const SPIN_MIN_SPEED_MPS     = 5;    // ~18 km/h

/** SPIN_DETECTED — player speed must DROP by this fraction within one frame. */
export const SPIN_SPEED_DROP_RATIO  = 0.08; // 8% speed loss per frame

/** SPIN_DETECTED — minimum ticks between emissions (~10 s at 60 Hz). */
export const SPIN_COOLDOWN_TICKS    = 600;

/** BIG_HIT — SteeringWheelPctTorque threshold (0.0–1.0 scale). */
export const BIG_HIT_TORQUE_THRESHOLD = 0.80;

/** BIG_HIT — player speed drop (m/s) within one frame to confirm impact. */
export const BIG_HIT_SPEED_DROP_MPS  = 10;  // ~36 km/h instantaneous loss

/** BIG_HIT — minimum ticks between emissions (~10 s at 60 Hz). */
export const BIG_HIT_COOLDOWN_TICKS  = 600;

/** SLOW_CAR_AHEAD — gap threshold in seconds (carIdxF2Time). */
export const SLOW_CAR_GAP_THRESHOLD_SEC   = 1.5;

/** SLOW_CAR_AHEAD — closing rate (gap decrease per frame) in seconds.
 *  At 60 Hz, 0.02 s/frame ≈ ~72 m/min closing rate at 50 m/s. */
export const SLOW_CAR_CLOSING_RATE_SEC    = 0.02;

/** SLOW_CAR_AHEAD — target car must be this much slower than player (m/s). */
export const SLOW_CAR_SPEED_DIFF_MPS     = 5;  // ~18 km/h differential

/** SLOW_CAR_AHEAD — minimum player speed to be considered actively racing. */
export const SLOW_CAR_MIN_ACTIVE_MPS     = 20; // ~72 km/h

/** SLOW_CAR_AHEAD — minimum ticks between emissions (~30 s at 60 Hz). */
export const SLOW_CAR_COOLDOWN_TICKS     = 1800;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface PlayerPhysicsDetectorContext {
  publisherCode: string;
  raceSessionId: string;
  playerCarIdx?: number;
  /** Car number strings for SLOW_CAR_AHEAD targetCarNumber payload. */
  carNumberByCarIdx?: Map<number, string>;
}

// ---------------------------------------------------------------------------
// detectPlayerPhysics
// ---------------------------------------------------------------------------

export function detectPlayerPhysics(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: PlayerPhysicsDetectorContext,
): PublisherEvent[] {
  if (prev === null) return [];

  const playerCarIdx = ctx.playerCarIdx;
  if (playerCarIdx === undefined || playerCarIdx < 0) return [];

  const events: PublisherEvent[] = [];
  const opts = { raceSessionId: ctx.raceSessionId, publisherCode: ctx.publisherCode, frame: curr };
  const playerRef = carRefFromRoster(state, playerCarIdx);

  const tick = curr.sessionTick;

  // -------------------------------------------------------------------------
  // SPIN_DETECTED
  // -------------------------------------------------------------------------
  if (playerRef && tick >= state.spinDetectedCooldownUntilTick) {
    const prevAngle = prev.steeringWheelAngle;
    const currAngle = curr.steeringWheelAngle;
    const playerSpeed = curr.speed;

    const hasReversal   = prevAngle * currAngle < 0; // crossed zero
    const bothSignificant = Math.abs(prevAngle) >= SPIN_STEERING_MIN_RAD &&
                            Math.abs(currAngle) >= SPIN_STEERING_MIN_RAD;
    const speedAboveMin = playerSpeed >= SPIN_MIN_SPEED_MPS;
    const speedDropped  = prev.speed > 0 &&
                          (prev.speed - playerSpeed) / prev.speed >= SPIN_SPEED_DROP_RATIO;

    if (hasReversal && bothSignificant && speedAboveMin && speedDropped) {
      events.push(buildEvent('SPIN_DETECTED', playerRef, {}, opts));
      state.spinDetectedCooldownUntilTick = tick + SPIN_COOLDOWN_TICKS;
    }
  }

  // -------------------------------------------------------------------------
  // BIG_HIT
  // -------------------------------------------------------------------------
  if (playerRef && tick >= state.bigHitCooldownUntilTick) {
    const torqueSpiked = curr.steeringWheelPctTorque >= BIG_HIT_TORQUE_THRESHOLD;
    const speedCrashed = prev.speed - curr.speed >= BIG_HIT_SPEED_DROP_MPS;

    if (torqueSpiked && speedCrashed) {
      events.push(buildEvent('BIG_HIT', playerRef, {}, opts));
      state.bigHitCooldownUntilTick = tick + BIG_HIT_COOLDOWN_TICKS;
    }
  }

  // -------------------------------------------------------------------------
  // SLOW_CAR_AHEAD
  // -------------------------------------------------------------------------
  if (tick >= state.slowCarAheadCooldownUntilTick) {
    const playerSpeed = curr.speed;

    // Only fire while actively racing at speed
    if (playerRef && playerSpeed >= SLOW_CAR_MIN_ACTIVE_MPS) {
      const currGap  = curr.carIdxF2Time[playerCarIdx];
      const prevGap  = prev.carIdxF2Time[playerCarIdx];
      const closing  = prevGap - currGap >= SLOW_CAR_CLOSING_RATE_SEC;
      const nearGap  = currGap > 0 && currGap <= SLOW_CAR_GAP_THRESHOLD_SEC;

      if (nearGap && closing) {
        // Find the car immediately ahead: position = player's position - 1
        const playerPos = curr.carIdxPosition[playerCarIdx];
        if (playerPos >= 2) { // leader has no car ahead
          const numCars = curr.carIdxPosition.length;
          let aheadCarIdx = -1;
          for (let i = 0; i < numCars; i++) {
            if (i !== playerCarIdx && curr.carIdxPosition[i] === playerPos - 1) {
              aheadCarIdx = i;
              break;
            }
          }

          if (aheadCarIdx >= 0) {
            const aheadSpeed = curr.carIdxSpeed[aheadCarIdx];
            const closingRateMps = playerSpeed - aheadSpeed;

            if (closingRateMps >= SLOW_CAR_SPEED_DIFF_MPS) {
              const targetCarNumber = ctx.carNumberByCarIdx?.get(aheadCarIdx) ?? '';
              events.push(buildEvent(
                'SLOW_CAR_AHEAD',
                playerRef,
                { targetCarIdx: aheadCarIdx, targetCarNumber, closingRateMps },
                opts,
              ));
              state.slowCarAheadCooldownUntilTick = tick + SLOW_CAR_COOLDOWN_TICKS;
            }
          }
        }
      }
    }
  }

  return events;
}
