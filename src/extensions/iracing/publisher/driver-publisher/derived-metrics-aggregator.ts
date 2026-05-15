/**
 * derived-metrics-aggregator.ts — Issue #182
 *
 * Computes the continuous `DerivedMetrics` block on `DriverState` every frame.
 * Pure, fully unit-testable, no event emission.
 *
 * Wired into the orchestrator BEFORE detectors so detectors and the snapshot
 * emitter both see the freshest derived block.
 *
 * Metric definitions (spec #182):
 *   - recentLapPace      : median of last 5 stint lap times (sec; 0 = no data)
 *   - paceTrend          : linear-fit slope of last 5 lap times (sec/lap)
 *   - incidentIntensity  : exp-decay of incident weights over 60 s
 *                          weights: OFF_TRACK 0.3, CONTACT_DETECTED 0.6,
 *                                   PLAYER_STOPPED 0.9
 *   - competitiveFocus   : max(closeness ahead, closeness behind);
 *                          closeness = 1 - clamp(gapSec/3, 0, 1)
 *   - raceStress         : 0.4*incidentIntensity + 0.3*competitiveFocus
 *                        + 0.2*lowFuel + 0.1*tyreWear
 *                          lowFuel  = 1 - clamp(fuelLevelPct/0.20, 0, 1)
 *                          tyreWear = 1 - mean(min wear/tyre across LF/RF/LR/RR)
 *   - consistencyScore   : 1 - clamp(stdDev(last5Laps)/0.5, 0, 1)
 *   - aggressionScore    : rolling avg of |Δthrottle| + |Δbrake| (last 30 samples)
 *   - narrativeArc       : rule-based, see deriveNarrativeArc()
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { getOrCreateCarState } from '../session-state';
import type { DriverState } from '../driver-state';
import { INPUT_SAMPLE_CAPACITY, INCIDENT_INTENSITY_WINDOW_SEC } from '../driver-state';
import type { NarrativeArc, DerivedMetrics, PublisherEvent } from '../event-types';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

export const COMPETITIVE_FOCUS_FULL_GAP_SEC = 3;
export const LOW_FUEL_PCT_FULL_STRESS = 0.20;
export const CONSISTENCY_DEGRADATION_SEC = 0.5;

export const INCIDENT_WEIGHTS: Readonly<Record<string, number>> = {
  OFF_TRACK:        0.3,
  CONTACT_DETECTED: 0.6,
  PLAYER_STOPPED:   0.9,
};

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export interface DerivedMetricsContext {
  playerCarIdx: number;
  /**
   * Optional override for incident scanning — defaults to scanning
   * `driverState.recentEvents` (populated by the previous tick) and ingesting
   * each event whose sessionTime is greater than the high-water mark held in
   * `driverState.recentIncidents`. Tests may also push directly into
   * `driverState.recentIncidents`.
   */
  incidentEventsOverride?: readonly PublisherEvent[];
}

/**
 * Recompute the derived block on `driverState`. Mutates rolling buffers and
 * the `derived` field in place; returns the same `derived` object for caller
 * convenience.
 */
export function computeDerivedMetrics(
  _prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  driverState: DriverState,
  ctx: DerivedMetricsContext,
): DerivedMetrics {
  if (ctx.playerCarIdx < 0) return driverState.derived;

  // ---- Update rolling input buffers ----
  pushSample(driverState.throttleSamples, clamp01(curr.throttle ?? 0), INPUT_SAMPLE_CAPACITY);
  pushSample(driverState.brakeSamples,    clamp01(curr.brake    ?? 0), INPUT_SAMPLE_CAPACITY);

  // ---- Ingest fresh incident events into the rolling list ----
  const eventSource = ctx.incidentEventsOverride ?? driverState.recentEvents;
  const hwm = driverState.recentIncidents.length > 0
    ? driverState.recentIncidents[driverState.recentIncidents.length - 1].sessionTime
    : -Infinity;
  for (const ev of eventSource) {
    if (ev.car.carIdx !== ctx.playerCarIdx) continue;
    if (ev.sessionTime <= hwm) continue;
    const w = INCIDENT_WEIGHTS[ev.type as string];
    if (w === undefined) continue;
    driverState.recentIncidents.push({ sessionTime: ev.sessionTime, weight: w });
  }
  pruneIncidents(driverState.recentIncidents, curr.sessionTime);

  const cs = getOrCreateCarState(state, ctx.playerCarIdx);
  const recentLaps = cs.stintLapTimes.slice(-5);

  const recentLapPace     = computeMedian(recentLaps);
  const paceTrend         = computePaceTrend(recentLaps);
  const consistencyScore  = computeConsistencyScore(recentLaps);
  const incidentIntensity = computeIncidentIntensity(driverState.recentIncidents, curr.sessionTime);
  const competitiveFocus  = computeCompetitiveFocus(curr, state, ctx.playerCarIdx);
  const aggressionScore   = computeAggressionScore(driverState.throttleSamples, driverState.brakeSamples);
  const lowFuelStress     = computeLowFuelStress(curr.fuelLevelPct);
  const tyreWearStress    = computeTyreWearStress(curr);
  const raceStress        = clamp01(
    0.4 * incidentIntensity +
    0.3 * competitiveFocus  +
    0.2 * lowFuelStress     +
    0.1 * tyreWearStress,
  );
  const narrativeArc      = deriveNarrativeArc({
    racePhase:         state.racePhase,
    incidentIntensity,
    competitiveFocus,
    raceStress,
    paceTrend,
  });

  driverState.derived = {
    recentLapPace,
    paceTrend,
    incidentIntensity,
    competitiveFocus,
    raceStress,
    consistencyScore,
    aggressionScore,
    narrativeArc,
  };

  return driverState.derived;
}

// ---------------------------------------------------------------------------
// Per-metric helpers (exported for direct unit tests)
// ---------------------------------------------------------------------------

export function computeMedian(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Linear-fit slope (least squares) over the index axis. Returns sec/lap. */
export function computePaceTrend(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX  += i;
    sumY  += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

export function computeConsistencyScore(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  return 1 - clamp01(stdDev / CONSISTENCY_DEGRADATION_SEC);
}

export function computeIncidentIntensity(
  incidents: readonly { sessionTime: number; weight: number }[],
  now: number,
): number {
  if (incidents.length === 0) return 0;
  let acc = 0;
  for (const inc of incidents) {
    const age = now - inc.sessionTime;
    if (age < 0 || age > INCIDENT_INTENSITY_WINDOW_SEC) continue;
    // Exponential decay: at 60 s, e^-1 ≈ 0.37.
    const decay = Math.exp(-age / INCIDENT_INTENSITY_WINDOW_SEC);
    acc += inc.weight * decay;
  }
  return clamp01(acc);
}

export function computeCompetitiveFocus(
  frame: TelemetryFrame,
  state: SessionState,
  playerCarIdx: number,
): number {
  const cs = state.carStates.get(playerCarIdx);
  // Gap ahead — F2Time when valid, else last value from rolling buffer.
  let gapAhead = frame.carIdxF2Time?.[playerCarIdx] ?? 0;
  if (!Number.isFinite(gapAhead) || gapAhead <= 0) {
    const buf = cs?.recentGapToAhead ?? [];
    gapAhead = buf.length > 0 ? buf[buf.length - 1] : Infinity;
  }
  const gapBehindBuf = cs?.recentGapToBehind ?? [];
  const gapBehind = gapBehindBuf.length > 0 ? gapBehindBuf[gapBehindBuf.length - 1] : Infinity;

  const closenessAhead  = closenessFromGap(gapAhead);
  const closenessBehind = closenessFromGap(gapBehind);
  return Math.max(closenessAhead, closenessBehind);
}

export function closenessFromGap(gapSec: number): number {
  if (!Number.isFinite(gapSec) || gapSec <= 0) return 0;
  return 1 - clamp01(gapSec / COMPETITIVE_FOCUS_FULL_GAP_SEC);
}

export function computeAggressionScore(
  throttleSamples: readonly number[],
  brakeSamples: readonly number[],
): number {
  const tRate = meanAbsDelta(throttleSamples);
  const bRate = meanAbsDelta(brakeSamples);
  // |Δthrottle|+|Δbrake| each in [0,1]; sum can theoretically reach 2 — clamp.
  return clamp01(tRate + bRate);
}

export function computeLowFuelStress(fuelLevelPct: number | undefined): number {
  const pct = Number.isFinite(fuelLevelPct) ? (fuelLevelPct as number) : 1;
  if (pct >= LOW_FUEL_PCT_FULL_STRESS) return 0;
  if (pct <= 0) return 1;
  return 1 - pct / LOW_FUEL_PCT_FULL_STRESS;
}

export function computeTyreWearStress(frame: TelemetryFrame): number {
  // Per-tyre wear is reported as 1.0 = new, 0.0 = bald in the L/M/R buckets.
  // Use the worst (lowest) of the three measurements per tyre, then average.
  const lf = minOrOne(frame.lfWearL, frame.lfWearM, frame.lfWearR);
  const rf = minOrOne(frame.rfWearL, frame.rfWearM, frame.rfWearR);
  const lr = minOrOne(frame.lrWearL, frame.lrWearM, frame.lrWearR);
  const rr = minOrOne(frame.rrWearL, frame.rrWearM, frame.rrWearR);
  const meanRemaining = (lf + rf + lr + rr) / 4;
  return clamp01(1 - meanRemaining);
}

export interface NarrativeArcInputs {
  racePhase: SessionState['racePhase'];
  incidentIntensity: number;
  competitiveFocus: number;
  raceStress: number;
  paceTrend: number;
}

/**
 * Rule-based narrative arc derivation:
 *   - racePhase 'opening'    → 'opening'
 *   - racePhase 'final-laps' → 'endgame'
 *   - else if recovering from very recent incidents (intensity > 0.5
 *     and no longer rising)             → 'recovery'
 *   - else if raceStress > 0.7          → 'climax'
 *   - else if competitiveFocus > 0.5    → 'building'
 *   - else                              → 'cruise'
 */
export function deriveNarrativeArc(inputs: NarrativeArcInputs): NarrativeArc {
  if (inputs.racePhase === 'opening')    return 'opening';
  if (inputs.racePhase === 'final-laps') return 'endgame';
  if (inputs.incidentIntensity > 0.5)    return 'recovery';
  if (inputs.raceStress       > 0.7)     return 'climax';
  if (inputs.competitiveFocus > 0.5)     return 'building';
  return 'cruise';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function pushSample(buf: number[], value: number, cap: number): void {
  buf.push(value);
  while (buf.length > cap) buf.shift();
}

function pruneIncidents(
  buf: { sessionTime: number; weight: number }[],
  now: number,
): void {
  const cutoff = now - INCIDENT_INTENSITY_WINDOW_SEC;
  while (buf.length > 0 && buf[0].sessionTime < cutoff) buf.shift();
}

function meanAbsDelta(samples: readonly number[]): number {
  if (samples.length < 2) return 0;
  let acc = 0;
  for (let i = 1; i < samples.length; i++) {
    acc += Math.abs(samples[i] - samples[i - 1]);
  }
  return acc / (samples.length - 1);
}

function minOrOne(...vals: Array<number | undefined>): number {
  let m = Infinity;
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (v < m) m = v;
    }
  }
  return Number.isFinite(m) ? m : 1;
}
