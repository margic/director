/**
 * Publisher Event Types
 *
 * Wire contract between the iRacing Publisher Extension and the Race Control API.
 * All events are POST-ed to /api/telemetry/events as PublisherEvent[].
 *
 * Design rule: publishers emit only what they can *directly observe* on their rig.
 * Cloud-synthesized events are marked as CLOUD-EMITTED — the publisher never produces them.
 *
 * iRacing SDK field names reference: public/telemetry.proto
 */

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface PublisherEvent<T extends PublisherEventType = PublisherEventType> {
  /** UUID v4 — idempotency key */
  id: string;
  /** Cloud-assigned session id (from check-in response) */
  raceSessionId: string;
  /** Auto-generated UUID for this rig; set from publisher.rigId setting. Optional annotation for debugging. */
  rigId?: string;
  /** Event type discriminator */
  type: T;
  /** ms since epoch (publisher clock) */
  timestamp: number;
  /** iRacing SessionTime in seconds — iRacing: SessionTime */
  sessionTime: number;
  /** iRacing SessionTick — used for deduplication */
  sessionTick: number;
  /** The car this event is primarily about */
  car: PublisherCarRef;
  /** Event-specific payload — typed per event via PayloadMap */
  payload: EventPayloadMap[T];
  /** Optional cheap context block attached to every event */
  context?: PublisherEventContext;
}

export interface PublisherCarRef {
  /** iRacing CarIdx (0–63) */
  carIdx: number;
  /** iRacing CarNumberRaw — optional when roster is not yet resolved for this carIdx */
  carNumber?: string;
  /** Display name with edge identity override applied — optional when roster is not yet resolved */
  driverName?: string;
  teamName?: string;
  carClassShortName?: string;
  /** iRacing CarClassID — stable numeric identifier for the car class */
  carClassId?: number;
}

export interface PublisherEventContext {
  /** Leader lap number at time of event */
  leaderLap?: number;
  /** iRacing SessionState enum value */
  sessionState?: number;
  /** iRacing SessionFlags bitmask snapshot */
  sessionFlags?: number;
  /** iRacing TrackTemp in Celsius */
  trackTemp?: number;
}

// ---------------------------------------------------------------------------
// Event type union
// ---------------------------------------------------------------------------

/** All event types emitted by the publisher extension. */
export type PublisherEventType =
  // §1 Lifecycle & session state
  | 'PUBLISHER_HELLO'
  | 'PUBLISHER_HEARTBEAT'
  | 'PUBLISHER_GOODBYE'
  | 'IRACING_CONNECTED'
  | 'IRACING_DISCONNECTED'
  | 'SESSION_LOADED'
  | 'SESSION_STATE_CHANGE'
  | 'SESSION_TYPE_CHANGE'
  | 'RACE_GREEN'
  | 'RACE_CHECKERED'
  | 'SESSION_ENDED'
  // §2 Race control / flags
  | 'FLAG_GREEN'
  | 'FLAG_YELLOW_LOCAL'
  | 'FLAG_YELLOW_FULL_COURSE'
  | 'FLAG_RED'
  | 'FLAG_WHITE'
  | 'FLAG_BLUE_DRIVER'
  | 'FLAG_BLACK_DRIVER'
  | 'FLAG_MEATBALL_DRIVER'
  | 'FLAG_DEBRIS'
  | 'FLAG_DISQUALIFY'
  // §3 Lap & sector performance
  | 'LAP_COMPLETED'
  | 'PERSONAL_BEST_LAP'
  | 'SESSION_BEST_LAP'
  | 'CLASS_BEST_LAP'
  | 'LAP_TIME_DEGRADATION'
  | 'STINT_MILESTONE'
  | 'STINT_BEST_LAP'
  // §4 Position & battle
  | 'OVERTAKE'
  | 'OVERTAKE_FOR_LEAD'
  | 'OVERTAKE_FOR_CLASS'
  | 'POSITION_CHANGE'
  | 'BATTLE_ENGAGED'
  | 'BATTLE_CLOSING'
  | 'BATTLE_BROKEN'
  | 'LAPPED_TRAFFIC_AHEAD'
  | 'BEING_LAPPED'
  // Player-perspective position events (driver-publisher, player car only)
  | 'OVERALL_POSITION_LOSS'
  | 'OVERALL_POSITION_GAIN'
  // §5 Pit & strategy
  | 'PIT_ENTRY'
  | 'PIT_STOP_BEGIN'
  | 'PIT_STOP_END'
  | 'PIT_EXIT'
  | 'FUEL_LEVEL_CHANGE'
  | 'FUEL_LOW'
  | 'OUT_LAP'
  // §6 Incidents & safety
  | 'OFF_TRACK'
  | 'BACK_ON_TRACK'
  | 'STOPPED_ON_TRACK'
  | 'SLOW_CAR_AHEAD'
  | 'INCIDENT_POINT'
  | 'TEAM_INCIDENT_POINT'
  | 'INCIDENT_LIMIT_WARNING'
  | 'BIG_HIT'
  | 'SPIN_DETECTED'
  /** Player car stationary on track (speed-based, driver-publisher only). */
  | 'PLAYER_STOPPED'
  // §7 Identity & roster (edge-authoritative)
  | 'IDENTITY_RESOLVED'
  | 'IDENTITY_OVERRIDE_CHANGED'
  | 'DRIVER_SWAP_INITIATED'
  | 'DRIVER_SWAP_COMPLETED'
  | 'ROSTER_UPDATED'
  // §8 Environment
  | 'WEATHER_CHANGE'
  | 'TRACK_TEMP_DRIFT'
  | 'WIND_SHIFT'
  | 'TIME_OF_DAY_PHASE'
  // §9 Race-narrative additions (#151–#156). All driver-pipeline events,
  // gated on playerCarIdx. Backward-compatible — additive only.
  | 'GAP_CLOSING'
  | 'GAP_OPENING'
  | 'CLASS_POSITION_GAIN'
  | 'CLASS_POSITION_LOSS'
  | 'IN_PIT_WINDOW'
  | 'FUEL_PROJECTION'
  | 'PACE_DROP'
  | 'SECTOR_PERSONAL_BEST'
  | 'TYRE_TEMP_DRIFT'
  | 'ENGINE_WARNING'
  // §10 AI consumer aids (#179)
  /** Periodic snapshot of the current driver situation + recent events ring buffer. */
  | 'DRIVER_STATE_SNAPSHOT';

// CLOUD-EMITTED — publisher never produces these. Listed here for documentation only.
// 'FOCUS_VS_FOCUS_BATTLE' | 'FOCUS_GROUP_ON_TRACK' | 'FOCUS_GROUP_SPLIT'
// 'STINT_HANDOFF_HANDOVER' | 'RIG_FAILOVER' | 'STINT_BATON_PASS'
// 'UNDERCUT_DETECTED' | 'IN_LAP_DECLARED' | 'SESSION_LEADER_CHANGE'

// ---------------------------------------------------------------------------
// Payload map — keyed by event type
// ---------------------------------------------------------------------------

export interface EventPayloadMap {
  // §1 Lifecycle
  PUBLISHER_HELLO: PublisherHelloPayload;
  PUBLISHER_HEARTBEAT: Record<string, never>;
  PUBLISHER_GOODBYE: Record<string, never>;
  IRACING_CONNECTED: Record<string, never>;
  IRACING_DISCONNECTED: Record<string, never>;
  SESSION_LOADED: SessionLoadedPayload;
  SESSION_STATE_CHANGE: SessionStateChangePayload;
  SESSION_TYPE_CHANGE: SessionTypeChangePayload;
  RACE_GREEN: RaceGreenPayload;
  RACE_CHECKERED: Record<string, never>;
  SESSION_ENDED: Record<string, never>;

  // §2 Flags
  FLAG_GREEN: Record<string, never>;
  FLAG_YELLOW_LOCAL: FlagYellowPayload;
  FLAG_YELLOW_FULL_COURSE: Record<string, never>;
  FLAG_RED: Record<string, never>;
  FLAG_WHITE: Record<string, never>;
  /** iRacing source: CarIdxSessionFlags blue bit for the affected car */
  FLAG_BLUE_DRIVER: FlagDriverPayload;
  /** iRacing source: CarIdxSessionFlags black bit */
  FLAG_BLACK_DRIVER: FlagDriverPayload;
  /** iRacing source: CarIdxSessionFlags meatball bit */
  FLAG_MEATBALL_DRIVER: FlagDriverPayload;
  FLAG_DEBRIS: Record<string, never>;
  FLAG_DISQUALIFY: FlagDriverPayload;

  // §3 Lap performance
  /** iRacing source: CarIdxLapCompleted increment */
  LAP_COMPLETED: LapCompletedPayload;
  /** iRacing source: LapBestLapTime improvement for player car */
  PERSONAL_BEST_LAP: PersonalBestLapPayload;
  /** iRacing source: lowest CarIdxBestLapTime across all cars changes */
  SESSION_BEST_LAP: SessionBestLapPayload;
  /** iRacing source: best lap within CarClassID group */
  CLASS_BEST_LAP: ClassBestLapPayload;
  /** iRacing source: rolling avg of CarIdxLastLapTime rises > threshold from stint best */
  LAP_TIME_DEGRADATION: LapTimeDegradationPayload;
  /** Fires at 25%/50%/75% of expected stint length */
  STINT_MILESTONE: StintMilestonePayload;
  STINT_BEST_LAP: StintBestLapPayload;

  // §4 Position & battle
  /** iRacing source: CarIdxPosition swap, both cars CarIdxOnPitRoad=false */
  OVERTAKE: OvertakePayload;
  OVERTAKE_FOR_LEAD: OvertakePayload;
  OVERTAKE_FOR_CLASS: OvertakePayload;
  /** Position change via pit cycle — not an on-track pass */
  POSITION_CHANGE: PositionChangePayload;
  /** iRacing source: CarIdxF2Time delta < 1.0s, sustained 2 frames */
  BATTLE_ENGAGED: BattlePayload;
  /** Gap shrinking ≥ 0.2s/lap while < 2.0s */
  BATTLE_CLOSING: BattlePayload;
  /** Gap > 2.0s for 3+ frames after BATTLE_ENGAGED */
  BATTLE_BROKEN: BattlePayload;
  /** iRacing source: CarDistAhead < 100m, target has fewer CarIdxLap */
  LAPPED_TRAFFIC_AHEAD: TrafficPayload;
  BEING_LAPPED: TrafficPayload;  /** Player car lost an overall race position on-track (driver-publisher only). */
  OVERALL_POSITION_LOSS: OverallPositionChangePayload;
  /** Player car gained an overall race position on-track (driver-publisher only). */
  OVERALL_POSITION_GAIN: OverallPositionChangePayload;
  // §5 Pit & strategy
  /** iRacing source: CarIdxOnPitRoad false→true */
  PIT_ENTRY: PitEntryPayload;
  /** iRacing source: CarIdxTrackSurface == 2 (in pit stall) */
  PIT_STOP_BEGIN: PitStopBeginPayload;
  /** iRacing source: leaving stall */
  PIT_STOP_END: PitStopEndPayload;
  /** iRacing source: CarIdxOnPitRoad true→false */
  PIT_EXIT: PitExitPayload;
  /** iRacing source: FuelLevel jump > N L (player only — refuel) */
  FUEL_LEVEL_CHANGE: FuelLevelChangePayload;
  /** iRacing source: FuelLevelPct < 0.10 or < 0.05 (player only) */
  FUEL_LOW: FuelLowPayload;
  /** First flying lap after PIT_EXIT */
  OUT_LAP: Record<string, never>;

  // §6 Incidents
  /** iRacing source: CarIdxTrackSurface == -1, sustained 2 frames */
  OFF_TRACK: OffTrackPayload;
  BACK_ON_TRACK: BackOnTrackPayload;
  /** iRacing source: CarIdxTrackSurface == 0 sustained ≥ 3 frames while speed < 5 kph */
  STOPPED_ON_TRACK: StoppedOnTrackPayload;
  SLOW_CAR_AHEAD: SlowCarAheadPayload;
  /** iRacing source: PlayerCarMyIncidentCount increment */
  INCIDENT_POINT: IncidentPointPayload;
  /** iRacing source: PlayerCarTeamIncidentCount increment */
  TEAM_INCIDENT_POINT: IncidentPointPayload;
  /** Fires at 50%/75%/90% of IncidentLimit */
  INCIDENT_LIMIT_WARNING: IncidentLimitWarningPayload;
  BIG_HIT: Record<string, never>;
  SPIN_DETECTED: Record<string, never>;
  /** iRacing source: Speed scalar < threshold sustained (player-car, driver-publisher only). */
  PLAYER_STOPPED: PlayerStoppedPayload;

  // §7 Identity
  IDENTITY_RESOLVED: IdentityResolvedPayload;
  IDENTITY_OVERRIDE_CHANGED: IdentityOverrideChangedPayload;
  DRIVER_SWAP_INITIATED: DriverSwapInitiatedPayload;
  DRIVER_SWAP_COMPLETED: DriverSwapCompletedPayload;
  ROSTER_UPDATED: RosterUpdatedPayload;

  // §8 Environment
  WEATHER_CHANGE: WeatherChangePayload;
  TRACK_TEMP_DRIFT: TrackTempDriftPayload;
  WIND_SHIFT: WindShiftPayload;
  TIME_OF_DAY_PHASE: TimeOfDayPhasePayload;

  // §9 Race-narrative (#151–#156)
  GAP_CLOSING: GapTrendPayload;
  GAP_OPENING: GapTrendPayload;
  CLASS_POSITION_GAIN: ClassPositionChangePayload;
  CLASS_POSITION_LOSS: ClassPositionChangePayload;
  IN_PIT_WINDOW: InPitWindowPayload;
  FUEL_PROJECTION: FuelProjectionPayload;
  PACE_DROP: PaceDropPayload;
  SECTOR_PERSONAL_BEST: SectorPersonalBestPayload;
  TYRE_TEMP_DRIFT: TyreTempDriftPayload;
  ENGINE_WARNING: EngineWarningPayload;

  // §10 AI consumer aids (#179)
  DRIVER_STATE_SNAPSHOT: DriverStateSnapshotPayload;
}

// ---------------------------------------------------------------------------
// Payload interfaces
// ---------------------------------------------------------------------------

// §1 Lifecycle

export interface PublisherHelloPayload {
  version: string;
  capabilities: string[];
}

export interface SessionLoadedPayload {
  /** iRacing source: SessionUniqueID */
  sessionUniqueId: number;
  trackName: string;
  seriesName: string;
  sessionType: string;
  totalLaps: number;
}

export interface SessionStateChangePayload {
  /** iRacing source: SessionState enum value */
  previousState: number;
  newState: number;
}

export interface SessionTypeChangePayload {
  previousType: string;
  newType: string;
}

export interface RaceGreenPayload {
  /** Standing start or rolling start */
  startType: 'standing' | 'rolling';
}

// §2 Flags

export interface FlagYellowPayload {
  /** Approximate sector (0–2) derived from lapDistPct of incident */
  sector?: number;
}

export interface FlagDriverPayload {
  carIdx: number;
  carNumber: string;
}

// §3 Lap performance

export interface LapCompletedPayload {
  lapNumber: number;
  /** iRacing source: CarIdxLastLapTime — seconds */
  lapTime: number;
  position: number;
  classPosition: number;
  /** iRacing source: CarIdxF2Time — gap to leader in seconds */
  gapToLeaderSec: number;
}

export interface PersonalBestLapPayload {
  lapNumber: number;
  lapTime: number;
  previousBest: number;
}

export interface SessionBestLapPayload {
  lapNumber: number;
  lapTime: number;
  previousSessionBest: number;
}

export interface ClassBestLapPayload {
  lapNumber: number;
  lapTime: number;
  carClassId: number;
  carClassShortName: string;
}

export interface LapTimeDegradationPayload {
  /** Rolling average of recent laps */
  rollingAvgSec: number;
  stintBestSec: number;
  degradationPct: number;
}

export interface StintMilestonePayload {
  /** 25, 50, or 75 */
  milestonePercent: number;
  lapsCompleted: number;
  estimatedStintLaps: number;
}

export interface StintBestLapPayload {
  lapNumber: number;
  lapTime: number;
}

// §4 Position & battle

export interface OvertakePayload {
  overtakingCarIdx: number;
  /** Self-describing ref for the overtaken car. */
  overtakenCar: PublisherCarRef;
  newPosition: number;
  lap: number;
  /** Fraction of lap where pass occurred — iRacing: CarIdxLapDistPct */
  lapDistPct: number;
}

export interface PositionChangePayload {
  previousPosition: number;
  newPosition: number;
  reason: 'pit_cycle' | 'other';
}

export interface BattlePayload {
  /** Self-describing ref for the chaser car (also the envelope car). */
  chaserCar: PublisherCarRef;
  /** Self-describing ref for the leader car being chased. */
  leaderCar: PublisherCarRef;
  /** Gap in seconds — iRacing: CarIdxF2Time */
  gapSec: number;
  closingRateSecPerLap: number;
  status: 'ENGAGED' | 'CLOSING' | 'BROKEN';
}

export interface TrafficPayload {
  distanceMeters: number;
  /** Self-describing ref for the lapped car — populated on LAPPED_TRAFFIC_AHEAD only. */
  lappedCar?: PublisherCarRef;
  /** Self-describing ref for the lapping car — populated on BEING_LAPPED only. */
  lappingCar?: PublisherCarRef;
}

export interface StoppedOnTrackPayload {
  lapDistPct: number;
  stoppedDurationSec: number;
}

// §5 Pit & strategy

export interface PitEntryPayload {
  entryLap: number;
  position: number;
  gapToLeaderSec: number;
}

export interface PitStopBeginPayload {
  /** iRacing: SessionTime at arrival */
  arrivalSessionTime: number;
  fuelLevelOnEntry: number;
}

export interface PitStopEndPayload {
  serviceDurationSec: number;
  /** iRacing: FuelLevel delta — positive = fuel added */
  fuelLevelDelta: number;
}

export interface PitExitPayload {
  exitLap: number;
  newPosition: number;
  positionsLost: number;
}

export interface FuelLevelChangePayload {
  previousLevel: number;
  newLevel: number;
  deltaLitres: number;
}

export interface FuelLowPayload {
  /** 0.10 or 0.05 */
  threshold: number;
  fuelLevelPct: number;
  estimatedLapsRemaining: number;
}

// §6 Incidents

export interface OffTrackPayload {
  /** Fraction of lap — iRacing: CarIdxLapDistPct */
  lapDistPct: number;
  speedAtExitMps: number;
}

export interface BackOnTrackPayload {
  timeOffTrackSec: number;
}

export interface SlowCarAheadPayload {
  targetCarIdx: number;
  targetCarNumber: string;
  closingRateMps: number;
}

export interface IncidentPointPayload {
  incidentPoints: number;
  totalIncidentPoints: number;
}

export interface IncidentLimitWarningPayload {
  /** 50, 75, or 90 */
  thresholdPercent: number;
  currentCount: number;
  incidentLimit: number;
}

// §7 Identity & roster

export interface IdentityResolvedPayload {
  iracingUserName: string;
  displayName: string;
  racecenterDriverId?: string;
}

export interface IdentityOverrideChangedPayload {
  previousDisplayName: string;
  newDisplayName: string;
  racecenterDriverId?: string;
}

export interface DriverSwapInitiatedPayload {
  outgoingDriverId: string;
  incomingDriverId: string;
  incomingDriverName: string;
}

export interface DriverSwapCompletedPayload {
  swapDurationSec: number;
  incomingDriverId: string;
  incomingDriverName: string;
  stintNumberStarting: number;
}

export interface RosterUpdatedPayload {
  added: PublisherCarRef[];
  removed: PublisherCarRef[];
}

// ---------------------------------------------------------------------------
// High-priority event set — these bypass batching and flush immediately
// ---------------------------------------------------------------------------

export const HIGH_PRIORITY_EVENTS = new Set<PublisherEventType>([
  'OVERTAKE_FOR_LEAD',
  'STOPPED_ON_TRACK',
  'OVERALL_POSITION_LOSS',
  'PLAYER_STOPPED',
  'RACE_GREEN',
  'RACE_CHECKERED',
  'FLAG_RED',
  'FLAG_YELLOW_FULL_COURSE',
  'INCIDENT_LIMIT_WARNING',
]);

// ---------------------------------------------------------------------------
// §8 Environment payload interfaces
// ---------------------------------------------------------------------------

export interface WeatherChangePayload {
  /** iRacing Skies enum (0=clear, 1=PC, 2=MC, 3=OC) */
  previousSkies: number;
  newSkies: number;
  relativeHumidity: number;
  fogLevel: number;
}

export interface TrackTempDriftPayload {
  /** Current track temperature in Celsius */
  trackTempCelsius: number;
  /** Change from session start in Celsius (positive = warmer) */
  deltaFromStartCelsius: number;
  /** Track temperature at session start */
  sessionStartTempCelsius: number;
}

export interface WindShiftPayload {
  /** Current wind direction in radians */
  windDirRad: number;
  /** Current wind speed in m/s */
  windVelMps: number;
  /** Angular change from previous reading in degrees */
  deltaDeg: number;
}

export type TimeOfDayPhase = 'dawn' | 'day' | 'dusk' | 'night';

export interface TimeOfDayPhasePayload {
  phase: TimeOfDayPhase;
  /** Solar altitude in radians (positive = above horizon) */
  solarAltitudeRad: number;
}

// ---------------------------------------------------------------------------
// §9 Race-narrative payloads (#151–#156)
// ---------------------------------------------------------------------------

export interface GapTrendPayload {
  /** Self-describing ref for the target car (the one being closed on / opening). */
  targetCar: PublisherCarRef;
  /** Current gap in seconds. */
  gapSec: number;
  /** Closing rate in seconds per lap (positive = closing). */
  closingRateSecPerLap: number;
  /** Direction of the trend relative to the player car. */
  direction: 'ahead' | 'behind';
}

export interface ClassPositionChangePayload {
  previousClassPos: number;
  newClassPos: number;
  carClassId: number;
  carClassShortName: string;
  reason: 'overtake' | 'pit_cycle' | 'other';
}

export interface OverallPositionChangePayload {
  previousPosition: number;
  newPosition: number;
  reason: 'overtake' | 'pit_cycle' | 'other';
  /** Car that overtook the player — populated on OVERALL_POSITION_LOSS when reason === 'overtake'. */
  overtakingCar?: PublisherCarRef;
}

export interface PlayerStoppedPayload {
  /** Fraction along the lap (0.0–1.0). */
  lapDistPct: number;
  /** How long the player has been stopped (seconds). */
  stoppedDurationSec: number;
  /** Player ground speed at detection (m/s). */
  speed: number;
  /** Overall race position when stopped. */
  position: number;
}

export interface InPitWindowPayload {
  lapsRemainingInStint: number;
  estimatedStintLaps: number;
}

export interface FuelProjectionPayload {
  projectedLaps: number;
  fuelLevel: number;
  fuelPerLap: number;
  /** Threshold (laps) below which projection alerts. */
  thresholdLaps: number;
}

export interface PaceDropPayload {
  /** % drop vs stint best of the slowest sample lap (positive). */
  deltaPct: number;
  /** Last 2 lap times (seconds). */
  lapTimes: number[];
  stintBestSec: number;
}

export interface SectorPersonalBestPayload {
  sector: 1 | 2 | 3;
  deltaSec: number;
}

export type TyreId = 'LF' | 'RF' | 'LR' | 'RR';

export interface TyreTempDriftPayload {
  tyre: TyreId;
  tempC: number;
  baselineC: number;
  deltaC: number;
}

export interface EngineWarningPayload {
  /** Raw EngineWarnings bitmask. */
  warningFlags: number;
  /** Decoded warning names (e.g. 'WaterTempWarning', 'OilPressureWarning'). */
  warningNames: string[];
}

// ---------------------------------------------------------------------------
// §10 AI consumer aids — DRIVER_STATE_SNAPSHOT (#179)
// ---------------------------------------------------------------------------

export type SnapshotFlag =
  | 'green'
  | 'yellow'
  | 'red'
  | 'white'
  | 'checkered'
  | 'blue'
  | 'unknown';

export interface SnapshotBattleEntry {
  /** Self-describing ref for the rival car. */
  car: PublisherCarRef;
  /** Current gap to that car in seconds (always positive). */
  gapSec: number;
  /** Closing rate in seconds-per-lap (positive = closing on us / we are closing on them). */
  closingRateSecPerLap: number;
}

export interface SnapshotEventDigest {
  type: PublisherEventType;
  /** sessionTime (seconds) of the original event. */
  sessionTime: number;
  /** One-line summary suitable for downstream LLM prompts. */
  summary: string;
}

/**
 * DRIVER_STATE_SNAPSHOT — periodic + forced-flush snapshot of the player's
 * current situation. Designed for downstream AI consumers (race-narrative,
 * commentary, alerting). Strictly additive — never a substitute for the
 * authoritative discrete events.
 */
export interface DriverStateSnapshotPayload {
  /** ISO reason for this snapshot. */
  reason: 'cadence' | 'forced';

  // Identity
  driverName: string;
  carIdx: number;
  carNumber: string;
  stintNumber: number;

  // Current state
  position: number;
  classPosition: number;
  lap: number;
  lapDistPct: number;
  /** Player ground speed in m/s. */
  speed: number;
  onPitRoad: boolean;
  /** iRacing CarIdxTrackSurface enum value. */
  trackSurface: number;
  isStopped: boolean;
  isOffTrack: boolean;

  // Pace
  /** Most recent stint lap times (seconds, ordered oldest→newest, capped at 5). */
  recentLapTimes: number[];
  /** Best lap of the current stint (seconds, 0 = none). */
  stintBestLapTime: number;
  /** Personal best lap of the session (seconds, 0 = none). */
  personalBestLapTime: number;
  /** % delta of the most recent lap vs personal best (positive = slower, 0 when no data). */
  paceVsBestPct: number;

  // Strategy
  /** Litres of fuel remaining (raw FuelLevel). */
  fuelLevel: number;
  /** Estimated laps the current fuel load will sustain (0 when unknown). */
  fuelLapsRemaining: number;
  inPitWindow: boolean;
  /** Estimated stint length in laps (0 when unknown). */
  estimatedStintLaps: number;

  // Battle
  carAhead?: SnapshotBattleEntry;
  carBehind?: SnapshotBattleEntry;

  // Recent events (most recent last, capped at 10)
  recentEvents: SnapshotEventDigest[];

  // Race meta
  racePhase: 'unknown' | 'opening' | 'midrace' | 'endgame' | 'final-laps';
  flag: SnapshotFlag;
}
