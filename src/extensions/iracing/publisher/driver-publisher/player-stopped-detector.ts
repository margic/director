/**
 * player-stopped-detector.ts
 *
 * Emits PLAYER_STOPPED when the player car is stationary on track for more
 * than PLAYER_STOPPED_MIN_DURATION_SEC, using the precise `speed` scalar from
 * the player-car telemetry feed.
 *
 * Why a separate detector from the session-publisher STOPPED_ON_TRACK:
 *   - The session publisher uses lapDistPct delta for all cars, which can
 *     fail to detect stops when the player is off-track (iRacing may still
 *     advance lapDistPct for off-road position estimates).
 *   - The driver rig has access to the exact `speed` scalar (m/s) for the
 *     player car, making this detection reliable in all scenarios including
 *     off-track incidents.
 *
 * Re-arms once the player exceeds PLAYER_STOPPED_RESUME_SPEED_MPS.
 * Not emitted while on pit road (stationary pit stops are expected).
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { buildEvent, carRefFromRoster } from '../session-state';
import type { PublisherEvent } from '../event-types';
import type { DriverState } from '../driver-state';

/** Speed (m/s) below which the player is considered stopped (~3.6 km/h). */
export const PLAYER_STOPPED_SPEED_MPS = 1.0;

/** Speed (m/s) above which the stopped state is cleared (~7.2 km/h). */
export const PLAYER_STOPPED_RESUME_SPEED_MPS = 2.0;

/** Seconds of sub-threshold speed required before PLAYER_STOPPED fires. */
export const PLAYER_STOPPED_MIN_DURATION_SEC = 3.0;

let unsetPlayerCarIdxWarned = false;

export interface PlayerStoppedContext {
  rigId: string;
  raceSessionId: string;
  playerCarIdx: number;
}

export function detectPlayerStopped(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  driverState: DriverState,
  ctx: PlayerStoppedContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];

  if (ctx.playerCarIdx < 0) {
    if (!unsetPlayerCarIdxWarned) {
      unsetPlayerCarIdxWarned = true;
      // eslint-disable-next-line no-console
      console.warn('[player-stopped-detector] playerCarIdx unset; skipping');
    }
    return events;
  }

  if (prev === null) return events;

  // Skip while on pit road — stationary pit stops are expected behaviour.
  if (curr.carIdxOnPitRoad[ctx.playerCarIdx] !== 0) {
    driverState.stoppedBySpeedStartTime = null;
    driverState.isStoppedBySpeed = false;
    return events;
  }

  // Use the precise player-car speed scalar (not the per-car array).
  const speed = curr.speed;

  if (speed > PLAYER_STOPPED_RESUME_SPEED_MPS) {
    // Player is moving — clear stopped state so we re-arm for the next stop.
    driverState.stoppedBySpeedStartTime = null;
    driverState.isStoppedBySpeed = false;
    return events;
  }

  if (speed <= PLAYER_STOPPED_SPEED_MPS) {
    // Below stopped threshold — start or continue the duration clock.
    if (driverState.stoppedBySpeedStartTime === null) {
      // Seed from prev.sessionTime so the window includes the frame we just observed.
      driverState.stoppedBySpeedStartTime = prev.sessionTime;
    }

    const stoppedFor = curr.sessionTime - driverState.stoppedBySpeedStartTime;
    if (stoppedFor >= PLAYER_STOPPED_MIN_DURATION_SEC && !driverState.isStoppedBySpeed) {
      const playerRef = carRefFromRoster(state, ctx.playerCarIdx);
      if (playerRef) {
        driverState.isStoppedBySpeed = true;
        events.push(buildEvent(
          'PLAYER_STOPPED',
          playerRef,
          {
            lapDistPct:         curr.carIdxLapDistPct[ctx.playerCarIdx],
            stoppedDurationSec: stoppedFor,
            speed,
            position:           curr.carIdxPosition[ctx.playerCarIdx],
          },
          { raceSessionId: ctx.raceSessionId, rigId: ctx.rigId, frame: curr },
        ));
      }
    }
  }

  return events;
}
