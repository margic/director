/**
 * narrative-polish-detector.ts — Issue #156
 *
 * Bundles four small player-scoped detectors into one module to keep the
 * orchestrator wiring simple. Each detector has its own export and tests.
 *
 *   - PACE_DROP             — 2 consecutive laps ≥ 1.5% slower than stint best
 *   - SECTOR_PERSONAL_BEST  — LapDeltaToBestLap crosses < 0 at a sector boundary
 *   - TYRE_TEMP_DRIFT       — any tyre middle temp rises > 15 °C above 5-sample baseline
 *   - ENGINE_WARNING        — EngineWarnings bitmask change
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { buildEvent, carRefFromRoster, getOrCreateCarState } from '../session-state';
import type { PublisherEvent, TyreId } from '../event-types';

export const PACE_DROP_THRESHOLD_PCT = 0.015; // 1.5 %
export const TYRE_TEMP_DRIFT_DELTA_C = 15;
export const TYRE_TEMP_DRIFT_BASELINE_SIZE = 5;
export const TYRE_TEMP_DRIFT_COOLDOWN_SEC = 60;
export const SECTOR_BOUNDARIES = [0.333, 0.667];

let unsetPlayerCarIdxWarned = false;

export interface NarrativePolishContext {
  rigId: string;
  raceSessionId: string;
  playerCarIdx: number;
}

export function detectNarrativePolish(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: NarrativePolishContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  if (ctx.playerCarIdx < 0) {
    if (!unsetPlayerCarIdxWarned) {
      unsetPlayerCarIdxWarned = true;
      // eslint-disable-next-line no-console
      console.warn('[narrative-polish-detector] playerCarIdx unset; skipping');
    }
    return events;
  }
  if (prev === null) return events;

  events.push(...detectPaceDrop(prev, curr, state, ctx));
  events.push(...detectSectorPersonalBest(prev, curr, state, ctx));
  events.push(...detectTyreTempDrift(prev, curr, state, ctx));
  events.push(...detectEngineWarning(prev, curr, state, ctx));
  return events;
}

// ---------------------------------------------------------------------------

export function detectPaceDrop(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: NarrativePolishContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  if (!prev) return events;
  const cs = getOrCreateCarState(state, ctx.playerCarIdx);
  if (cs.inPitWindow) return events;
  if (cs.stintBestLapTime <= 0) return events;
  if (cs.stintLapTimes.length < 2) return events;
  if (state.paceDropFired) return events;

  const lastTwo = cs.stintLapTimes.slice(-2);
  const slowestPct = Math.max(...lastTwo.map((t) => (t - cs.stintBestLapTime) / cs.stintBestLapTime));
  const allOver = lastTwo.every((t) => (t - cs.stintBestLapTime) / cs.stintBestLapTime >= PACE_DROP_THRESHOLD_PCT);
  if (!allOver) return events;

  const playerRef = carRefFromRoster(state, ctx.playerCarIdx);
  if (!playerRef) return events;
  events.push(buildEvent(
    'PACE_DROP',
    playerRef,
    { deltaPct: round4(slowestPct), lapTimes: lastTwo.map((t) => round3(t)), stintBestSec: round3(cs.stintBestLapTime) },
    { raceSessionId: ctx.raceSessionId, rigId: ctx.rigId, frame: curr },
  ));
  state.paceDropFired = true;
  return events;
}

// ---------------------------------------------------------------------------

export function detectSectorPersonalBest(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: NarrativePolishContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  if (!prev) return events;
  if (curr.lapDeltaToBestLapOk === 0) return events;
  if (curr.lapDeltaToBestLap >= 0) return events; // not improving
  if (prev.lapDeltaToBestLap >= 0) {
    // Just crossed below zero — qualifies as a sector PB.
  } else {
    return events;
  }
  const lapDist = curr.carIdxLapDistPct[ctx.playerCarIdx];
  const sector: 1 | 2 | 3 = lapDist < SECTOR_BOUNDARIES[0] ? 1 : lapDist < SECTOR_BOUNDARIES[1] ? 2 : 3;
  const lap = curr.carIdxLapCompleted[ctx.playerCarIdx];

  if (state.sectorPersonalBestLastLap === lap && state.sectorPersonalBestLastSector === sector) {
    return events;
  }
  const playerRef = carRefFromRoster(state, ctx.playerCarIdx);
  if (!playerRef) return events;
  events.push(buildEvent(
    'SECTOR_PERSONAL_BEST',
    playerRef,
    { sector, deltaSec: round3(Math.abs(curr.lapDeltaToBestLap)) },
    { raceSessionId: ctx.raceSessionId, rigId: ctx.rigId, frame: curr },
  ));
  state.sectorPersonalBestLastSector = sector;
  state.sectorPersonalBestLastLap = lap;
  return events;
}

// ---------------------------------------------------------------------------

export function detectTyreTempDrift(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: NarrativePolishContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  const tyres: Array<{ id: TyreId; temp: number }> = [
    { id: 'LF', temp: curr.lfTempCM },
    { id: 'RF', temp: curr.rfTempCM },
    { id: 'LR', temp: curr.lrTempCM },
    { id: 'RR', temp: curr.rrTempCM },
  ];

  for (const t of tyres) {
    if (t.temp <= 0) continue;
    const baseline = state.tyreTempBaseline[t.id];
    if (baseline.length >= TYRE_TEMP_DRIFT_BASELINE_SIZE) {
      const avg = baseline.reduce((a, b) => a + b, 0) / baseline.length;
      const delta = t.temp - avg;
      if (delta > TYRE_TEMP_DRIFT_DELTA_C) {
        const lastEmit = state.tyreTempDriftLastEmit[t.id];
        if (curr.sessionTime - lastEmit >= TYRE_TEMP_DRIFT_COOLDOWN_SEC) {
          const playerRef = carRefFromRoster(state, ctx.playerCarIdx);
          if (playerRef) {
            events.push(buildEvent(
              'TYRE_TEMP_DRIFT',
              playerRef,
              { tyre: t.id, tempC: round1(t.temp), baselineC: round1(avg), deltaC: round1(delta) },
              { raceSessionId: ctx.raceSessionId, rigId: ctx.rigId, frame: curr },
            ));
            state.tyreTempDriftLastEmit[t.id] = curr.sessionTime;
          }
        }
      }
    }
    // Update rolling baseline AFTER comparing — keeps detection responsive.
    baseline.push(t.temp);
    while (baseline.length > TYRE_TEMP_DRIFT_BASELINE_SIZE) baseline.shift();
  }
  return events;
}

// ---------------------------------------------------------------------------

const ENGINE_WARNING_FLAGS: Array<{ bit: number; name: string }> = [
  { bit: 0x01, name: 'WaterTempWarning' },
  { bit: 0x02, name: 'FuelPressureWarning' },
  { bit: 0x04, name: 'OilPressureWarning' },
  { bit: 0x08, name: 'EngineStalled' },
  { bit: 0x10, name: 'PitSpeedLimiter' },
  { bit: 0x20, name: 'RevLimiterActive' },
  { bit: 0x40, name: 'OilTempWarning' },
];

export function detectEngineWarning(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: NarrativePolishContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  const flags = curr.engineWarnings;
  if (flags === state.lastEngineWarnings) return events;
  // Only emit on transitions that ADD a warning (clearing is not a story).
  const newlySet = flags & ~state.lastEngineWarnings;
  state.lastEngineWarnings = flags;
  if (newlySet === 0) return events;
  const names = ENGINE_WARNING_FLAGS.filter((f) => (newlySet & f.bit) !== 0).map((f) => f.name);
  if (names.length === 0) return events;
  const playerRef = carRefFromRoster(state, ctx.playerCarIdx);
  if (!playerRef) return events;
  events.push(buildEvent(
    'ENGINE_WARNING',
    playerRef,
    { warningFlags: flags, warningNames: names },
    { raceSessionId: ctx.raceSessionId, rigId: ctx.rigId, frame: curr },
  ));
  return events;
}

// ---------------------------------------------------------------------------

function round1(n: number): number { return Math.round(n * 10) / 10; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }
