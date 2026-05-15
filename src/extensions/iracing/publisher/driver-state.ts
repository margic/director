/**
 * driver-state.ts — Issue #177
 *
 * DriverState — player-scoped mutable state owned exclusively by
 * DriverPublisherOrchestrator and passed as an explicit parameter to all
 * driver-publisher detectors.
 *
 * Motivation: previously these fields were scattered across CarState and
 * SessionState, making it impossible for the TypeScript compiler to enforce
 * that session-publisher detectors cannot accidentally read player-only state.
 * By extracting them into a dedicated interface the type boundary is explicit:
 *
 *   Session-publisher detectors: (prev, curr, state: SessionState, ctx) => events
 *   Driver-publisher detectors:  (prev, curr, state: SessionState, driverState: DriverState, ctx) => events
 *
 * Only the DriverPublisherOrchestrator creates and owns a DriverState instance.
 */

import type { PublisherEvent } from './event-types';
import type { PublisherCarRef } from './event-types';

/** Maximum number of recent events retained on DriverState. */
export const RECENT_EVENTS_CAPACITY = 50;

/** Number of frames retained in the contact-proximity ring (#180). */
export const CONTACT_PROXIMITY_RING_CAPACITY = 3;

// ---------------------------------------------------------------------------
// Pending-contact resolution state (#180)
// ---------------------------------------------------------------------------

/**
 * Captures the in-flight resolution of a CONTACT_DETECTED trigger. Held on
 * DriverState while the 1-second post-impact window elapses; cleared when the
 * event is finalised and emitted.
 */
export interface PendingContactState {
  startSessionTime: number;
  startTick: number;
  speedBefore: number;
  peakLatAccel: number;
  peakLongAccel: number;
  peakVertAccel: number;
  peakYawRate: number;
  /** Frames during the window where |yawRate| > π rad/s — feeds severe-spin escalation. */
  yawSustainedFrames: number;
  cause: 'car_contact' | 'solo_incident';
  contactCar?: PublisherCarRef;
  trackSurface: number;
  lapDistPct: number;
}

// ---------------------------------------------------------------------------
// DriverState — all player-scoped mutable runtime state
// ---------------------------------------------------------------------------

export interface DriverState {
  /** CarIdx of the player car this state belongs to. */
  carIdx: number;

  // ---- Stint / lap performance ----
  /** Monotonically incrementing stint counter; starts at 1, incremented on each DRIVER_SWAP_COMPLETED. */
  stintNumber: number;
  /** Rolling buffer of recent player lap times (seconds) used by LAP_TIME_DEGRADATION. */
  lapTimeBuffer: number[];
  /** Latch — true once LAP_TIME_DEGRADATION has fired in the current stint. */
  degradationFired: boolean;

  // ---- Fuel tracking ----
  /** Estimated fuel consumption per lap in litres (0 until first completion). */
  fuelPerLap: number;
  /** Player FuelLevel at the start of the current lap (litres). */
  fuelAtLapStart: number;
  /** FUEL_LOW thresholds already fired this session (values: 0.10, 0.05). */
  firedFuelLowThresholds: Set<number>;

  // ---- Incident / stint milestones ----
  /** Incident limit thresholds already fired this session (percentages). */
  firedIncidentWarnings: Set<number>;
  /** Stint milestone percents (25 / 50 / 75) already fired this stint. */
  firedStintMilestones: Set<number>;

  // ---- Player-stopped detection ----
  /** SessionTime when player speed first dropped below stopped threshold (null when moving). */
  stoppedBySpeedStartTime: number | null;
  /** Whether the player is currently stopped (speed-based; driver publisher only). */
  isStoppedBySpeed: boolean;

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

  // ---- Physics detector cooldowns (session tick values) ----
  /** Emit SLOW_CAR_AHEAD at most once per this many ticks (~30 s at 60Hz). */
  slowCarAheadCooldownUntilTick: number;
  /** Emit SPIN_DETECTED at most once per this many ticks. */
  spinDetectedCooldownUntilTick: number;
  /** Emit BIG_HIT at most once per this many ticks. */
  bigHitCooldownUntilTick: number;

  // ---- Future use (Issue #179) ----
  /** Bounded ring buffer of recent events emitted from this pipeline (oldest→newest, capped at RECENT_EVENTS_CAPACITY). */
  recentEvents: PublisherEvent[];
  /** sessionTime of the most recent DRIVER_STATE_SNAPSHOT emission (-Infinity = never). */
  lastSnapshotSessionTime: number;

  // ---- Contact detection (#180) ----
  /** In-flight CONTACT_DETECTED resolution; null when not currently resolving. */
  pendingContact: PendingContactState | null;
  /** Tick at which CONTACT_DETECTED may fire again (cooldown after emission). */
  contactDetectedCooldownUntilTick: number;
  /**
   * Rolling ring (capped at CONTACT_PROXIMITY_RING_CAPACITY) of `carIdxLapDistPct`
   * snapshots from recent frames, used to classify `car_contact` vs `solo_incident`
   * by checking whether any other car was nearby on this or the previous 2 frames.
   *
   * NOTE: spec #180 calls for `(carIdx, lat, lon)` ring using per-car Lat/Lon —
   * iRacing only exposes Lat/Lon as scalars for the player car (#178), so this
   * implementation uses `carIdxLapDistPct` as a sensible proximity proxy.
   */
  proximityRing: Float32Array[];

  // ---- Composite events (#181) ----
  /**
   * Running count of overall positions lost during the current stop episode.
   * Reset to 0 whenever `isStoppedBySpeed` transitions true → false.
   */
  positionsLostThisStop: number;
  /**
   * Active recovery state machine. Set when a trigger event
   * (PLAYER_STOPPED | OFF_TRACK | CONTACT_DETECTED) fires; cleared after
   * RECOVERY_DRIVE emits OR after the 60 s window expires without ever
   * climbing ≥ 2 positions.
   */
  recoveryActive: {
    startedAtSessionTime: number;
    startPosition: number;
    trigger: 'PLAYER_STOPPED' | 'OFF_TRACK' | 'CONTACT_DETECTED';
  } | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDriverState(carIdx: number): DriverState {
  return {
    carIdx,
    stintNumber: 1,
    lapTimeBuffer: [],
    degradationFired: false,
    fuelPerLap: 0,
    fuelAtLapStart: 0,
    firedFuelLowThresholds: new Set(),
    firedIncidentWarnings: new Set(),
    firedStintMilestones: new Set(),
    stoppedBySpeedStartTime: null,
    isStoppedBySpeed: false,
    driverSwapPending: false,
    pendingSwapOutgoingDriverId: '',
    pendingSwapIncomingDriverId: '',
    pendingSwapIncomingDriverName: '',
    pendingSwapInitiatedSessionTime: 0,
    slowCarAheadCooldownUntilTick: 0,
    spinDetectedCooldownUntilTick: 0,
    bigHitCooldownUntilTick: 0,
    recentEvents: [],
    lastSnapshotSessionTime: -Infinity,
    pendingContact: null,
    contactDetectedCooldownUntilTick: 0,
    proximityRing: [],
    positionsLostThisStop: 0,
    recoveryActive: null,
  };
}

/**
 * Append an event to the bounded recentEvents ring buffer. Mutates in place.
 * Drops the oldest entry when at capacity. DRIVER_STATE_SNAPSHOT is excluded
 * to avoid recursive noise in subsequent snapshots.
 */
export function pushRecentEvent(state: DriverState, event: PublisherEvent): void {
  if (event.type === 'DRIVER_STATE_SNAPSHOT') return;
  state.recentEvents.push(event);
  while (state.recentEvents.length > RECENT_EVENTS_CAPACITY) {
    state.recentEvents.shift();
  }
}
