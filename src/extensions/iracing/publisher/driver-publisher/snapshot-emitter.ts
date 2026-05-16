/**
 * snapshot-emitter.ts — Issue #179
 *
 * Builds DRIVER_STATE_SNAPSHOT events on a fixed cadence and on forced-flush
 * triggers (HIGH_PRIORITY events, pit transitions, post driver-swap).
 *
 * Pure module — never owns timers, never mutates DriverState directly except
 * for `lastSnapshotSessionTime` (updated when a snapshot is emitted). The
 * orchestrator calls `maybeBuildSnapshot()` after each frame's detector batch.
 */

import type {
  PublisherEvent,
  PublisherEventType,
  DriverStateSnapshotPayload,
  SnapshotBattleEntry,
  SnapshotEventDigest,
  SnapshotFlag,
} from '../event-types';
import { HIGH_PRIORITY_EVENTS } from '../event-types';
import type { TelemetryFrame, SessionState } from '../session-state';
import { buildEvent, carRefFromRoster, getOrCreateCarState } from '../session-state';
import type { DriverState } from '../driver-state';
import { summariseEvent } from './summarise-event';

/** Default cadence between cadence-driven snapshots (seconds). */
export const DEFAULT_SNAPSHOT_INTERVAL_SEC = 15;
/** Maximum number of recent events embedded in each snapshot. */
export const SNAPSHOT_RECENT_EVENTS_LIMIT = 10;

/**
 * Event types — beyond HIGH_PRIORITY_EVENTS — that should also force a
 * snapshot. Stint-boundary and pit-transition events are valuable narrative
 * inflection points for downstream consumers.
 */
const FORCED_SNAPSHOT_TRIGGERS: ReadonlySet<PublisherEventType> = new Set<PublisherEventType>([
  'PIT_ENTRY',
  'PIT_EXIT',
  'DRIVER_SWAP_COMPLETED',
]);

export interface SnapshotEmitContext {
  raceSessionId: string;
  rigId: string;
  playerCarIdx: number;
  /** Override the default cadence (seconds). */
  snapshotIntervalSec?: number;
}

/**
 * Decides whether the just-emitted batch of events triggers a forced snapshot
 * flush. Returns the matching trigger event (for diagnostic logging) or null.
 */
export function findForcedTrigger(events: readonly PublisherEvent[]): PublisherEvent | null {
  for (const ev of events) {
    if (HIGH_PRIORITY_EVENTS.has(ev.type) || FORCED_SNAPSHOT_TRIGGERS.has(ev.type)) {
      return ev;
    }
  }
  return null;
}

/**
 * Returns true when the cadence interval has elapsed since the last snapshot.
 */
export function isCadenceElapsed(
  driverState: DriverState,
  frame: TelemetryFrame,
  intervalSec: number,
): boolean {
  if (!Number.isFinite(driverState.lastSnapshotSessionTime)) return true;
  return frame.sessionTime - driverState.lastSnapshotSessionTime >= intervalSec;
}

/**
 * Build the snapshot payload + event. Returns null when carRef cannot be
 * resolved from the roster yet (no roster data → nothing useful to publish).
 *
 * Mutates `driverState.lastSnapshotSessionTime` on success.
 */
export function buildSnapshot(
  frame: TelemetryFrame,
  state: SessionState,
  driverState: DriverState,
  ctx: SnapshotEmitContext,
  reason: 'cadence' | 'forced',
): PublisherEvent | null {
  if (!state.knownRoster.has(ctx.playerCarIdx)) return null;
  const carRef = carRefFromRoster(state, ctx.playerCarIdx);

  const payload = buildSnapshotPayload(frame, state, driverState, ctx, reason);

  driverState.lastSnapshotSessionTime = frame.sessionTime;

  return buildEvent('DRIVER_STATE_SNAPSHOT', carRef, payload, {
    raceSessionId: ctx.raceSessionId,
    rigId: ctx.rigId,
    frame,
  });
}

/**
 * Convenience entrypoint for the orchestrator. Builds and returns the snapshot
 * event when either (a) the just-dispatched batch contains a forced trigger,
 * or (b) the cadence interval has elapsed. Returns null otherwise.
 */
export function maybeBuildSnapshot(
  frame: TelemetryFrame,
  state: SessionState,
  driverState: DriverState,
  dispatchedEvents: readonly PublisherEvent[],
  ctx: SnapshotEmitContext,
): PublisherEvent | null {
  const intervalSec = ctx.snapshotIntervalSec ?? DEFAULT_SNAPSHOT_INTERVAL_SEC;

  const trigger = findForcedTrigger(dispatchedEvents);
  if (trigger) {
    return buildSnapshot(frame, state, driverState, ctx, 'forced');
  }
  if (isCadenceElapsed(driverState, frame, intervalSec)) {
    return buildSnapshot(frame, state, driverState, ctx, 'cadence');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Payload assembly
// ---------------------------------------------------------------------------

function buildSnapshotPayload(
  frame: TelemetryFrame,
  state: SessionState,
  driverState: DriverState,
  ctx: SnapshotEmitContext,
  reason: 'cadence' | 'forced',
): DriverStateSnapshotPayload {
  const idx = ctx.playerCarIdx;
  const carRef = state.knownRoster.get(idx);
  const cs = getOrCreateCarState(state, idx);

  // Lap pace
  const recentLapTimes = cs.stintLapTimes.slice(-5);
  const lastLap = recentLapTimes.length > 0 ? recentLapTimes[recentLapTimes.length - 1] : 0;
  const personalBestLapTime = cs.bestLapTime > 0 ? cs.bestLapTime : 0;
  const paceVsBestPct =
    personalBestLapTime > 0 && lastLap > 0
      ? ((lastLap - personalBestLapTime) / personalBestLapTime) * 100
      : 0;

  // Battle context
  const carAhead = buildBattleEntryAhead(frame, state, idx);
  const carBehind = buildBattleEntryBehind(frame, state, idx, cs.recentGapToBehind, cs.closingRateToBehind);

  // Recent events
  const recentEvents: SnapshotEventDigest[] = driverState.recentEvents
    .slice(-SNAPSHOT_RECENT_EVENTS_LIMIT)
    .map((ev) => ({
      type: ev.type,
      sessionTime: ev.sessionTime,
      summary: summariseEvent(ev),
    }));

  return {
    reason,

    // Identity
    driverName: carRef?.driverName ?? '',
    carIdx: idx,
    carNumber: carRef?.carNumber ?? '',
    stintNumber: driverState.stintNumber,

    // Current state
    position: frame.carIdxPosition[idx] ?? 0,
    classPosition: frame.carIdxClassPosition[idx] ?? 0,
    lap: frame.carIdxLapCompleted[idx] ?? 0,
    lapDistPct: frame.carIdxLapDistPct[idx] ?? 0,
    speed: frame.speed ?? 0,
    onPitRoad: (frame.carIdxOnPitRoad[idx] ?? 0) !== 0,
    trackSurface: frame.carIdxTrackSurface[idx] ?? 0,
    isStopped: driverState.isStoppedBySpeed,
    isOffTrack: (frame.carIdxTrackSurface[idx] ?? 0) === -1,

    // Pace
    recentLapTimes,
    stintBestLapTime: cs.stintBestLapTime,
    personalBestLapTime,
    paceVsBestPct,

    // Strategy
    fuelLevel: frame.fuelLevel,
    fuelLapsRemaining: cs.estimatedFuelLapsRemaining,
    inPitWindow: cs.inPitWindow,
    estimatedStintLaps: state.estimatedStintLaps,

    // Battle
    carAhead,
    carBehind,

    // Recent events
    recentEvents,

    // Race meta
    racePhase: state.racePhase,
    flag: deriveFlag(frame.sessionFlags),

    // Derived metrics (#182) — snapshot a copy so downstream mutations cannot
    // leak back into DriverState.
    derived: { ...driverState.derived },
  };
}

function buildBattleEntryAhead(
  frame: TelemetryFrame,
  state: SessionState,
  playerCarIdx: number,
): SnapshotBattleEntry | undefined {
  const cs = state.carStates.get(playerCarIdx);
  if (!cs) return undefined;
  const gapSec = frame.carIdxF2Time[playerCarIdx];
  if (!Number.isFinite(gapSec) || gapSec <= 0) return undefined;

  const playerPos = frame.carIdxPosition[playerCarIdx] ?? 0;
  if (playerPos <= 1) return undefined;
  const aheadPos = playerPos - 1;

  let aheadIdx = -1;
  for (let i = 0; i < frame.carIdxPosition.length; i++) {
    if (frame.carIdxPosition[i] === aheadPos) { aheadIdx = i; break; }
  }
  if (aheadIdx < 0) return undefined;

  const aheadRef = carRefFromRoster(state, aheadIdx);
  if (!aheadRef) return undefined;

  return {
    car: aheadRef,
    gapSec,
    closingRateSecPerLap: cs.closingRateToAhead,
  };
}

function buildBattleEntryBehind(
  frame: TelemetryFrame,
  state: SessionState,
  playerCarIdx: number,
  recentGapToBehind: number[],
  closingRateToBehind: number,
): SnapshotBattleEntry | undefined {
  if (recentGapToBehind.length === 0) return undefined;
  const playerPos = frame.carIdxPosition[playerCarIdx] ?? 0;
  if (playerPos <= 0) return undefined;
  const behindPos = playerPos + 1;

  let behindIdx = -1;
  for (let i = 0; i < frame.carIdxPosition.length; i++) {
    if (frame.carIdxPosition[i] === behindPos) { behindIdx = i; break; }
  }
  if (behindIdx < 0) return undefined;

  const behindRef = carRefFromRoster(state, behindIdx);
  if (!behindRef) return undefined;

  return {
    car: behindRef,
    gapSec: recentGapToBehind[recentGapToBehind.length - 1],
    closingRateSecPerLap: closingRateToBehind,
  };
}

/**
 * Derive a coarse flag classification from the iRacing SessionFlags bitmask.
 * Order matters — red > checkered > yellow > white > blue > green.
 */
export function deriveFlag(sessionFlags: number): SnapshotFlag {
  // Bit constants mirror frame-fixtures FlagBits (irsdk_Flags).
  const RED       = 0x0010;
  const CHECKERED = 0x0001;
  const YELLOW    = 0x0008;
  const CAUTION   = 0x4000;
  const WHITE     = 0x0002;
  const BLUE      = 0x0020;
  const GREEN     = 0x0004;

  if (sessionFlags & RED) return 'red';
  if (sessionFlags & CHECKERED) return 'checkered';
  if (sessionFlags & (YELLOW | CAUTION)) return 'yellow';
  if (sessionFlags & WHITE) return 'white';
  if (sessionFlags & BLUE) return 'blue';
  if (sessionFlags & GREEN) return 'green';
  return 'unknown';
}
