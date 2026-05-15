/**
 * safety-car-imminent-detector.ts — Issue #181
 *
 * Predicts a full-course caution from a cluster of recent STOPPED_ON_TRACK
 * events. Operates on a rolling SAFETY_CAR_WINDOW_SEC (30 s) window held on
 * `SessionState.recentStoppedOnTrackEvents`.
 *
 * Triggers (whichever comes first):
 *   - ≥ SAFETY_CAR_MIN_STOPPED_COUNT (3) stopped cars in the window, OR
 *   - ≥ SAFETY_CAR_MIN_STOPPED_PER_SECTOR (2) stopped cars in the same sector.
 *
 * Sectors are derived from `lapDistPct` (0.0–1.0):
 *   sector = floor(lapDistPct * 3) clamped to [0, 2]   →  thirds of the lap.
 *
 * Debounced: after emission, suppresses repeats for SAFETY_CAR_COOLDOWN_SEC.
 *
 * Detector ordering: must run AFTER detectOvertakeAndBattle so STOPPED_ON_TRACK
 * events emitted this tick are visible in `emittedThisTick`.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { buildEvent, carRefFromRoster } from '../session-state';
import type {
  PublisherEvent,
  SafetyCarImminentPayload,
  StoppedOnTrackPayload,
  PublisherCarRef,
} from '../event-types';

export const SAFETY_CAR_WINDOW_SEC = 30;
export const SAFETY_CAR_MIN_STOPPED_COUNT = 3;
export const SAFETY_CAR_MIN_STOPPED_PER_SECTOR = 2;
export const SAFETY_CAR_COOLDOWN_SEC = 30;

export interface SafetyCarImminentContext {
  rigId: string;
  raceSessionId: string;
  emittedThisTick: PublisherEvent[];
}

/** Public for tests. */
export function lapDistPctToSector(lapDistPct: number): number {
  if (!Number.isFinite(lapDistPct)) return 0;
  const wrapped = ((lapDistPct % 1) + 1) % 1; // [0,1)
  const s = Math.floor(wrapped * 3);
  return s < 0 ? 0 : s > 2 ? 2 : s;
}

export function detectSafetyCarImminent(
  _prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: SafetyCarImminentContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  const now = curr.sessionTime;

  // ---- Ingest this tick's STOPPED_ON_TRACK events ----
  for (const ev of ctx.emittedThisTick) {
    if (ev.type !== 'STOPPED_ON_TRACK') continue;
    const p = ev.payload as StoppedOnTrackPayload;
    state.recentStoppedOnTrackEvents.push({
      sessionTime: now,
      carIdx:      ev.car.carIdx,
      lapDistPct:  p.lapDistPct,
    });
  }

  // ---- Prune entries older than the rolling window ----
  const cutoff = now - SAFETY_CAR_WINDOW_SEC;
  while (
    state.recentStoppedOnTrackEvents.length > 0 &&
    state.recentStoppedOnTrackEvents[0].sessionTime < cutoff
  ) {
    state.recentStoppedOnTrackEvents.shift();
  }

  // Cooldown gate.
  if (now - state.lastSafetyCarImminentEmittedAt < SAFETY_CAR_COOLDOWN_SEC) {
    return events;
  }

  const recent = state.recentStoppedOnTrackEvents;
  if (recent.length === 0) return events;

  // De-duplicate by carIdx — multiple ingestions for the same car shouldn't
  // be counted separately.
  const uniqueByCar = new Map<number, { lapDistPct: number; sessionTime: number }>();
  for (const e of recent) {
    if (!uniqueByCar.has(e.carIdx)) {
      uniqueByCar.set(e.carIdx, { lapDistPct: e.lapDistPct, sessionTime: e.sessionTime });
    }
  }

  const stoppedCarCount = uniqueByCar.size;

  // Sector tally for the per-sector trigger.
  const carIdxBySector = new Map<number, number[]>();
  for (const [carIdx, info] of uniqueByCar.entries()) {
    const s = lapDistPctToSector(info.lapDistPct);
    const list = carIdxBySector.get(s) ?? [];
    list.push(carIdx);
    carIdxBySector.set(s, list);
  }

  let perSectorClusterFound = false;
  for (const list of carIdxBySector.values()) {
    if (list.length >= SAFETY_CAR_MIN_STOPPED_PER_SECTOR) {
      perSectorClusterFound = true;
      break;
    }
  }

  const totalTrigger = stoppedCarCount >= SAFETY_CAR_MIN_STOPPED_COUNT;
  if (!totalTrigger && !perSectorClusterFound) return events;

  // ---- Build payload ----
  const affectedSectors = Array.from(carIdxBySector.keys()).sort((a, b) => a - b);
  const affectedCars: PublisherCarRef[] = [];
  for (const carIdx of uniqueByCar.keys()) {
    const ref = carRefFromRoster(state, carIdx);
    if (ref) affectedCars.push(ref);
    else affectedCars.push({ carIdx });
  }

  // The event needs a `car` envelope — use the first affected car.
  const envelope = affectedCars[0] ?? { carIdx: -1 };

  const payload: SafetyCarImminentPayload = {
    stoppedCarCount,
    windowSec: SAFETY_CAR_WINDOW_SEC,
    affectedSectors,
    affectedCars,
  };

  events.push(buildEvent('SAFETY_CAR_IMMINENT', envelope, payload, {
    raceSessionId: ctx.raceSessionId,
    rigId:         ctx.rigId,
    frame:         curr,
  }));
  state.lastSafetyCarImminentEmittedAt = now;

  return events;
}
