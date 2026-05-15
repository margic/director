/**
 * derived-metrics-aggregator.test.ts — Issue #182
 *
 * Validates each individual derived metric on `DriverState.derived` plus the
 * end-to-end aggregator wiring. Pure functions — no orchestrator needed.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDerivedMetrics,
  computeMedian,
  computePaceTrend,
  computeConsistencyScore,
  computeIncidentIntensity,
  computeCompetitiveFocus,
  closenessFromGap,
  computeAggressionScore,
  computeLowFuelStress,
  computeTyreWearStress,
  deriveNarrativeArc,
  INCIDENT_WEIGHTS,
} from '../driver-publisher/derived-metrics-aggregator';
import { createDriverState } from '../driver-state';
import { createSessionState, buildEvent, getOrCreateCarState } from '../session-state';
import { makeFrame, seedRoster, makeDriverState } from './frame-fixtures';
import type { PublisherEvent } from '../event-types';

const PLAYER = 0;

function makeRosteredState() {
  const s = createSessionState('s1', 1);
  seedRoster(s, [PLAYER, 1, 2]);
  return s;
}

function fakeEvent(
  type: PublisherEvent['type'],
  sessionTime: number,
  carIdx = PLAYER,
): PublisherEvent {
  const frame = makeFrame({ sessionTime, cars: [{ carIdx, position: 5 }] });
  return buildEvent(
    type as any,
    { carIdx, carNumber: String(carIdx), driverName: `Driver ${carIdx}` },
    {} as any,
    { raceSessionId: 's1', rigId: 'r1', frame },
  );
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('computeMedian', () => {
  it('returns 0 for empty input', () => {
    expect(computeMedian([])).toBe(0);
  });
  it('handles odd-length samples', () => {
    expect(computeMedian([90, 91, 92])).toBe(91);
  });
  it('handles even-length samples (mean of middle two)', () => {
    expect(computeMedian([90, 91, 92, 93])).toBeCloseTo(91.5, 5);
  });
});

describe('computePaceTrend', () => {
  it('returns 0 when fewer than 2 samples', () => {
    expect(computePaceTrend([])).toBe(0);
    expect(computePaceTrend([90])).toBe(0);
  });
  it('positive slope when laps are slowing', () => {
    expect(computePaceTrend([90, 90.5, 91, 91.5, 92])).toBeCloseTo(0.5, 3);
  });
  it('negative slope when laps are improving', () => {
    expect(computePaceTrend([92, 91.5, 91, 90.5, 90])).toBeCloseTo(-0.5, 3);
  });
  it('near-zero slope for stable laps', () => {
    expect(Math.abs(computePaceTrend([90, 90.01, 89.99, 90, 90.01]))).toBeLessThan(0.01);
  });
});

describe('computeConsistencyScore', () => {
  it('1.0 when laps are identical', () => {
    expect(computeConsistencyScore([90, 90, 90, 90, 90])).toBe(1);
  });
  it('returns 0 when fewer than 2 samples', () => {
    expect(computeConsistencyScore([90])).toBe(0);
  });
  it('drops toward 0 as variance grows', () => {
    const high = computeConsistencyScore([90, 90.05, 90, 89.95, 90]);
    const low  = computeConsistencyScore([90, 91, 89, 92, 88]);
    expect(high).toBeGreaterThan(0.85);
    expect(low).toBeLessThan(high);
    expect(low).toBeGreaterThanOrEqual(0);
  });
});

describe('computeIncidentIntensity', () => {
  it('returns 0 with no incidents', () => {
    expect(computeIncidentIntensity([], 100)).toBe(0);
  });
  it('peaks shortly after a fresh incident', () => {
    const intensity = computeIncidentIntensity(
      [{ sessionTime: 100, weight: 0.9 }],
      101,
    );
    expect(intensity).toBeGreaterThan(0.85);
    expect(intensity).toBeLessThanOrEqual(1);
  });
  it('decays toward zero as time passes', () => {
    const fresh = computeIncidentIntensity([{ sessionTime: 0, weight: 0.9 }], 1);
    const stale = computeIncidentIntensity([{ sessionTime: 0, weight: 0.9 }], 50);
    expect(stale).toBeLessThan(fresh);
  });
  it('clamps to 1 when many incidents stack', () => {
    const incidents = Array.from({ length: 10 }, (_, i) => ({ sessionTime: 100 + i * 0.1, weight: 0.9 }));
    expect(computeIncidentIntensity(incidents, 101)).toBe(1);
  });
});

describe('closenessFromGap', () => {
  it('1.0 when gap is at or below 0', () => {
    expect(closenessFromGap(0)).toBe(0);          // 0 means "no data" by convention
    expect(closenessFromGap(0.0001)).toBeCloseTo(1, 3);
  });
  it('0 when gap exceeds 3 s', () => {
    expect(closenessFromGap(3)).toBe(0);
    expect(closenessFromGap(10)).toBe(0);
  });
  it('linearly interpolates', () => {
    expect(closenessFromGap(1.5)).toBeCloseTo(0.5, 3);
  });
});

describe('computeCompetitiveFocus', () => {
  it('returns 0 when both gaps are unknown', () => {
    const state = makeRosteredState();
    const frame = makeFrame();
    expect(computeCompetitiveFocus(frame, state, PLAYER)).toBe(0);
  });
  it('uses larger of ahead/behind closeness', () => {
    const state = makeRosteredState();
    const cs = getOrCreateCarState(state, PLAYER);
    cs.recentGapToBehind.push(0.5);
    const frame = makeFrame({ cars: [{ carIdx: PLAYER, f2Time: 2.0 }] });
    const focus = computeCompetitiveFocus(frame, state, PLAYER);
    expect(focus).toBeGreaterThan(0.8); // 0.5 s behind ⇒ closeness ≈ 0.83
  });
});

describe('computeAggressionScore', () => {
  it('returns 0 with fewer than 2 samples', () => {
    expect(computeAggressionScore([1], [0])).toBe(0);
  });
  it('returns 0 for steady-state inputs', () => {
    expect(computeAggressionScore([1, 1, 1, 1], [0, 0, 0, 0])).toBe(0);
  });
  it('grows with input volatility', () => {
    const calm    = computeAggressionScore([1, 1, 1, 1], [0, 0, 0, 0]);
    const choppy  = computeAggressionScore([1, 0, 1, 0], [0, 1, 0, 1]);
    expect(choppy).toBeGreaterThan(calm);
    expect(choppy).toBeLessThanOrEqual(1);
  });
});

describe('computeLowFuelStress', () => {
  it('0 when fuel is healthy', () => {
    expect(computeLowFuelStress(0.5)).toBe(0);
    expect(computeLowFuelStress(0.20)).toBe(0);
  });
  it('1 when fuel is empty', () => {
    expect(computeLowFuelStress(0)).toBe(1);
  });
  it('scales linearly inside the danger band', () => {
    expect(computeLowFuelStress(0.10)).toBeCloseTo(0.5, 5);
  });
});

describe('computeTyreWearStress', () => {
  it('0 with brand-new tyres (all wear=1)', () => {
    expect(computeTyreWearStress(makeFrame())).toBe(0);
  });
  it('approaches 1 as tyres go bald', () => {
    const frame = makeFrame({
      lfWearL: 0.05, lfWearM: 0.05, lfWearR: 0.05,
      rfWearL: 0.05, rfWearM: 0.05, rfWearR: 0.05,
      lrWearL: 0.05, lrWearM: 0.05, lrWearR: 0.05,
      rrWearL: 0.05, rrWearM: 0.05, rrWearR: 0.05,
    });
    expect(computeTyreWearStress(frame)).toBeGreaterThan(0.9);
  });
});

describe('deriveNarrativeArc', () => {
  it('opens during opening race phase regardless of stress', () => {
    expect(deriveNarrativeArc({
      racePhase: 'opening',
      incidentIntensity: 1,
      competitiveFocus: 1,
      raceStress: 1,
      paceTrend: 0,
    })).toBe('opening');
  });
  it('returns endgame for final-laps phase', () => {
    expect(deriveNarrativeArc({
      racePhase: 'final-laps',
      incidentIntensity: 0,
      competitiveFocus: 0,
      raceStress: 0,
      paceTrend: 0,
    })).toBe('endgame');
  });
  it('recovery when incident intensity is high', () => {
    expect(deriveNarrativeArc({
      racePhase: 'midrace',
      incidentIntensity: 0.8,
      competitiveFocus: 0,
      raceStress: 0.4,
      paceTrend: 0,
    })).toBe('recovery');
  });
  it('climax when stress is high but no recent incidents', () => {
    expect(deriveNarrativeArc({
      racePhase: 'midrace',
      incidentIntensity: 0.1,
      competitiveFocus: 0.9,
      raceStress: 0.8,
      paceTrend: 0,
    })).toBe('climax');
  });
  it('building when in close company but not yet stressed', () => {
    expect(deriveNarrativeArc({
      racePhase: 'midrace',
      incidentIntensity: 0,
      competitiveFocus: 0.7,
      raceStress: 0.3,
      paceTrend: 0,
    })).toBe('building');
  });
  it('cruise as the default lull state', () => {
    expect(deriveNarrativeArc({
      racePhase: 'midrace',
      incidentIntensity: 0,
      competitiveFocus: 0,
      raceStress: 0,
      paceTrend: 0,
    })).toBe('cruise');
  });
});

// ---------------------------------------------------------------------------
// End-to-end aggregator
// ---------------------------------------------------------------------------

describe('computeDerivedMetrics — integration', () => {
  it('no-ops when player carIdx is unresolved', () => {
    const ds = makeDriverState(PLAYER);
    const before = { ...ds.derived };
    const state = makeRosteredState();
    const frame = makeFrame();
    computeDerivedMetrics(null, frame, state, ds, { playerCarIdx: -1 });
    expect(ds.derived).toEqual(before);
  });

  it('writes a fully-populated derived block with sane defaults on first call', () => {
    const ds = makeDriverState(PLAYER);
    const state = makeRosteredState();
    const frame = makeFrame({ sessionTime: 10 });
    computeDerivedMetrics(null, frame, state, ds, { playerCarIdx: PLAYER });

    expect(ds.derived.recentLapPace).toBe(0);
    expect(ds.derived.paceTrend).toBe(0);
    expect(ds.derived.incidentIntensity).toBe(0);
    expect(ds.derived.competitiveFocus).toBe(0);
    expect(ds.derived.raceStress).toBeGreaterThanOrEqual(0);
    expect(ds.derived.consistencyScore).toBe(0);
    expect(ds.derived.aggressionScore).toBe(0);
    expect(['opening','building','climax','recovery','cruise','endgame']).toContain(ds.derived.narrativeArc);
  });

  it('reflects stable lap pace once 5 lap times exist on CarState', () => {
    const ds = makeDriverState(PLAYER);
    const state = makeRosteredState();
    state.racePhase = 'midrace';
    const cs = getOrCreateCarState(state, PLAYER);
    cs.stintLapTimes = [90, 90, 90, 90, 90];
    const frame = makeFrame({ sessionTime: 600 });
    computeDerivedMetrics(null, frame, state, ds, { playerCarIdx: PLAYER });

    expect(ds.derived.recentLapPace).toBe(90);
    expect(Math.abs(ds.derived.paceTrend)).toBeLessThan(0.001);
    expect(ds.derived.consistencyScore).toBe(1);
  });

  it('ingests CONTACT_DETECTED from recentEvents and bumps incidentIntensity', () => {
    const ds = makeDriverState(PLAYER);
    const state = makeRosteredState();
    state.racePhase = 'midrace';
    ds.recentEvents.push(fakeEvent('CONTACT_DETECTED', 99));
    const frame = makeFrame({ sessionTime: 100 });
    computeDerivedMetrics(null, frame, state, ds, { playerCarIdx: PLAYER });

    expect(ds.recentIncidents.length).toBe(1);
    expect(ds.recentIncidents[0].weight).toBe(INCIDENT_WEIGHTS.CONTACT_DETECTED);
    expect(ds.derived.incidentIntensity).toBeGreaterThan(0);
  });

  it('does not double-ingest the same incident across calls (high-water mark)', () => {
    const ds = makeDriverState(PLAYER);
    const state = makeRosteredState();
    ds.recentEvents.push(fakeEvent('CONTACT_DETECTED', 100));
    const frame1 = makeFrame({ sessionTime: 101 });
    computeDerivedMetrics(null, frame1, state, ds, { playerCarIdx: PLAYER });
    const frame2 = makeFrame({ sessionTime: 102 });
    computeDerivedMetrics(frame1, frame2, state, ds, { playerCarIdx: PLAYER });
    expect(ds.recentIncidents.length).toBe(1);
  });

  it('prunes incidents older than the 60s window', () => {
    const ds = makeDriverState(PLAYER);
    const state = makeRosteredState();
    ds.recentIncidents.push({ sessionTime: 0, weight: 0.6 });
    const frame = makeFrame({ sessionTime: 100 });
    computeDerivedMetrics(null, frame, state, ds, { playerCarIdx: PLAYER });
    expect(ds.recentIncidents.length).toBe(0);
  });

  it('rolling throttle/brake samples drive aggressionScore', () => {
    const ds = makeDriverState(PLAYER);
    const state = makeRosteredState();
    let prev = makeFrame({ sessionTime: 0, throttle: 1, brake: 0 });
    computeDerivedMetrics(null, prev, state, ds, { playerCarIdx: PLAYER });
    for (let i = 1; i <= 10; i++) {
      const f = makeFrame({
        sessionTime: i,
        throttle: i % 2 === 0 ? 1 : 0,
        brake:    i % 2 === 0 ? 0 : 1,
      });
      computeDerivedMetrics(prev, f, state, ds, { playerCarIdx: PLAYER });
      prev = f;
    }
    expect(ds.derived.aggressionScore).toBeGreaterThan(0.5);
  });

  it('competitiveFocus contributes to raceStress via the 0.3 weight', () => {
    const ds = makeDriverState(PLAYER);
    const state = makeRosteredState();
    state.racePhase = 'midrace';
    const cs = getOrCreateCarState(state, PLAYER);
    cs.recentGapToBehind.push(0.1); // ~3 cm — closeness ≈ 0.97
    const frame = makeFrame({ sessionTime: 50, cars: [{ carIdx: PLAYER, f2Time: 0.1 }] });
    computeDerivedMetrics(null, frame, state, ds, { playerCarIdx: PLAYER });
    expect(ds.derived.competitiveFocus).toBeGreaterThan(0.9);
    // raceStress >= 0.3 * competitiveFocus when no other stressors.
    expect(ds.derived.raceStress).toBeGreaterThanOrEqual(0.27);
  });

  it('all derived scores remain bounded in [0,1] across a 50-frame synthetic replay', () => {
    const ds = makeDriverState(PLAYER);
    const state = makeRosteredState();
    state.racePhase = 'midrace';
    const cs = getOrCreateCarState(state, PLAYER);
    cs.stintLapTimes = [90, 91, 89, 92, 88];
    let prev: any = null;
    for (let i = 0; i < 50; i++) {
      // Sprinkle the odd contact event.
      if (i === 10 || i === 25) {
        ds.recentEvents.push(fakeEvent('CONTACT_DETECTED', i));
      }
      const f = makeFrame({
        sessionTime: i,
        throttle: Math.random(),
        brake: Math.random(),
        fuelLevelPct: Math.max(0, 0.8 - i * 0.015),
        cars: [{ carIdx: PLAYER, f2Time: 1 + Math.random() * 2 }],
      });
      cs.recentGapToBehind.push(0.5 + Math.random());
      computeDerivedMetrics(prev, f, state, ds, { playerCarIdx: PLAYER });
      prev = f;

      const d = ds.derived;
      expect(d.incidentIntensity).toBeGreaterThanOrEqual(0);
      expect(d.incidentIntensity).toBeLessThanOrEqual(1);
      expect(d.competitiveFocus).toBeGreaterThanOrEqual(0);
      expect(d.competitiveFocus).toBeLessThanOrEqual(1);
      expect(d.raceStress).toBeGreaterThanOrEqual(0);
      expect(d.raceStress).toBeLessThanOrEqual(1);
      expect(d.consistencyScore).toBeGreaterThanOrEqual(0);
      expect(d.consistencyScore).toBeLessThanOrEqual(1);
      expect(d.aggressionScore).toBeGreaterThanOrEqual(0);
      expect(d.aggressionScore).toBeLessThanOrEqual(1);
    }
  });
});
