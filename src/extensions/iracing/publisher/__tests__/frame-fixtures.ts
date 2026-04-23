/**
 * frame-fixtures.ts — Synthetic telemetry frame test harness.
 * Issue: #93 — M2 Tier 1 MVP
 *
 * Provides:
 *   - makeFrame(opts?)          — minimal valid TelemetryFrame with 64-slot typed arrays
 *   - cloneFrame(frame)         — deep copy (typed arrays are cloned, not shared)
 *   - makeFrameSequence(base, transitions) — chain of frame snapshots
 *   - Transition helpers        — return (prev: TelemetryFrame) => TelemetryFrame
 *   - Pre-built scenario frames — scenarioA(), scenarioB()
 *   - Enums / bitmask constants — SessionStateEnum, FlagBits, TrackSurface
 */

import type { TelemetryFrame } from '../session-state';

// ---------------------------------------------------------------------------
// Constants — mirror iRacing enum values
// ---------------------------------------------------------------------------

export const CAR_COUNT = 64;

/** iRacing SessionState enum (irsdk_SessionState). */
export const SessionStateEnum = {
  Invalid: 0,
  GetInCar: 1,
  Warmup: 2,
  ParadeLaps: 3,
  Racing: 4,
  Checkered: 5,
  CoolDown: 6,
} as const;
export type SessionStateValue = (typeof SessionStateEnum)[keyof typeof SessionStateEnum];

/**
 * iRacing session flag bitmasks (irsdk_Flags).
 * Compound values mark common combinations used in tests.
 */
export const FlagBits = {
  // Single-bit flags
  Checkered:      0x0001,
  White:          0x0002,
  Green:          0x0004,
  Yellow:         0x0008,
  Red:            0x0010,
  Blue:           0x0020,
  Debris:         0x0040,
  Crossed:        0x0080,
  YellowWaving:   0x0100,
  GreenHeld:      0x0400,
  Caution:        0x4000,
  CautionWaving:  0x8000,
  Black:          0x010000,
  Disqualify:     0x020000,
  // Compound
  YellowFullCourse: 0x4008,  // Yellow | Caution
} as const;

/**
 * iRacing track surface values (irsdk_TrkLoc).
 * -1 is off-track, positive values are on-world.
 */
export const TrackSurface = {
  OffTrack:        -1,
  NotInWorld:       0,
  OnTrack:          1,
  PitStall:         2,
  ApproachingPits:  3,
  PitLane:          4,
} as const;
export type TrackSurfaceValue = (typeof TrackSurface)[keyof typeof TrackSurface];

// ---------------------------------------------------------------------------
// makeFrame — factory for a minimal valid TelemetryFrame
// ---------------------------------------------------------------------------

export interface CarSlotOverride {
  carIdx: number;
  position?: number;
  classPosition?: number;
  onPitRoad?: boolean;
  trackSurface?: number;
  lastLapTime?: number;
  bestLapTime?: number;
  lapsCompleted?: number;
  lapDistPct?: number;
  f2Time?: number;
  sessionFlags?: number;
}

export interface FrameOptions {
  // Scalar fields
  sessionTick?: number;
  sessionTime?: number;
  sessionState?: number;
  sessionFlags?: number;
  sessionUniqueId?: number;
  fuelLevel?: number;
  fuelLevelPct?: number;
  playerIncidentCount?: number;
  teamIncidentCount?: number;
  incidentLimit?: number;
  skies?: number;
  trackTemp?: number;
  windDir?: number;
  windVel?: number;
  relativeHumidity?: number;
  fogLevel?: number;
  // Per-car slot overrides
  cars?: CarSlotOverride[];
}

export function makeFrame(opts: FrameOptions = {}): TelemetryFrame {
  const carIdxPosition      = new Int32Array(CAR_COUNT);
  const carIdxClassPosition = new Int32Array(CAR_COUNT);
  const carIdxOnPitRoad     = new Uint8Array(CAR_COUNT);
  const carIdxTrackSurface  = new Int32Array(CAR_COUNT).fill(TrackSurface.OnTrack);
  const carIdxLastLapTime   = new Float32Array(CAR_COUNT);
  const carIdxBestLapTime   = new Float32Array(CAR_COUNT);
  const carIdxLapCompleted  = new Int32Array(CAR_COUNT);
  const carIdxLapDistPct    = new Float32Array(CAR_COUNT);
  const carIdxF2Time        = new Float32Array(CAR_COUNT);
  const carIdxSessionFlags  = new Int32Array(CAR_COUNT);

  for (const car of opts.cars ?? []) {
    const i = car.carIdx;
    if (i < 0 || i >= CAR_COUNT) continue;
    if (car.position      !== undefined) carIdxPosition[i]      = car.position;
    if (car.classPosition !== undefined) carIdxClassPosition[i] = car.classPosition;
    if (car.onPitRoad     !== undefined) carIdxOnPitRoad[i]     = car.onPitRoad ? 1 : 0;
    if (car.trackSurface  !== undefined) carIdxTrackSurface[i]  = car.trackSurface;
    if (car.lastLapTime   !== undefined) carIdxLastLapTime[i]   = car.lastLapTime;
    if (car.bestLapTime   !== undefined) carIdxBestLapTime[i]   = car.bestLapTime;
    if (car.lapsCompleted !== undefined) carIdxLapCompleted[i]  = car.lapsCompleted;
    if (car.lapDistPct    !== undefined) carIdxLapDistPct[i]    = car.lapDistPct;
    if (car.f2Time        !== undefined) carIdxF2Time[i]        = car.f2Time;
    if (car.sessionFlags  !== undefined) carIdxSessionFlags[i]  = car.sessionFlags;
  }

  return {
    sessionTick:         opts.sessionTick         ?? 1000,
    sessionTime:         opts.sessionTime         ?? 120,
    sessionState:        opts.sessionState        ?? SessionStateEnum.Racing,
    sessionFlags:        opts.sessionFlags        ?? FlagBits.Green,
    sessionUniqueId:     opts.sessionUniqueId     ?? 1,
    carIdxPosition,
    carIdxClassPosition,
    carIdxOnPitRoad,
    carIdxTrackSurface,
    carIdxLastLapTime,
    carIdxBestLapTime,
    carIdxLapCompleted,
    carIdxLapDistPct,
    carIdxF2Time,
    carIdxSessionFlags,
    fuelLevel:           opts.fuelLevel           ?? 50,
    fuelLevelPct:        opts.fuelLevelPct        ?? 0.8,
    playerIncidentCount: opts.playerIncidentCount ?? 0,
    teamIncidentCount:   opts.teamIncidentCount   ?? 0,
    incidentLimit:       opts.incidentLimit       ?? 17,
    skies:               opts.skies               ?? 0,
    trackTemp:           opts.trackTemp           ?? 32,
    windDir:             opts.windDir             ?? 0,
    windVel:             opts.windVel             ?? 1,
    relativeHumidity:    opts.relativeHumidity    ?? 0.5,
    fogLevel:            opts.fogLevel            ?? 0,
  };
}

// ---------------------------------------------------------------------------
// cloneFrame — deep copy (typed arrays are not shared between frames)
// ---------------------------------------------------------------------------

export function cloneFrame(f: TelemetryFrame): TelemetryFrame {
  return {
    ...f,
    carIdxPosition:      f.carIdxPosition.slice(),
    carIdxClassPosition: f.carIdxClassPosition.slice(),
    carIdxOnPitRoad:     f.carIdxOnPitRoad.slice(),
    carIdxTrackSurface:  f.carIdxTrackSurface.slice(),
    carIdxLastLapTime:   f.carIdxLastLapTime.slice(),
    carIdxBestLapTime:   f.carIdxBestLapTime.slice(),
    carIdxLapCompleted:  f.carIdxLapCompleted.slice(),
    carIdxLapDistPct:    f.carIdxLapDistPct.slice(),
    carIdxF2Time:        f.carIdxF2Time.slice(),
    carIdxSessionFlags:  f.carIdxSessionFlags.slice(),
  };
}

// ---------------------------------------------------------------------------
// makeFrameSequence — produce an array of frames by applying transitions
// The returned array includes the base frame as element [0].
// ---------------------------------------------------------------------------

export type FrameTransition = (prev: TelemetryFrame) => TelemetryFrame;

export function makeFrameSequence(
  base: TelemetryFrame,
  transitions: FrameTransition[],
): TelemetryFrame[] {
  const frames: TelemetryFrame[] = [base];
  for (const t of transitions) {
    frames.push(t(frames[frames.length - 1]));
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Helpers — shared tick/time advance applied by every transition
// ---------------------------------------------------------------------------

function advanceTick(f: TelemetryFrame, ticks = 5, timeDelta = 0.2): void {
  f.sessionTick = f.sessionTick + ticks;
  f.sessionTime = f.sessionTime + timeDelta;
}

// ---------------------------------------------------------------------------
// Transition helpers
// ---------------------------------------------------------------------------

/**
 * Overtake: swap positions of overtakingCarIdx and overtakenCarIdx.
 * Both cars must be on-track (onPitRoad == 0).
 *
 * Covers: OVERTAKE, OVERTAKE_FOR_LEAD
 */
export function withOvertake(overtakingCarIdx: number, overtakenCarIdx: number): FrameTransition {
  return (prev) => {
    const next = cloneFrame(prev);
    const posA = prev.carIdxPosition[overtakingCarIdx];
    const posB = prev.carIdxPosition[overtakenCarIdx];
    next.carIdxPosition[overtakingCarIdx] = posB;
    next.carIdxPosition[overtakenCarIdx]  = posA;
    advanceTick(next);
    return next;
  };
}

/**
 * Pit entry: car transitions onPitRoad false→true.
 * trackSurface set to ApproachingPits.
 *
 * Covers: PIT_ENTRY
 */
export function withPitEntry(carIdx: number): FrameTransition {
  return (prev) => {
    const next = cloneFrame(prev);
    next.carIdxOnPitRoad[carIdx]    = 1;
    next.carIdxTrackSurface[carIdx] = TrackSurface.ApproachingPits;
    advanceTick(next);
    return next;
  };
}

/**
 * Pit stall arrival: car arrives in stall (trackSurface → PitStall).
 *
 * Covers: PIT_STOP_BEGIN (Tier 2)
 */
export function withPitStall(carIdx: number): FrameTransition {
  return (prev) => {
    const next = cloneFrame(prev);
    next.carIdxOnPitRoad[carIdx]    = 1;
    next.carIdxTrackSurface[carIdx] = TrackSurface.PitStall;
    advanceTick(next, 25, 1.0);
    return next;
  };
}

/**
 * Pit exit: car transitions onPitRoad true→false.
 * trackSurface returns to OnTrack. Optionally updates position.
 *
 * Covers: PIT_EXIT
 */
export function withPitExit(carIdx: number, newPosition?: number): FrameTransition {
  return (prev) => {
    const next = cloneFrame(prev);
    next.carIdxOnPitRoad[carIdx]    = 0;
    next.carIdxTrackSurface[carIdx] = TrackSurface.OnTrack;
    if (newPosition !== undefined) next.carIdxPosition[carIdx] = newPosition;
    advanceTick(next);
    return next;
  };
}

/**
 * Off-track: car's trackSurface transitions to OffTrack (-1).
 *
 * Covers: OFF_TRACK (first frame; detector requires 2 consecutive)
 */
export function withOffTrack(carIdx: number): FrameTransition {
  return (prev) => {
    const next = cloneFrame(prev);
    next.carIdxTrackSurface[carIdx] = TrackSurface.OffTrack;
    advanceTick(next);
    return next;
  };
}

/**
 * Back on track: car's trackSurface returns to OnTrack.
 *
 * Covers: BACK_ON_TRACK
 */
export function withBackOnTrack(carIdx: number): FrameTransition {
  return (prev) => {
    const next = cloneFrame(prev);
    next.carIdxTrackSurface[carIdx] = TrackSurface.OnTrack;
    advanceTick(next);
    return next;
  };
}

/**
 * Lap completed: lapsCompleted increments, lastLapTime set.
 * Also updates bestLapTime if this is a new personal best.
 *
 * Covers: LAP_COMPLETED, PERSONAL_BEST_LAP (if improved)
 */
export function withLapCompleted(carIdx: number, lapTime: number): FrameTransition {
  return (prev) => {
    const next = cloneFrame(prev);
    next.carIdxLapCompleted[carIdx] = prev.carIdxLapCompleted[carIdx] + 1;
    next.carIdxLastLapTime[carIdx]  = lapTime;
    const prevBest = prev.carIdxBestLapTime[carIdx];
    if (lapTime > 0 && (prevBest === 0 || lapTime < prevBest)) {
      next.carIdxBestLapTime[carIdx] = lapTime;
    }
    advanceTick(next);
    return next;
  };
}

/**
 * Session flags change: replaces the whole sessionFlags bitmask.
 *
 * Covers: FLAG_GREEN, FLAG_YELLOW_LOCAL, FLAG_YELLOW_FULL_COURSE, FLAG_WHITE, FLAG_RED
 */
export function withSessionFlags(flags: number): FrameTransition {
  return (prev) => {
    const next = cloneFrame(prev);
    next.sessionFlags = flags;
    advanceTick(next);
    return next;
  };
}

/**
 * Session state changes (e.g. Racing → Checkered).
 *
 * Covers: SESSION_STATE_CHANGE, RACE_GREEN, RACE_CHECKERED, SESSION_ENDED
 */
export function withSessionState(state: number): FrameTransition {
  return (prev) => {
    const next = cloneFrame(prev);
    next.sessionState = state;
    advanceTick(next);
    return next;
  };
}

/**
 * New session: sessionUniqueId changes, tick and time reset to 0.
 *
 * Covers: SESSION_LOADED
 */
export function withNewSession(newUniqueId: number): FrameTransition {
  return (_prev) => makeFrame({ sessionUniqueId: newUniqueId, sessionTick: 0, sessionTime: 0 });
}

/**
 * Player incident count increments by 1.
 *
 * Covers: INCIDENT_POINT
 */
export function withIncidentPoint(): FrameTransition {
  return (prev) => {
    const next = cloneFrame(prev);
    next.playerIncidentCount = prev.playerIncidentCount + 1;
    advanceTick(next);
    return next;
  };
}

/**
 * Fuel level changes (used for refuel detection and FUEL_LOW threshold).
 *
 * Covers: FUEL_LOW, FUEL_LEVEL_CHANGE (Tier 2)
 */
export function withFuelLevel(level: number, pct: number): FrameTransition {
  return (prev) => {
    const next = cloneFrame(prev);
    next.fuelLevel    = level;
    next.fuelLevelPct = pct;
    advanceTick(next);
    return next;
  };
}

/**
 * Gap shrinks to < 1.0s (battle engagement threshold).
 * Sets carIdxF2Time for the chaser car.
 *
 * Covers: BATTLE_ENGAGED
 */
export function withBattleGap(chaserCarIdx: number, gapSec: number): FrameTransition {
  return (prev) => {
    const next = cloneFrame(prev);
    next.carIdxF2Time[chaserCarIdx] = gapSec;
    advanceTick(next);
    return next;
  };
}

/**
 * Apply a combined session-state + session-flags transition for race start.
 *
 * Covers: RACE_GREEN (green flag + Racing state)
 */
export function withRaceGreen(): FrameTransition {
  return (prev) => {
    const next = cloneFrame(prev);
    next.sessionState = SessionStateEnum.Racing;
    next.sessionFlags = FlagBits.Green;
    advanceTick(next);
    return next;
  };
}

/**
 * Apply checkered flag + Checkered state transition.
 *
 * Covers: RACE_CHECKERED
 */
export function withRaceCheckered(): FrameTransition {
  return (prev) => {
    const next = cloneFrame(prev);
    next.sessionState = SessionStateEnum.Checkered;
    next.sessionFlags = FlagBits.Checkered;
    advanceTick(next);
    return next;
  };
}

// ---------------------------------------------------------------------------
// Pre-built scenario frames
// ---------------------------------------------------------------------------

/**
 * Scenario A — 4 cars racing, cars 0–3 in positions 1–4.
 * Car 1 is within 1.0s of car 0 (battle range).
 * Baseline for: OVERTAKE, BATTLE_ENGAGED/BROKEN, LAP_COMPLETED.
 */
export function scenarioA(): TelemetryFrame {
  return makeFrame({
    sessionState: SessionStateEnum.Racing,
    sessionFlags: FlagBits.Green,
    cars: [
      { carIdx: 0, position: 1, classPosition: 1, lapDistPct: 0.50, f2Time: 0.0, lapsCompleted: 5, lastLapTime: 90.1, bestLapTime: 89.8 },
      { carIdx: 1, position: 2, classPosition: 2, lapDistPct: 0.49, f2Time: 0.8, lapsCompleted: 5, lastLapTime: 90.3, bestLapTime: 90.0 },
      { carIdx: 2, position: 3, classPosition: 3, lapDistPct: 0.48, f2Time: 2.5, lapsCompleted: 5, lastLapTime: 91.0, bestLapTime: 90.5 },
      { carIdx: 3, position: 4, classPosition: 4, lapDistPct: 0.45, f2Time: 5.0, lapsCompleted: 5, lastLapTime: 91.5, bestLapTime: 91.0 },
    ],
  });
}

/**
 * Scenario B — car 1 in pit stall, car 0 leading on-track.
 * Low fuel on player car (carIdx 0).
 * Baseline for: PIT_ENTRY, PIT_STOP_BEGIN/END, FUEL_LOW.
 */
export function scenarioB(): TelemetryFrame {
  return makeFrame({
    sessionState: SessionStateEnum.Racing,
    sessionFlags: FlagBits.Green,
    fuelLevel: 15,
    fuelLevelPct: 0.15,
    cars: [
      { carIdx: 0, position: 1, classPosition: 1, lapDistPct: 0.60, f2Time: 0.0,  lapsCompleted: 10 },
      { carIdx: 1, position: 2, classPosition: 2, lapDistPct: 0.00, f2Time: 0.0,  lapsCompleted:  9, onPitRoad: true, trackSurface: TrackSurface.PitStall },
      { carIdx: 2, position: 3, classPosition: 3, lapDistPct: 0.55, f2Time: 3.0,  lapsCompleted: 10 },
    ],
  });
}

/**
 * Scenario C — yellow flag full course, all cars slowing.
 * Baseline for: FLAG_YELLOW_FULL_COURSE, SESSION_STATE_CHANGE.
 */
export function scenarioC(): TelemetryFrame {
  return makeFrame({
    sessionState: SessionStateEnum.Racing,
    sessionFlags: FlagBits.YellowFullCourse,
    cars: [
      { carIdx: 0, position: 1, classPosition: 1, lapDistPct: 0.30 },
      { carIdx: 1, position: 2, classPosition: 2, lapDistPct: 0.28 },
      { carIdx: 2, position: 3, classPosition: 3, lapDistPct: 0.25, trackSurface: TrackSurface.OffTrack },
    ],
  });
}

/**
 * Scenario D — final lap, checkered flag transition.
 * Baseline for: RACE_CHECKERED, SESSION_ENDED.
 */
export function scenarioD(): TelemetryFrame {
  return makeFrame({
    sessionState: SessionStateEnum.Racing,
    sessionFlags: FlagBits.White,
    cars: [
      { carIdx: 0, position: 1, classPosition: 1, lapDistPct: 0.90, lapsCompleted: 29 },
      { carIdx: 1, position: 2, classPosition: 2, lapDistPct: 0.88, lapsCompleted: 29 },
    ],
  });
}
