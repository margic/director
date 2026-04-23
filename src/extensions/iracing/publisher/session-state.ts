import { randomUUID } from 'crypto';
import type { PublisherEvent, PublisherEventType, EventPayloadMap } from './event-types';

// ---------------------------------------------------------------------------
// TelemetryFrame — snapshot of iRacing shared memory for the publisher pipeline
// All arrays are indexed by CarIdx (0–63).
// ---------------------------------------------------------------------------

export interface TelemetryFrame {
  /** iRacing: SessionTick */
  sessionTick: number;
  /** iRacing: SessionTime (seconds) */
  sessionTime: number;
  /** iRacing: SessionState enum */
  sessionState: number;
  /** iRacing: SessionFlags bitmask */
  sessionFlags: number;
  /** iRacing: SessionUniqueID — changes on new session/subsession */
  sessionUniqueId: number;

  // Per-car arrays (length 64)
  /** iRacing: CarIdxPosition */
  carIdxPosition: Int32Array;
  /** iRacing: CarIdxClassPosition */
  carIdxClassPosition: Int32Array;
  /** iRacing: CarIdxOnPitRoad */
  carIdxOnPitRoad: Uint8Array;
  /** iRacing: CarIdxTrackSurface (-1=offtrack, 1=ontrack, 2=pit stall, 3=approaching pits, 4=pit lane) */
  carIdxTrackSurface: Int32Array;
  /** iRacing: CarIdxLastLapTime (seconds) */
  carIdxLastLapTime: Float32Array;
  /** iRacing: CarIdxBestLapTime (seconds) */
  carIdxBestLapTime: Float32Array;
  /** iRacing: CarIdxLapCompleted */
  carIdxLapCompleted: Int32Array;
  /** iRacing: CarIdxLapDistPct (0.0–1.0) */
  carIdxLapDistPct: Float32Array;
  /** iRacing: CarIdxF2Time — gap to car ahead in seconds */
  carIdxF2Time: Float32Array;
  /** iRacing: CarIdxSessionFlags — per-car flag bitmask */
  carIdxSessionFlags: Int32Array;

  // Player car fields
  /** iRacing: FuelLevel (litres) */
  fuelLevel: number;
  /** iRacing: FuelLevelPct (0.0–1.0) */
  fuelLevelPct: number;
  /** iRacing: PlayerCarMyIncidentCount */
  playerIncidentCount: number;
  /** iRacing: PlayerCarTeamIncidentCount */
  teamIncidentCount: number;
  /** iRacing: IncidentLimit */
  incidentLimit: number;

  // Environmental
  /** iRacing: Skies enum */
  skies: number;
  /** iRacing: TrackTemp (Celsius) */
  trackTemp: number;
  /** iRacing: WindDir (radians) */
  windDir: number;
  /** iRacing: WindVel (m/s) */
  windVel: number;
  /** iRacing: RelativeHumidity (0.0–1.0) */
  relativeHumidity: number;
  /** iRacing: FogLevel (0.0–1.0) */
  fogLevel: number;
}

// ---------------------------------------------------------------------------
// Per-car state — tracks last known values for transition detection
// ---------------------------------------------------------------------------

export interface CarState {
  position: number;
  classPosition: number;
  onPitRoad: boolean;
  /** iRacing: CarIdxTrackSurface value */
  trackSurface: number;
  lastLapTime: number;
  bestLapTime: number;
  lapsCompleted: number;
  lapDistPct: number;
  /** Current in-session best lap (this stint) */
  stintBestLapTime: number;
  /** iRacing: CarIdxSessionFlags */
  sessionFlags: number;
  /** Lap on which the car entered the pits */
  pitEntryLap: number | null;
  /** SessionTime when the car arrived in the pit stall */
  pitStallArrivalTime: number | null;
  /** FuelLevel when the car entered the pits */
  fuelLevelOnPitEntry: number | null;
  /** Consecutive frames off-track (for sustained detection) */
  offTrackFrames: number;
  /** Consecutive frames stopped (for stopped-on-track detection) */
  stoppedFrames: number;
  /** Whether the car is currently considered stopped on track */
  isStoppedOnTrack: boolean;
}

// ---------------------------------------------------------------------------
// Battle state
// ---------------------------------------------------------------------------

export interface BattleState {
  chaserCarIdx: number;
  leaderCarIdx: number;
  status: 'ENGAGED' | 'CLOSING' | 'BROKEN';
  gapSec: number;
  closingRateSecPerLap: number;
  engagedAt: number;
  /** Consecutive frames gap has been > 2.0s (for BATTLE_BROKEN detection) */
  brokenFrames: number;
  /** Previous gap reading — used to compute closing rate */
  previousGapSec: number;
}

// ---------------------------------------------------------------------------
// Session state — one instance per active raceSessionId
// ---------------------------------------------------------------------------

export interface SessionState {
  raceSessionId: string;
  /** iRacing: SessionUniqueID at the time this state was created */
  sessionUniqueId: number;
  previousFrame: TelemetryFrame | null;
  carStates: Map<number, CarState>;
  /** Key: normalised "carA-carB" where carA < carB */
  activeBattles: Map<string, BattleState>;
  /** Last known SessionState enum */
  lastSessionState: number;
  /** Last known session type string */
  lastSessionType: string;
  /** Session-best lap time across all cars */
  sessionBestLapTime: number;
  /** Class-best lap times, keyed by CarClassID */
  classBestLapTimes: Map<number, number>;
  /** Track temp at session load (for drift detection) */
  sessionStartTrackTemp: number;
  /** Player incident count at session start */
  sessionStartIncidentCount: number;
  /** Team incident count at session start */
  sessionStartTeamIncidentCount: number;
  /** Incident limit thresholds already fired this session */
  firedIncidentWarnings: Set<number>;
  /** Whether IDENTITY_RESOLVED has been emitted this session */
  identityResolved: boolean;
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeDefaultCarState(): CarState {
  return {
    position: 0,
    classPosition: 0,
    onPitRoad: false,
    trackSurface: 1,
    lastLapTime: 0,
    bestLapTime: 0,
    lapsCompleted: 0,
    lapDistPct: 0,
    stintBestLapTime: 0,
    sessionFlags: 0,
    pitEntryLap: null,
    pitStallArrivalTime: null,
    fuelLevelOnPitEntry: null,
    offTrackFrames: 0,
    stoppedFrames: 0,
    isStoppedOnTrack: false,
  };
}

export function createSessionState(raceSessionId: string, sessionUniqueId: number): SessionState {
  return {
    raceSessionId,
    sessionUniqueId,
    previousFrame: null,
    carStates: new Map(),
    activeBattles: new Map(),
    lastSessionState: -1,
    lastSessionType: '',
    sessionBestLapTime: 0,
    classBestLapTimes: new Map(),
    sessionStartTrackTemp: 0,
    sessionStartIncidentCount: 0,
    sessionStartTeamIncidentCount: 0,
    firedIncidentWarnings: new Set(),
    identityResolved: false,
  };
}

/** Returns the CarState for the given index, creating a default entry if needed. */
export function getOrCreateCarState(state: SessionState, carIdx: number): CarState {
  let car = state.carStates.get(carIdx);
  if (!car) {
    car = makeDefaultCarState();
    state.carStates.set(carIdx, car);
  }
  return car;
}

/** Normalised battle key — always lower carIdx first to avoid duplicates. */
export function battleKey(carA: number, carB: number): string {
  return carA < carB ? `${carA}-${carB}` : `${carB}-${carA}`;
}

// ---------------------------------------------------------------------------
// Event builder — attaches the session / rig context to a bare event
// ---------------------------------------------------------------------------

export interface CarRefInput {
  carIdx: number;
  carNumber: string;
  driverName: string;
  teamName?: string;
  carClassShortName?: string;
}

export interface EventBuilderOptions {
  raceSessionId: string;
  publisherCode: string;
  frame: TelemetryFrame;
  leaderLap?: number;
}

export function buildEvent<T extends PublisherEventType>(
  type: T,
  car: CarRefInput,
  payload: EventPayloadMap[T],
  opts: EventBuilderOptions,
): PublisherEvent<T> {
  return {
    id: randomUUID(),
    raceSessionId: opts.raceSessionId,
    publisherCode: opts.publisherCode,
    type,
    timestamp: Date.now(),
    sessionTime: opts.frame.sessionTime,
    sessionTick: opts.frame.sessionTick,
    car,
    payload,
    context: {
      leaderLap: opts.leaderLap,
      sessionState: opts.frame.sessionState,
      sessionFlags: opts.frame.sessionFlags,
      trackTemp: opts.frame.trackTemp,
    },
  };
}
