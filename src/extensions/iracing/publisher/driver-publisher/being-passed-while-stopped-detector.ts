/**
 * being-passed-while-stopped-detector.ts — Issue #181
 *
 * Composite event: fires once for every OVERALL_POSITION_LOSS that occurs
 * while the player is stopped (`DriverState.isStoppedBySpeed === true`).
 *
 * `DriverState.positionsLostThisStop` is a running counter for the current
 * stop episode; it is reset to 0 in this detector when the player resumes
 * movement (isStoppedBySpeed transitions true → false), so a fresh stop
 * always starts at zero.
 *
 * Inputs:
 *   - `emittedThisTick`: the events the orchestrator has produced earlier in
 *     the same tick. We scan it for OVERALL_POSITION_LOSS.
 *   - `driverState.isStoppedBySpeed` (set by detectPlayerStopped) gates the
 *     event. Detector ordering matters — see orchestrator.ts.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { buildEvent, carRefFromRoster } from '../session-state';
import type {
  PublisherEvent,
  BeingPassedWhileStoppedPayload,
  OverallPositionChangePayload,
  PublisherCarRef,
} from '../event-types';
import type { DriverState } from '../driver-state';

export interface BeingPassedWhileStoppedContext {
  rigId: string;
  raceSessionId: string;
  playerCarIdx: number;
  emittedThisTick: PublisherEvent[];
}

/** Track the previous tick's stopped flag so we can detect the resume edge. */
const prevStoppedByCarIdx = new Map<number, boolean>();

/** Test-only — clear the per-process resume-edge cache. */
export function _resetBeingPassedWhileStoppedState(): void {
  prevStoppedByCarIdx.clear();
}

export function detectBeingPassedWhileStopped(
  _prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  driverState: DriverState,
  ctx: BeingPassedWhileStoppedContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  if (ctx.playerCarIdx < 0) return events;

  const wasStopped = prevStoppedByCarIdx.get(ctx.playerCarIdx) ?? false;
  // Reset the running counter on the resume edge (true → false).
  if (wasStopped && !driverState.isStoppedBySpeed) {
    driverState.positionsLostThisStop = 0;
  }
  prevStoppedByCarIdx.set(ctx.playerCarIdx, driverState.isStoppedBySpeed);

  if (!driverState.isStoppedBySpeed) return events;

  const playerRef = carRefFromRoster(state, ctx.playerCarIdx);
  if (!playerRef) return events;

  const stoppedSince = driverState.stoppedBySpeedStartTime ?? curr.sessionTime;
  const trackSurface = curr.carIdxTrackSurface[ctx.playerCarIdx] ?? 0;

  for (const ev of ctx.emittedThisTick) {
    if (ev.type !== 'OVERALL_POSITION_LOSS') continue;
    const lossPayload = ev.payload as OverallPositionChangePayload;
    // Only count true on-track passes — pit-cycle losses are not "being passed
    // while stopped" in any narrative sense.
    if (lossPayload.reason !== 'overtake') continue;

    driverState.positionsLostThisStop += 1;

    const overtakingCar: PublisherCarRef =
      lossPayload.overtakingCar ?? { carIdx: -1 };

    const payload: BeingPassedWhileStoppedPayload = {
      overtakingCar,
      positionsLostThisStop: driverState.positionsLostThisStop,
      secondsStopped:        Math.max(0, curr.sessionTime - stoppedSince),
      trackSurface,
    };

    events.push(buildEvent('BEING_PASSED_WHILE_STOPPED', playerRef, payload, {
      raceSessionId: ctx.raceSessionId,
      rigId:         ctx.rigId,
      frame:         curr,
    }));
  }

  return events;
}
