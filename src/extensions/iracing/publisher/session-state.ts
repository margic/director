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

  // Race-narrative additions (#151–#156). All default to 0 / -1 when the
  // raw read is missing so existing fixtures and the koffi reader stay
  // backwards compatible.
  /** iRacing: SessionLapsRemainEx (or SessionLapsRemain) — laps left in session, -1 = unknown/unlimited */
  sessionLapsRemain: number;
  /** iRacing: SessionLapsTotal — total laps for the session, -1 = unknown/timed */
  sessionLapsTotal: number;
  /** iRacing: SessionTimeRemain (seconds) — -1 = unknown/lap-limited */
  sessionTimeRemain: number;
  /** iRacing: LapDeltaToBestLap (seconds, signed) — current vs personal best, mid-lap */
  lapDeltaToBestLap: number;
  /** iRacing: LapDeltaToBestLap_OK (bool/int) — whether the delta is valid */
  lapDeltaToBestLapOk: number;
  /** iRacing: EngineWarnings bitmask */
  engineWarnings: number;
  /** iRacing: FuelUsePerHour (litres/hour) */
  fuelUsePerHour: number;
  /** iRacing: LFtempCM (left front centre tyre temperature, Celsius) */
  lfTempCM: number;
  /** iRacing: RFtempCM (right front centre tyre temperature, Celsius) */
  rfTempCM: number;
  /** iRacing: LRtempCM (left rear centre tyre temperature, Celsius) */
  lrTempCM: number;
  /** iRacing: RRtempCM (right rear centre tyre temperature, Celsius) */
  rrTempCM: number;

  // Group A: Driver inputs (player car only) — #178
  /** iRacing: Throttle (0.0–1.0) */
  throttle: number;
  /** iRacing: Brake (0.0–1.0) */
  brake: number;
  /** iRacing: Clutch (0.0–1.0) */
  clutch: number;
  /** iRacing: Gear (-1=reverse, 0=neutral, 1-6=forward) */
  gear: number;
  /** iRacing: RPM — engine revolutions per minute */
  rpm: number;
  /** iRacing: BrakeABSactive — 1 when ABS is actively braking, 0 otherwise */
  brakeABSactive: number;
  /** iRacing: dcBrakeBias — front brake bias (0.0–1.0) */
  dcBrakeBias: number;
  /** iRacing: SteeringWheelTorque (Nm) — torque the driver is fighting */
  steeringWheelTorque: number;
  /** iRacing: HandbrakeRaw (0.0–1.0) */
  handbrakeRaw: number;

  // Group B: Vehicle dynamics (player car only) — #178
  /** iRacing: Lat — WGS84 latitude (decimal degrees) */
  lat: number;
  /** iRacing: Lon — WGS84 longitude (decimal degrees) */
  lon: number;
  /** iRacing: Alt — altitude above MSL (metres) */
  alt: number;
  /** iRacing: Pitch (radians) — positive = nose up */
  pitch: number;
  /** iRacing: Roll (radians) — positive = right side down */
  roll: number;
  /** iRacing: Yaw (radians) — 0 = north, increases clockwise */
  yaw: number;
  /** iRacing: LatAccel (m/s²) — positive = right */
  latAccel: number;
  /** iRacing: LongAccel (m/s²) — positive = forward */
  longAccel: number;
  /** iRacing: VertAccel (m/s²) — positive = up */
  vertAccel: number;
  /** iRacing: YawRate (rad/s) — positive = turning right */
  yawRate: number;
  /** iRacing: VelocityX (m/s) — world X axis velocity */
  velocityX: number;
  /** iRacing: VelocityY (m/s) — world Y axis velocity */
  velocityY: number;
  /** iRacing: VelocityZ (m/s) — world Z axis velocity */
  velocityZ: number;
  /** iRacing: WaterTemp (Celsius) */
  waterTemp: number;
  /** iRacing: OilTemp (Celsius) */
  oilTemp: number;
  /** iRacing: OilPressure (bar) */
  oilPressure: number;
  /** iRacing: Voltage (V) */
  voltage: number;

  // Group C: Per-tyre wear and pressure (player car only) — #178
  /** iRacing: LFwearL — left front tyre wear, inside strip (0.0–1.0) */
  lfWearL: number;
  /** iRacing: LFwearM — left front tyre wear, centre strip (0.0–1.0) */
  lfWearM: number;
  /** iRacing: LFwearR — left front tyre wear, outside strip (0.0–1.0) */
  lfWearR: number;
  /** iRacing: RFwearL — right front tyre wear, inside strip */
  rfWearL: number;
  /** iRacing: RFwearM — right front tyre wear, centre strip */
  rfWearM: number;
  /** iRacing: RFwearR — right front tyre wear, outside strip */
  rfWearR: number;
  /** iRacing: LRwearL — left rear tyre wear, inside strip */
  lrWearL: number;
  /** iRacing: LRwearM — left rear tyre wear, centre strip */
  lrWearM: number;
  /** iRacing: LRwearR — left rear tyre wear, outside strip */
  lrWearR: number;
  /** iRacing: RRwearL — right rear tyre wear, inside strip */
  rrWearL: number;
  /** iRacing: RRwearM — right rear tyre wear, centre strip */
  rrWearM: number;
  /** iRacing: RRwearR — right rear tyre wear, outside strip */
  rrWearR: number;
  /** iRacing: LFpressure (kPa) — left front tyre pressure */
  lfPressure: number;
  /** iRacing: RFpressure (kPa) — right front tyre pressure */
  rfPressure: number;
  /** iRacing: LRpressure (kPa) — left rear tyre pressure */
  lrPressure: number;
  /** iRacing: RRpressure (kPa) — right rear tyre pressure */
  rrPressure: number;

  // Group D: Per-car spatial awareness — #178
  /** iRacing: CarIdxEstTime — estimated time behind leader, per car (seconds) */
  carIdxEstTime: Float32Array;
  /** iRacing: CarIdxSteer — steering angle per car (radians) */
  carIdxSteer: Float32Array;
  /** iRacing: CarIdxRPM — engine RPM per car */
  carIdxRPM: Float32Array;
  /** iRacing: CarIdxPaceLine — formation-lap pace line slot per car (-1 = not assigned) */
  carIdxPaceLine: Int32Array;
  /** iRacing: CarIdxPaceRow — formation-lap pace row per car (-1 = not assigned) */
  carIdxPaceRow: Int32Array;
  /** iRacing: CarIdxQualTireCompound — qualifying tyre compound index per car */
  carIdxQualTireCompound: Int32Array;
  /** iRacing: CarIdxTireCompound — current tyre compound index per car */
  carIdxTireCompound: Int32Array;
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

  // ---- Race-narrative trend fields (#151) ----
  /** Rolling window (last 5) of CarIdxF2Time samples (gap to car ahead). */
  recentGapToAhead: number[];
  /** Closing rate vs car ahead in seconds-per-lap (positive = closing). */
  closingRateToAhead: number;
  /** Rolling window (last 5) of gap-to-car-behind samples. */
  recentGapToBehind: number[];
  /** Closing rate vs car behind in seconds-per-lap (positive = behind closing on us). */
  closingRateToBehind: number;
  /** Laps completed since the most recent pit exit. */
  lapsSinceLastPit: number;
  /** Estimated number of laps remaining in the current fuel load (player only). */
  estimatedFuelLapsRemaining: number;
  /** True when the player is within the last 5 laps of the estimated stint. */
  inPitWindow: boolean;
  /** Last 3 sampled classPosition values for hysteresis on CLASS_POSITION_GAIN/LOSS. */
  classPositionHistory: number[];
  /** Last 3 sampled overall position values for hysteresis on OVERALL_POSITION_GAIN/LOSS. */
  overallPositionHistory: number[];
  /** Stint lap times (seconds) — accumulated since the start of the current stint. */
  stintLapTimes: number[];

  // ---- Pit lifecycle fields (#198 PR-B) ----
  /** SessionTime when the car entered pit road (PIT_ENTRY edge). Null when off pit road. */
  pitEntrySessionTime: number | null;
  /** Race-condition stop type determined at PIT_ENTRY. */
  pitStopType: 'green' | 'sc' | 'red' | 'unknown' | null;
  /** SessionTime when the car first stopped in the pit stall (trackSurface 2). */
  stallArrivalSessionTime: number | null;
  /** FuelLevel (litres) when the car arrived in the stall (player car only). */
  stallFuelOnEntry: number;

  // ---- Incident tracking (#201 PR-E) ----
  /** SessionTime of the most recent INCIDENT emission for this car (-Infinity = never). */
  lastIncidentSessionTime: number | undefined;
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
  /** Whether IDENTITY_RESOLVED has been emitted this session */
  identityResolved: boolean;
  /** Active traffic announcements keyed by battleKey(chaser, leader).
   *  Tracks whether LAPPED_TRAFFIC_AHEAD or BEING_LAPPED has already fired
   *  for a given (chaser, leader) pair while they remain close. */
  trafficAnnouncements: Map<string, 'LAPPED_AHEAD' | 'BEING_LAPPED'>;

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

  // ---- Race-narrative additions (#151–#156) ----
  /** Race phase derived from SessionLapsRemain/Total or SessionTimeRemain. */
  racePhase: 'unknown' | 'opening' | 'midrace' | 'endgame' | 'final-laps';
  /** Cars within 1.0 s of each other, grouped by carClassId. Rebuilt per frame. */
  classGroups: Map<number, number[][]>;
  /** Per-car pit strategy summary keyed by carIdx. */
  pitStrategySummary: Map<number, {
    estStintLaps: number;
    lapsRemainingInStint: number;
    undercutOpportunityAgainst: number | null;
  }>;
  /** Estimated player stint length in laps (from setSessionMetadata). */
  estimatedStintLaps: number;
  /** Whether IN_PIT_WINDOW has fired for the current stint. */
  inPitWindowFired: boolean;
  /** SessionTime of the last GAP_CLOSING/GAP_OPENING emission per direction. */
  lastGapTrendEmittedAt: { ahead: number; behind: number };
  /** Direction of the last GAP_CLOSING/GAP_OPENING emission per direction. */
  lastGapTrendDirection: { ahead: 'closing' | 'opening' | 'none'; behind: 'closing' | 'opening' | 'none' };
  /** Last classPosition value emitted for CLASS_POSITION_GAIN/LOSS gating. */
  lastEmittedClassPosition: number;
  /** Last overall position value emitted for OVERALL_POSITION_GAIN/LOSS gating. */
  lastEmittedOverallPosition: number;
  /** Lap number on which FUEL_PROJECTION last fired (one per lap cap). */
  fuelProjectionLastLap: number;
  /** Latch — PACE_DROP fired this stint (cleared on stint reset). */
  paceDropFired: boolean;
  /** Last sectorIdx in which SECTOR_PERSONAL_BEST fired (for cooldown). */
  sectorPersonalBestLastSector: number;
  /** Last lap on which SECTOR_PERSONAL_BEST fired. */
  sectorPersonalBestLastLap: number;
  /** Rolling 5-sample baselines per tyre and last emit times for TYRE_TEMP_DRIFT. */
  tyreTempBaseline: { LF: number[]; RF: number[]; LR: number[]; RR: number[] };
  tyreTempDriftLastEmit: { LF: number; RF: number; LR: number; RR: number };
  /** Last EngineWarnings bitmask seen — change-detection for ENGINE_WARNING. */
  lastEngineWarnings: number;

  // ---- Composite events (#181) ----
  /**
   * Rolling window of recent STOPPED_ON_TRACK observations used by the
   * SAFETY_CAR_IMMINENT detector. Pruned to the last 30 s on every tick.
   */
  recentStoppedOnTrackEvents: Array<{
    sessionTime: number;
    carIdx: number;
    lapDistPct: number;
  }>;
  /** sessionTime of the most recent SAFETY_CAR_IMMINENT emission (-Infinity = never). */
  lastSafetyCarImminentEmittedAt: number;

  // ---- #196 fixes ----
  /** True once RACE_GREEN has been emitted for this session.
   *  Detectors use this to suppress pre-green state-based emissions
   *  (STOPPED_ON_TRACK, LAPPED_TRAFFIC_AHEAD, BEING_LAPPED, SAFETY_CAR_IMMINENT). */
  raceGreenFired: boolean;
  /** Per-pair count of consecutive frames that a previously-latched traffic pair
   *  has been above the exit-hysteresis threshold. Keyed like trafficAnnouncements. */
  trafficExitFrames: Map<string, number>;
  /** Whether RACE_CHECKERED has been emitted this session (prevents 53x flood). */
  checkeredFired: boolean;
  /** Whether active battles have been flushed as BATTLE_BROKEN on the checkered flag (#207). */
  checkeredBattlesFlushed: boolean;
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
    recentGapToAhead: [],
    closingRateToAhead: 0,
    recentGapToBehind: [],
    closingRateToBehind: 0,
    lapsSinceLastPit: 0,
    estimatedFuelLapsRemaining: 0,
    inPitWindow: false,
    classPositionHistory: [],
    overallPositionHistory: [],
    stintLapTimes: [],
    pitEntrySessionTime: null,
    pitStopType: null,
    stallArrivalSessionTime: null,
    stallFuelOnEntry: 0,
    lastIncidentSessionTime: undefined,
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
    identityResolved: false,
    trafficAnnouncements: new Map(),
    knownRoster: new Map(),
    firedTrackTempDrift: false,
    lastTimeOfDayPhase: '',
    lastWeatherSkies: -1,
    lastWeatherRelativeHumidity: -1,
    lastWeatherFogLevel: -1,
    racePhase: 'unknown',
    classGroups: new Map(),
    pitStrategySummary: new Map(),
    estimatedStintLaps: 0,
    inPitWindowFired: false,
    lastGapTrendEmittedAt: { ahead: -Infinity, behind: -Infinity },
    lastGapTrendDirection: { ahead: 'none', behind: 'none' },
    lastEmittedClassPosition: 0,
    lastEmittedOverallPosition: 0,
    fuelProjectionLastLap: -1,
    paceDropFired: false,
    sectorPersonalBestLastSector: -1,
    sectorPersonalBestLastLap: -1,
    tyreTempBaseline: { LF: [], RF: [], LR: [], RR: [] },
    tyreTempDriftLastEmit: { LF: 0, RF: 0, LR: 0, RR: 0 },
    lastEngineWarnings: 0,
    recentStoppedOnTrackEvents: [],
    lastSafetyCarImminentEmittedAt: -Infinity,
    raceGreenFired: false,
    trafficExitFrames: new Map(),
    checkeredFired: false,
    checkeredBattlesFlushed: false,
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
 * Returns a `PublisherCarRef` for the given carIdx.
 *
 * If the roster entry is missing (e.g. the SDK's session YAML hasn't been
 * parsed yet), a minimal ref carrying only `carIdx` is returned.  Consumers
 * that need richer identity (name, class) should check whether `driverName`
 * is present and decide whether to defer the event.  Callers can rely on
 * this function **never** returning `undefined`, which eliminates the large
 * number of `if (!carRef) continue` guards that were suppressing events
 * before the roster was populated (#196 PR-C).
 */
export function carRefFromRoster(
  state: SessionState,
  carIdx: number,
): PublisherCarRef {
  const ref = state.knownRoster.get(carIdx);
  if (!ref) {
    // Roster not yet populated — return a minimal stub so events are not lost.
    return { carIdx, carNumber: '', driverName: '', teamName: '', carClassShortName: '', carClassId: 0 };
  }
  return {
    carIdx,
    carNumber:         ref.carNumber,
    driverName:        ref.driverName,
    teamName:          ref.teamName,
    carClassShortName: ref.carClassShortName,
    carClassId:        ref.carClassId,
  };
}

// ---------------------------------------------------------------------------
// Event builder — attaches the session / rig context to a bare event
// ---------------------------------------------------------------------------

export interface CarRefInput {
  carIdx: number;
  carNumber?: string;
  driverName?: string;
  teamName?: string;
  carClassShortName?: string;
  carClassId?: number;
}

export interface EventBuilderOptions {
  raceSessionId: string;
  rigId: string;
  frame: TelemetryFrame;
  leaderLap?: number;
}

/**
 * Estimates the on-track time gap between two cars using their normalized lap
 * progress (lapCompleted + lapDistPct) and a reference lap time.
 *
 * This is the class-aware alternative to CarIdxF2Time. In multi-class races
 * F2Time reflects the gap to the physically nearest car ahead regardless of
 * class, so prototype traffic constantly corrupts GTD/GT3 battle detection.
 * By computing the gap from lap-distance fractions we always get the true
 * same-class inter-car interval.
 *
 * Returns 999 when the gap is invalid (chaser is ahead, cars are more than
 * 2 laps apart, or no usable lap-time reference is available).
 */
export function estimateSameClassGap(
  frame: TelemetryFrame,
  chaserIdx: number,
  leaderIdx: number,
): number {
  const leaderProg = frame.carIdxLapCompleted[leaderIdx] + frame.carIdxLapDistPct[leaderIdx];
  const chaserProg = frame.carIdxLapCompleted[chaserIdx] + frame.carIdxLapDistPct[chaserIdx];
  const diff = leaderProg - chaserProg;
  if (diff < 0 || diff > 2) return 999;
  // Use the leader's last lap time as the lap-time reference; fall back to a
  // reasonable default when the lap hasn't been completed yet.
  const refLapTime = frame.carIdxLastLapTime[leaderIdx] > 0
    ? frame.carIdxLastLapTime[leaderIdx]
    : 90;
  return diff * refLapTime;
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
    rigId: opts.rigId,
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
