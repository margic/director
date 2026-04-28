import { randomUUID } from 'crypto';
import type { PublisherEvent, PublisherEventType, EventPayloadMap, PublisherCarRef } from './event-types';

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

  // Player-car physics (single-car telemetry, not per-car arrays)
  /** iRacing: Speed (m/s) — player car ground speed */
  speed: number;
  /** iRacing: SteeringWheelAngle (radians, positive = left turn) */
  steeringWheelAngle: number;
  /** iRacing: SteeringWheelPctTorque (0.0–1.0) — may be 0 for some cars */
  steeringWheelPctTorque: number;
  /** iRacing: SolarAltitude (radians from horizon, positive = above) */
  solarAltitude: number;
  /** iRacing: CarIdxSpeed (m/s) per car */
  carIdxSpeed: Float32Array;
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
  /** CarIdxPosition at the time of PIT_ENTRY (used for POSITION_CHANGE on exit) */
  pitEntryPosition: number | null;
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
  /** iRacing sessionTime at which zero-movement was first observed (null when moving). */
  stoppedStartSessionTime: number | null;
  /** FuelLevel (litres) when the car entered the pit stall (PIT_STOP_BEGIN). */
  pitStallArrivalFuelLevel: number | null;
  /** True while the car is on its first flying lap after a pit stop exit. */
  onOutLap: boolean;
  /** lapsCompleted when the car exited the pits — used to detect OUT_LAP. */
  pitExitLapsCompleted: number | null;
  /** lapsCompleted at the start of the current stint (session start or pit exit). */
  stintStartLap: number;
  /** Stint milestone percents (25 / 50 / 75) already fired this stint. */
  firedStintMilestones: Set<number>;
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
  /** Whether a BATTLE_CLOSING event has already been announced for the current
   * closing trend. Reset when the battle engages or the gap leaves the 1.0–2.0s band. */
  closingAnnounced: boolean;
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
  /** Active traffic announcements keyed by battleKey(chaser, leader).
   *  Tracks whether LAPPED_TRAFFIC_AHEAD or BEING_LAPPED has already fired
   *  for a given (chaser, leader) pair while they remain close. */
  trafficAnnouncements: Map<string, 'LAPPED_AHEAD' | 'BEING_LAPPED'>;
  /** Rolling buffer of recent player lap times (seconds) used by
   *  LAP_TIME_DEGRADATION (#100). Capped to LAP_DEGRADATION_BUFFER_SIZE. */
  playerLapTimeBuffer: number[];
  /** Latch — true once LAP_TIME_DEGRADATION has fired in the current stint. */
  playerDegradationFired: boolean;
  /** FUEL_LOW thresholds already fired this session (values: 0.10, 0.05). */
  firedFuelLowThresholds: Set<number>;
  /** Estimated fuel consumption per lap in litres (0 until first completion). */
  playerFuelPerLap: number;
  /** Player FuelLevel at the start of the current lap (litres). */
  playerFuelAtLapStart: number;

  // ---- Driver swap state machine ----
  /** True once the operator has clicked "Initiate Driver Swap"; cleared by DRIVER_SWAP_COMPLETED. */
  driverSwapPending: boolean;
  /** Outgoing driver id (as supplied by the operator at initiation). */
  pendingSwapOutgoingDriverId: string;
  /** Incoming driver id (as supplied by the operator at initiation). */
  pendingSwapIncomingDriverId: string;
  /** Incoming driver display name (as supplied by the operator at initiation). */
  pendingSwapIncomingDriverName: string;
  /** iRacing sessionTime when the swap was initiated — used to compute swapDurationSec. */
  pendingSwapInitiatedSessionTime: number;
  /** Monotonically incrementing stint counter; starts at 1, incremented on each DRIVER_SWAP_COMPLETED. */
  playerStintNumber: number;

  // ---- Roster tracking ----
  /** Per-frame roster for ROSTER_UPDATED — diffed on each updateRoster() call to emit ROSTER_UPDATED. */
  knownRoster: Map<number, PublisherCarRef>;

  // ---- Environment tracking ----
  /** Whether TRACK_TEMP_DRIFT has already fired this session. */
  firedTrackTempDrift: boolean;
  /** Time-of-day phase last emitted (empty = not yet seeded). */
  lastTimeOfDayPhase: string;
  /** Skies value at the time of the last WEATHER_CHANGE emission (or initial seed). */
  lastWeatherSkies: number;
  /** RelativeHumidity at the time of the last WEATHER_CHANGE emission. */
  lastWeatherRelativeHumidity: number;
  /** FogLevel at the time of the last WEATHER_CHANGE emission. */
  lastWeatherFogLevel: number;

  // ---- Physics detector cooldowns (session tick values) ----
  /** Emit SLOW_CAR_AHEAD at most once per this many ticks (~30 s at 60Hz). */
  slowCarAheadCooldownUntilTick: number;
  /** Emit SPIN_DETECTED at most once per this many ticks. */
  spinDetectedCooldownUntilTick: number;
  /** Emit BIG_HIT at most once per this many ticks. */
  bigHitCooldownUntilTick: number;
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
    pitEntryPosition: null,
    pitStallArrivalTime: null,
    fuelLevelOnPitEntry: null,
    offTrackFrames: 0,
    stoppedFrames: 0,
    isStoppedOnTrack: false,
    stoppedStartSessionTime: null,
    pitStallArrivalFuelLevel: null,
    onOutLap: false,
    pitExitLapsCompleted: null,
    stintStartLap: 0,
    firedStintMilestones: new Set(),
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
    trafficAnnouncements: new Map(),
    playerLapTimeBuffer: [],
    playerDegradationFired: false,
    firedFuelLowThresholds: new Set(),
    playerFuelPerLap: 0,
    playerFuelAtLapStart: 0,
    driverSwapPending: false,
    pendingSwapOutgoingDriverId: '',
    pendingSwapIncomingDriverId: '',
    pendingSwapIncomingDriverName: '',
    pendingSwapInitiatedSessionTime: 0,
    playerStintNumber: 1,
    knownRoster: new Map(),
    firedTrackTempDrift: false,
    lastTimeOfDayPhase: '',
    lastWeatherSkies: -1,
    lastWeatherRelativeHumidity: -1,
    lastWeatherFogLevel: -1,
    slowCarAheadCooldownUntilTick: 0,
    spinDetectedCooldownUntilTick: 0,
    bigHitCooldownUntilTick: 0,
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

/**
 * Returns a CarRefInput for the given carIdx, resolved from the session roster.
 * Falls back to `{ carIdx, carNumber: '', driverName: '' }` when the car is not
 * yet in the roster so that detectors always emit events (with partial metadata)
 * rather than silently dropping them before the roster is populated.
 */
export function carRefFromRoster(
  state: SessionState,
  carIdx: number,
): { carIdx: number; carNumber: string; driverName: string } {
  const ref = state.knownRoster.get(carIdx);
  if (!ref) return { carIdx, carNumber: '', driverName: '' };
  return { carIdx, carNumber: ref.carNumber, driverName: ref.driverName };
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
