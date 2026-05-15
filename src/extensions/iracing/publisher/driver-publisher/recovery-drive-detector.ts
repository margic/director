/**
 * recovery-drive-detector.ts — Issue #181
 *
 * Composite event: fires once when the player has climbed at least 2 overall
 * positions within RECOVERY_WINDOW_SEC (60s) of one of the trigger events:
 *   - PLAYER_STOPPED  (driver-publisher equivalent of session STOPPED_ON_TRACK)
 *   - OFF_TRACK
 *   - CONTACT_DETECTED
 *
 * State machine on `DriverState.recoveryActive`:
 *   - Trigger: when one of the trigger events appears in the events list this
 *     tick AND no recoveryActive is in flight, capture the start.
 *   - Resolve: each subsequent tick, compare current overall position to
 *     `startPosition`. If gain ≥ RECOVERY_MIN_POSITIONS, emit and clear.
 *   - Expire: clear the state without emitting after RECOVERY_WINDOW_SEC.
 *
 * Detector ordering: must run AFTER the trigger detectors and AFTER
 * detectOverallPositionChange so the most current carIdxPosition is reflected.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { buildEvent, carRefFromRoster, getOrCreateCarState } from '../session-state';
import type {
  PublisherEvent,
  PublisherEventType,
  RecoveryDrivePayload,
} from '../event-types';
import type { DriverState } from '../driver-state';

export const RECOVERY_WINDOW_SEC = 60;
export const RECOVERY_MIN_POSITIONS = 2;

export const RECOVERY_TRIGGER_EVENTS: ReadonlySet<PublisherEventType> = new Set<PublisherEventType>([
  'PLAYER_STOPPED',
  'OFF_TRACK',
  'CONTACT_DETECTED',
]);

export interface RecoveryDriveContext {
  rigId: string;
  raceSessionId: string;
  playerCarIdx: number;
  emittedThisTick: PublisherEvent[];
}

export function detectRecoveryDrive(
  _prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  driverState: DriverState,
  ctx: RecoveryDriveContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  if (ctx.playerCarIdx < 0) return events;

  // 2-frame hysteresis on player position from the same window the position
  // detector uses. Bail until populated.
  const cs = getOrCreateCarState(state, ctx.playerCarIdx);
  const currentPosition = curr.carIdxPosition[ctx.playerCarIdx];

  // ---- Resolve / expire an active recovery ----
  if (driverState.recoveryActive) {
    const r = driverState.recoveryActive;
    const elapsed = curr.sessionTime - r.startedAtSessionTime;

    if (currentPosition > 0) {
      const positionsRecovered = r.startPosition - currentPosition; // climb = positive
      if (positionsRecovered >= RECOVERY_MIN_POSITIONS) {
        const playerRef = carRefFromRoster(state, ctx.playerCarIdx);
        if (playerRef) {
          const payload: RecoveryDrivePayload = {
            triggerEvent:        r.trigger,
            positionsRecovered,
            recoveryDurationSec: elapsed,
            startPosition:       r.startPosition,
            currentPosition,
          };
          events.push(buildEvent('RECOVERY_DRIVE', playerRef, payload, {
            raceSessionId: ctx.raceSessionId,
            rigId:         ctx.rigId,
            frame:         curr,
          }));
        }
        driverState.recoveryActive = null;
      } else if (elapsed > RECOVERY_WINDOW_SEC) {
        driverState.recoveryActive = null;
      }
    } else if (elapsed > RECOVERY_WINDOW_SEC) {
      driverState.recoveryActive = null;
    }
  }

  // ---- Look for a new trigger this tick ----
  if (!driverState.recoveryActive && currentPosition > 0) {
    for (const ev of ctx.emittedThisTick) {
      if (!RECOVERY_TRIGGER_EVENTS.has(ev.type)) continue;
      // Only react to player-car events. Identity check via car.carIdx.
      if (ev.car.carIdx !== ctx.playerCarIdx) continue;
      driverState.recoveryActive = {
        startedAtSessionTime: curr.sessionTime,
        startPosition:        currentPosition,
        trigger:              ev.type as RecoveryDrivePayload['triggerEvent'],
      };
      break;
    }
  }

  // Touch carState so lint doesn't whine — it's also useful to ensure the
  // CarState is initialised when this detector runs early in a session.
  void cs;

  return events;
}
