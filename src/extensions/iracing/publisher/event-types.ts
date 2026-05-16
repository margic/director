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
  | 'PIT_STATIONARY'
  | 'PIT_STOP_BEGIN'
  | 'PIT_STOP_COMPLETED'
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
  /** Player car physical contact / hard hit (driver-publisher only) — #180. */
  | 'CONTACT_DETECTED'  /** Composite — OVERALL_POSITION_LOSS while player is stopped (#181). */
  | 'BEING_PASSED_WHILE_STOPPED'
  /** Composite — player climbs ≥2 positions within 60s after an incident (#181). */
  | 'RECOVERY_DRIVE'
  /** Session-publisher — ≥3 STOPPED_ON_TRACK in 30s OR ≥2 in same sector (#181). */
  | 'SAFETY_CAR_IMMINENT'
  /** Session-wide incident — off-track, contact, or loss-of-control for any car (#196). */
  | 'INCIDENT'
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
  | 'DRIVER_STATE_SNAPSHOT'
  // §12 Enricher meta-events (#183) — emitted by the optional post-publisher
  // LLM stage when it clusters bursts of low-level events into one beat.
  | 'INCIDENT_SUMMARY'
  | 'BATTLE_SUMMARY'
  | 'STINT_SUMMARY';

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
  /** iRacing source: CarIdxTrackSurface == 2 (car stationary in stall) */
  PIT_STATIONARY: PitStationaryPayload;
  /** iRacing source: CarIdxTrackSurface == 2 (in pit stall) — player-car detail */
  PIT_STOP_BEGIN: PitStopBeginPayload;
  /** iRacing source: car leaves stall after service */
  PIT_STOP_COMPLETED: PitStopCompletedPayload;
  /** iRacing source: leaving stall — player-car detail */
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
  /** Player physical contact / hard hit (driver-publisher, player-car only) — #180. */
  CONTACT_DETECTED: ContactDetectedPayload;
  /** Composite (#181) — OVERALL_POSITION_LOSS while player is stopped. */
  BEING_PASSED_WHILE_STOPPED: BeingPassedWhileStoppedPayload;
  /** Composite (#181) — climb ≥2 positions within 60s after an incident. */
  RECOVERY_DRIVE: RecoveryDrivePayload;
  /** Session-publisher (#181) — cluster of stopped cars predicting yellow. */
  SAFETY_CAR_IMMINENT: SafetyCarImminentPayload;
  /** Session-wide incident — off-track, contact, or loss-of-control (#196). */
  INCIDENT: IncidentPayload;

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

  // §12 Enricher meta-events (#183)
  INCIDENT_SUMMARY: IncidentSummaryPayload;
  BATTLE_SUMMARY: BattleSummaryPayload;
  STINT_SUMMARY: StintSummaryPayload;
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
  /** Seconds to the car immediately ahead in running order (same lap only). Omitted for cross-lap neighbours. */
  intervalAheadSec?: number;
  /** Seconds to the car immediately behind in running order (same lap only). */
  intervalBehindSec?: number;
  carAhead?: PublisherCarRef;
  carBehind?: PublisherCarRef;
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
  /**
   * Legacy carIdx of the overtaking car. Kept for backward compatibility with
   * consumers that parsed the original payload shape (#209). New consumers
   * should prefer overtakingCar, which is self-describing and symmetric
   * with overtakenCar.
   */
  overtakingCarIdx: number;
  /**
   * Self-describing ref for the overtaking car (#209). Mirrors overtakenCar so
   * downstream consumers (story engine, sequence planner, commentary) can
   * resolve the driver/team/car class for the overtaking side without an
   * external roster lookup.
   */
  overtakingCar: PublisherCarRef;
  /** Self-describing ref for the overtaken car. */
  overtakenCar: PublisherCarRef;
  newPosition: number;
  lap: number;
  /** Fraction of lap where pass occurred — iRacing: CarIdxLapDistPct */
  lapDistPct: number;
  /** Class position of the overtaking car after the pass. */
  classPosition: number;
  /** Overall position being contested (== newPosition). */
  forPosition: number;
  /** Gap to the new car immediately ahead after the pass (CarIdxF2Time). */
  gapAfterSec: number;
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
  /** Perspective: 'engager' when envelope.car === chaser; 'engaged' when envelope.car === leader. */
  role: 'engager' | 'engaged';
  /** Overall position being contested (position of the leader car). */
  forPosition: number;
  /** Duration of the battle in seconds from ENGAGED to BROKEN. Present on BATTLE_BROKEN only. */
  durationSec?: number;
}

export interface TrafficPayload {
  distanceMeters: number;
  /** Self-describing ref for the lapped car — populated on LAPPED_TRAFFIC_AHEAD only. */
  lappedCar?: PublisherCarRef;
  /** Self-describing ref for the lapping car — populated on BEING_LAPPED only. */
  lappingCar?: PublisherCarRef;
  /** Edge discriminator. 'entered' on initial proximity; 'exited' on hysteresis release. */
  state?: 'entered' | 'exited';
  /** 'edge' for the rising/falling edge, 'refresh' for periodic re-emission. Consumers
   *  can safely ignore events with kind === 'refresh' if RU cost is a concern. */
  kind?: 'edge' | 'refresh';
}

export interface StoppedOnTrackPayload {
  lapDistPct: number;
  stoppedDurationSec: number;
  /** Edge discriminator. 'entered' when the car first stops; 'exited' when it starts moving. */
  state?: 'entered' | 'exited';
  /** 'edge' for the transition, 'refresh' for a periodic reminder while still stopped. */
  kind?: 'edge' | 'refresh';
}

// §5 Pit & strategy

export interface PitEntryPayload {
  entryLap: number;
  position: number;
  gapToLeaderSec: number;
  /** Gap to the car immediately ahead at the moment of pit entry. */
  gapToCarAheadSec?: number;
  /** Gap from the car immediately behind at the moment of pit entry. */
  gapToCarBehindSec?: number;
  carAhead?: PublisherCarRef;
  carBehind?: PublisherCarRef;
  /** Race condition at entry (from SessionFlags). */
  stopType: 'green' | 'sc' | 'red' | 'unknown';
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

/** PIT_STATIONARY — car is stationary in the pit stall (trackSurface === 2). */
export interface PitStationaryPayload {
  /** SessionTime when the car arrived in the stall. */
  arrivalSessionTime: number;
  /** FuelLevel at stall arrival (player car only — 0 for other cars). */
  fuelLevelOnEntry: number;
}

/** PIT_STOP_COMPLETED — car is leaving the pit stall after service. */
export interface PitStopCompletedPayload {
  /** Milliseconds the car was stationary in the stall. */
  stationaryMs: number;
  /** Race condition at entry. */
  stopType: 'green' | 'sc' | 'red' | 'unknown';
  /** Fuel added in litres (player car only — 0 for other cars). */
  fuelAdded: number;
  /** Whether tires were changed (player car only — false for other cars). */
  tiresChanged: boolean;
  /** CarIdxPosition at stall exit. */
  exitPosition: number;
  /** Gap (seconds) to the car immediately ahead at stall exit. */
  deltaVsCarAheadSec?: number;
}

export interface PitExitPayload {
  exitLap: number;
  newPosition: number;
  positionsLost: number;
  /** Gap (seconds) to the car that was immediately ahead at pit entry. */
  deltaVsPreviousNeighbourSec?: number;
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

/**
 * INCIDENT — session-wide incident for any car (#196).
 *
 * Emitted by the session-publisher incident detector on:
 *   - any car going off-track (trackSurface === -1 edge)
 *   - kinematic discontinuity consistent with loss-of-control / spin
 *   - two-car proximity contact (both show kinematic discontinuity)
 *
 * For the player car, also emitted as a companion to INCIDENT_POINT
 * with severity derived from the incident-point delta.
 */
export interface IncidentPayload {
  severity: 'light' | 'moderate' | 'severe';
  type: 'OFF_TRACK' | 'CONTACT' | 'LOSS_OF_CONTROL' | 'SPIN';
  lap: number;
  /** Fraction along the lap (0.0–1.0). */
  lapDistPct: number;
  /** Approximate track sector (0–2) derived from lapDistPct. */
  sector: 0 | 1 | 2;
  /** iRacing CarIdxTrackSurface enum value at the trigger frame. */
  trackSurface: number;
  /** Other car involved when type === 'CONTACT'. */
  otherCar?: PublisherCarRef;
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
  'CONTACT_DETECTED',
  'BEING_PASSED_WHILE_STOPPED',
  'SAFETY_CAR_IMMINENT',
  'RACE_GREEN',
  'RACE_CHECKERED',
  'FLAG_RED',
  'FLAG_YELLOW_FULL_COURSE',
  'INCIDENT_LIMIT_WARNING',
  'INCIDENT',
  'PIT_ENTRY',
  'PIT_EXIT',
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

/**
 * CONTACT_DETECTED — physical contact / hard hit on the player car (#180).
 *
 * Triggered on threshold edges of LatAccel / LongAccel / VertAccel / YawRate
 * and resolved over a 1-second window during which peaks are tracked and the
 * post-impact speed drop is measured to compute severity.
 *
 * `cause === 'car_contact'` only when another car was within proximity in the
 * trigger frame or the previous 2 frames; otherwise `'solo_incident'`.
 */
export interface ContactDetectedPayload {
  cause: 'car_contact' | 'solo_incident';
  /** Populated only when cause === 'car_contact'. */
  contactCar?: PublisherCarRef;
  severity: 'light' | 'moderate' | 'severe';
  /** Peak |LatAccel| observed during the resolution window (m/s²). */
  peakLatAccel: number;
  /** Peak |LongAccel| observed during the resolution window (m/s²). */
  peakLongAccel: number;
  /** Peak |VertAccel| observed during the resolution window (m/s²). */
  peakVertAccel: number;
  /** Peak |YawRate| observed during the resolution window (rad/s). */
  peakYawRate: number;
  /** Player speed (m/s) on the frame before the trigger. */
  speedBeforeMps: number;
  /** Player speed (m/s) at the end of the 1-second resolution window. */
  speedAfterMps: number;
  /** iRacing CarIdxTrackSurface enum value at trigger. */
  trackSurface: number;
  /** Lap fraction (0.0–1.0) at trigger. */
  lapDistPct: number;
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

  // Derived metrics (#182) — continuous rolling-window scores describing
  // how the driver is doing in human terms. Optional for forward-compat with
  // older snapshot consumers.
  derived?: DerivedMetrics;
}

// ---------------------------------------------------------------------------
// §12 Derived metrics (#182)
// ---------------------------------------------------------------------------

/**
 * Coarse phase of the player's race arc — rule-based on race progress and
 * recent events. Sampled by DRIVER_STATE_SNAPSHOT.
 */
export type NarrativeArc =
  | 'opening'
  | 'building'
  | 'climax'
  | 'recovery'
  | 'cruise'
  | 'endgame';

/**
 * Continuous derived metrics on `DriverState`. Recomputed every frame by
 * `derived-metrics-aggregator.ts`. All scores are normalised 0–1 except
 * `recentLapPace` (seconds) and `paceTrend` (seconds-per-lap).
 */
export interface DerivedMetrics {
  /** Median of the last 5 stint lap times in seconds (0 = no data). */
  recentLapPace: number;
  /** Linear-fit slope of the last 5 lap times (sec/lap; positive = slowing, 0 = no data). */
  paceTrend: number;
  /** 0–1 — exponential-decay weighted recent incident pressure (60 s window). */
  incidentIntensity: number;
  /** 0–1 — max closeness of car ahead/behind, where closeness=1 at ≤0 s gap, 0 at ≥3 s. */
  competitiveFocus: number;
  /** 0–1 — weighted blend of incident, focus, low-fuel, tyre-wear pressure. */
  raceStress: number;
  /** 0–1 — lap-time consistency (1 = perfectly consistent). */
  consistencyScore: number;
  /** 0–1 — rolling avg of throttle+brake change rate (input volatility). */
  aggressionScore: number;
  /** Rule-based race phase / narrative arc. */
  narrativeArc: NarrativeArc;
}

// ---------------------------------------------------------------------------
// §11 Composite events (#181)
// ---------------------------------------------------------------------------

/**
 * BEING_PASSED_WHILE_STOPPED — composite of OVERALL_POSITION_LOSS while the
 * player is stopped (`DriverState.isStoppedBySpeed === true`). Fires once per
 * overtake; `positionsLostThisStop` is a running counter for the current stop
 * episode and resets when the player resumes movement.
 */
export interface BeingPassedWhileStoppedPayload {
  overtakingCar: PublisherCarRef;
  /** Running counter of positions lost during the current stop (resets on resume). */
  positionsLostThisStop: number;
  /** Seconds the player has been stopped at the moment of this overtake. */
  secondsStopped: number;
  /** iRacing CarIdxTrackSurface enum value for the player car. */
  trackSurface: number;
}

/**
 * RECOVERY_DRIVE — fires once when the player has climbed at least 2 overall
 * positions within 60s of one of the trigger events
 * (PLAYER_STOPPED, OFF_TRACK, CONTACT_DETECTED).
 *
 * NOTE: spec #181 lists `STOPPED_ON_TRACK` as a trigger; that event is
 * emitted by the session publisher and is not currently captured in
 * `DriverState.recentEvents`. We use the player-specific `PLAYER_STOPPED`
 * event instead — same semantics for the player car.
 */
export interface RecoveryDrivePayload {
  triggerEvent: 'PLAYER_STOPPED' | 'OFF_TRACK' | 'CONTACT_DETECTED';
  positionsRecovered: number;
  recoveryDurationSec: number;
  startPosition: number;
  currentPosition: number;
}

/**
 * SAFETY_CAR_IMMINENT — session-publisher composite that predicts a yellow
 * flag from a cluster of STOPPED_ON_TRACK events:
 *   - ≥ 3 stopped cars within `windowSec` (30s), OR
 *   - ≥ 2 stopped cars in the same sector (lapDistPct thirds).
 *
 * Sectors are derived from `lapDistPct`: sector = floor(lapDistPct * 3) → 0|1|2.
 */
export interface SafetyCarImminentPayload {
  stoppedCarCount: number;
  /** Length of the rolling window evaluated, in seconds. */
  windowSec: number;
  /** Sectors (0|1|2) containing at least one of the stopped cars. */
  affectedSectors: number[];
  /** Refs for every stopped car contributing to the trigger. */
  affectedCars: PublisherCarRef[];
}

// ---------------------------------------------------------------------------
// §12 Enricher meta-events (#183)
// ---------------------------------------------------------------------------

/** Severity classification for enricher meta-events. */
export type EnricherSeverity = 'minor' | 'major' | 'race-defining';

/**
 * Provider/model attribution attached to every meta-event for observability.
 * `provider='disabled'` is reserved — the disabled provider never emits.
 */
export interface EnricherLlmMeta {
  provider: 'openai' | 'azure-openai' | 'ollama' | 'mock';
  model: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
}

/**
 * INCIDENT_SUMMARY — clusters 3+ incident-weight events (OFF_TRACK,
 * CONTACT_DETECTED, PLAYER_STOPPED, BIG_HIT, SPIN_DETECTED) within a 10s
 * sliding window into one narrative beat.
 */
export interface IncidentSummaryPayload {
  startTime: number;
  endTime: number;
  involvedCars: PublisherCarRef[];
  rawEventTypes: PublisherEventType[];
  /** 2–3 sentence human description from the LLM. */
  llmNarrative: string;
  /** ≤ 60 char headline from the LLM. */
  llmHeadline: string;
  severity: EnricherSeverity;
  /** 0–1 self-rated confidence from the LLM. */
  confidence: number;
  /** Provider attribution + cost metadata. */
  llm: EnricherLlmMeta;
}

/**
 * BATTLE_SUMMARY — emitted when a sustained 30s window of high
 * `competitiveFocus` (> 0.7) ends. Captures the on-track battle as a beat.
 */
export interface BattleSummaryPayload {
  startTime: number;
  endTime: number;
  involvedCars: PublisherCarRef[];
  rawEventTypes: PublisherEventType[];
  llmNarrative: string;
  llmHeadline: string;
  severity: EnricherSeverity;
  confidence: number;
  llm: EnricherLlmMeta;
}

/**
 * STINT_SUMMARY — emitted on PIT_ENTRY (stint boundary). Covers every event
 * of the stint that just ended.
 */
export interface StintSummaryPayload {
  startTime: number;
  endTime: number;
  involvedCars: PublisherCarRef[];
  rawEventTypes: PublisherEventType[];
  llmNarrative: string;
  llmHeadline: string;
  severity: EnricherSeverity;
  confidence: number;
  llm: EnricherLlmMeta;
}

