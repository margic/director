/**
 * lap-performance-detector.test.ts — Issues #100, #95
 *
 * Covers PERSONAL_BEST_LAP, SESSION_BEST_LAP, CLASS_BEST_LAP,
 * STINT_BEST_LAP and LAP_TIME_DEGRADATION using synthetic lap-time
 * sequences.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  detectSessionLapPerformance,
  type SessionLapPerformanceContext,
} from '../session-publisher/lap-performance-session';
import {
  detectDriverLapPerformance,
  LAP_DEGRADATION_BUFFER_SIZE,
  DEFAULT_LAP_DEGRADATION_THRESHOLD,
} from '../driver-publisher/lap-performance-driver';
import { createSessionState, type SessionState } from '../session-state';
import type { TelemetryFrame } from '../session-state';
import { makeFrame, cloneFrame, CAR_COUNT } from './frame-fixtures';

// Combined context — covers both session and driver slices
interface LapPerformanceContext extends SessionLapPerformanceContext {
  playerCarIdx?: number;
  degradationThreshold?: number;
}

// Local wrapper that mirrors the old detectLapPerformance API.
// Calls both split functions and merges the results so all existing
// tests continue to work without modification.
function detectLapPerformance(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: LapPerformanceContext,
) {
  return [
    ...detectSessionLapPerformance(prev, curr, state, ctx),
    ...detectDriverLapPerformance(prev, curr, state, ctx),
  ];
}

const ctx: LapPerformanceContext = {
  publisherCode: 'TEST',
  raceSessionId: 'rs-1',
  playerCarIdx:  0,
};

let state: SessionState;

beforeEach(() => {
  state = createSessionState('rs-1', 1);
});

/** Helper — bump completed lap count + set lap times on a per-car slot. */
function bumpLap(
  base: ReturnType<typeof makeFrame>,
  carIdx: number,
  lap: number,
  lastLap: number,
  bestLap: number,
): ReturnType<typeof makeFrame> {
  const f = cloneFrame(base);
  f.carIdxLapCompleted[carIdx] = lap;
  f.carIdxLastLapTime[carIdx]  = lastLap;
  f.carIdxBestLapTime[carIdx]  = bestLap;
  return f;
}

// ---------------------------------------------------------------------------
// Seeding behaviour
// ---------------------------------------------------------------------------

describe('detectLapPerformance — seeding', () => {
  it('returns no events on first frame and seeds per-car bests', () => {
    const f0 = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 5, lastLapTime: 90, bestLapTime: 88 }] });
    const events = detectLapPerformance(null, f0, state, ctx);
    expect(events).toEqual([]);
    expect(state.carStates.get(0)?.bestLapTime).toBe(88);
  });

  it('seeds sessionBestLapTime on first frame', () => {
    const f0 = makeFrame({ cars: [
      { carIdx: 0, bestLapTime: 88 },
      { carIdx: 1, bestLapTime: 87 },
    ]});
    detectLapPerformance(null, f0, state, ctx);
    expect(state.sessionBestLapTime).toBe(87);
  });
});

// ---------------------------------------------------------------------------
// PERSONAL_BEST_LAP
// ---------------------------------------------------------------------------

describe('detectLapPerformance — PERSONAL_BEST_LAP', () => {
  it('emits when player CarIdxBestLapTime improves on lap completion', () => {
    const f0 = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 1, lastLapTime: 91, bestLapTime: 91 }] });
    detectLapPerformance(null, f0, state, ctx);

    const f1 = bumpLap(f0, 0, 2, 89, 89);
    const events = detectLapPerformance(f0, f1, state, ctx);

    const pb = events.find(e => e.type === 'PERSONAL_BEST_LAP');
    expect(pb).toBeDefined();
    expect(pb!.payload).toMatchObject({ lapNumber: 2, lapTime: 89, previousBest: 91 });
  });

  it('does NOT emit when player lap time is slower than current best', () => {
    const f0 = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 1, lastLapTime: 89, bestLapTime: 89 }] });
    detectLapPerformance(null, f0, state, ctx);

    const f1 = bumpLap(f0, 0, 2, 92, 89);
    const events = detectLapPerformance(f0, f1, state, ctx);

    expect(events.find(e => e.type === 'PERSONAL_BEST_LAP')).toBeUndefined();
  });

  it('skips player events when playerCarIdx is undefined', () => {
    const noPlayerCtx = { ...ctx, playerCarIdx: undefined };
    const f0 = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 1, lastLapTime: 91, bestLapTime: 91 }] });
    detectLapPerformance(null, f0, state, noPlayerCtx);
    const f1 = bumpLap(f0, 0, 2, 89, 89);
    const events = detectLapPerformance(f0, f1, state, noPlayerCtx);
    expect(events.find(e => e.type === 'PERSONAL_BEST_LAP')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SESSION_BEST_LAP
// ---------------------------------------------------------------------------

describe('detectLapPerformance — SESSION_BEST_LAP', () => {
  it('emits when any car drops below the previous session best', () => {
    const f0 = makeFrame({ cars: [
      { carIdx: 0, lapsCompleted: 1, lastLapTime: 90, bestLapTime: 90 },
      { carIdx: 1, lapsCompleted: 1, lastLapTime: 91, bestLapTime: 91 },
    ]});
    detectLapPerformance(null, f0, state, ctx);

    const f1 = bumpLap(f0, 1, 2, 88, 88);
    const events = detectLapPerformance(f0, f1, state, ctx);

    const sb = events.find(e => e.type === 'SESSION_BEST_LAP');
    expect(sb).toBeDefined();
    expect(sb!.payload).toMatchObject({ lapTime: 88, previousSessionBest: 90 });
    expect(sb!.car?.carIdx).toBe(1);
    expect(state.sessionBestLapTime).toBe(88);
  });

  it('does NOT emit when no car beats the current session best', () => {
    const f0 = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 1, lastLapTime: 88, bestLapTime: 88 }] });
    detectLapPerformance(null, f0, state, ctx);

    const f1 = bumpLap(f0, 0, 2, 90, 88);
    const events = detectLapPerformance(f0, f1, state, ctx);
    expect(events.find(e => e.type === 'SESSION_BEST_LAP')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// STINT_BEST_LAP
// ---------------------------------------------------------------------------

describe('detectLapPerformance — STINT_BEST_LAP', () => {
  it('emits on first completed lap (initial stint best)', () => {
    const f0 = makeFrame();
    detectLapPerformance(null, f0, state, ctx);

    const f1 = bumpLap(f0, 0, 1, 92, 92);
    const events = detectLapPerformance(f0, f1, state, ctx);
    const sb = events.find(e => e.type === 'STINT_BEST_LAP' && e.car?.carIdx === 0);
    expect(sb).toBeDefined();
    expect(sb!.payload).toMatchObject({ lapNumber: 1, lapTime: 92 });
    expect(state.carStates.get(0)?.stintBestLapTime).toBe(92);
  });

  it('emits again only when subsequent lap improves', () => {
    const f0 = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 1, lastLapTime: 92, bestLapTime: 92 }] });
    detectLapPerformance(null, f0, state, ctx);
    state.carStates.get(0)!.stintBestLapTime = 92;

    const f1 = bumpLap(f0, 0, 2, 93, 92);
    expect(detectLapPerformance(f0, f1, state, ctx).find(e => e.type === 'STINT_BEST_LAP')).toBeUndefined();

    const f2 = bumpLap(f1, 0, 3, 90, 90);
    const events = detectLapPerformance(f1, f2, state, ctx);
    expect(events.find(e => e.type === 'STINT_BEST_LAP')).toBeDefined();
    expect(state.carStates.get(0)?.stintBestLapTime).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// LAP_TIME_DEGRADATION
// ---------------------------------------------------------------------------

describe('detectLapPerformance — LAP_TIME_DEGRADATION', () => {
  it('does NOT emit until the rolling buffer is full', () => {
    let prev = makeFrame();
    detectLapPerformance(null, prev, state, ctx);

    // Two laps — buffer not yet full
    for (let lap = 1; lap < LAP_DEGRADATION_BUFFER_SIZE; lap++) {
      const next = bumpLap(prev, 0, lap, 100, 100);
      const evs  = detectLapPerformance(prev, next, state, ctx);
      expect(evs.find(e => e.type === 'LAP_TIME_DEGRADATION')).toBeUndefined();
      prev = next;
    }
  });

  it('emits when rolling avg exceeds stint best by the threshold', () => {
    // First lap establishes a 90s stint best.
    const f0 = makeFrame();
    detectLapPerformance(null, f0, state, ctx);

    const f1 = bumpLap(f0, 0, 1, 90, 90);
    detectLapPerformance(f0, f1, state, ctx);

    // Two slower laps fill the buffer ([90, 95, 95] → avg 93.33, ~3.7%).
    const f2 = bumpLap(f1, 0, 2, 95, 90);
    detectLapPerformance(f1, f2, state, ctx);
    const f3 = bumpLap(f2, 0, 3, 95, 90);
    const events = detectLapPerformance(f2, f3, state, ctx);

    const deg = events.find(e => e.type === 'LAP_TIME_DEGRADATION');
    expect(deg).toBeDefined();
    expect(deg!.payload).toMatchObject({ stintBestSec: 90 });
    const pct = (deg!.payload as { degradationPct: number }).degradationPct;
    expect(pct).toBeGreaterThanOrEqual(DEFAULT_LAP_DEGRADATION_THRESHOLD);
  });

  it('only emits once per stint (latched)', () => {
    const f0 = makeFrame();
    detectLapPerformance(null, f0, state, ctx);
    const f1 = bumpLap(f0, 0, 1, 90, 90);
    detectLapPerformance(f0, f1, state, ctx);
    const f2 = bumpLap(f1, 0, 2, 95, 90);
    detectLapPerformance(f1, f2, state, ctx);
    const f3 = bumpLap(f2, 0, 3, 95, 90);
    const first = detectLapPerformance(f2, f3, state, ctx);
    expect(first.find(e => e.type === 'LAP_TIME_DEGRADATION')).toBeDefined();

    // Another slow lap — should NOT re-fire.
    const f4 = bumpLap(f3, 0, 4, 96, 90);
    const second = detectLapPerformance(f3, f4, state, ctx);
    expect(second.find(e => e.type === 'LAP_TIME_DEGRADATION')).toBeUndefined();
  });

  it('resets the degradation latch when stint best improves', () => {
    state.playerDegradationFired = true;
    // Existing buffer keeps the post-improvement avg under the 3% threshold,
    // so the latch should reset and stay reset (not immediately re-trigger).
    state.playerLapTimeBuffer = [88, 88, 88];
    const f0 = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 4, lastLapTime: 88, bestLapTime: 90 }] });
    detectLapPerformance(null, f0, state, ctx);
    state.carStates.get(0)!.stintBestLapTime = 90;

    const f1 = bumpLap(f0, 0, 5, 87, 87);
    detectLapPerformance(f0, f1, state, ctx);
    expect(state.playerDegradationFired).toBe(false);
  });

  it('honours a custom threshold', () => {
    const customCtx = { ...ctx, degradationThreshold: 0.10 }; // 10%

    const f0 = makeFrame();
    detectLapPerformance(null, f0, state, customCtx);
    const f1 = bumpLap(f0, 0, 1, 90, 90);
    detectLapPerformance(f0, f1, state, customCtx);
    // Avg ~93.33 = 3.7% — under 10%
    const f2 = bumpLap(f1, 0, 2, 95, 90);
    detectLapPerformance(f1, f2, state, customCtx);
    const f3 = bumpLap(f2, 0, 3, 95, 90);
    const events = detectLapPerformance(f2, f3, state, customCtx);
    expect(events.find(e => e.type === 'LAP_TIME_DEGRADATION')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CLASS_BEST_LAP — issue #95
// ---------------------------------------------------------------------------

describe('detectLapPerformance — CLASS_BEST_LAP', () => {
  it('emits when the best lap within a class improves', () => {
    const carClassByCarIdx = new Map<number, number>([[0, 100], [1, 100], [2, 200]]);
    const carClassShortNames = new Map<number, string>([[100, 'GT3'], [200, 'GT4']]);
    const classCtx = { ...ctx, carClassByCarIdx, carClassShortNames };

    const f0 = makeFrame({ cars: [
      { carIdx: 0, lapsCompleted: 1, lastLapTime: 95, bestLapTime: 95 },
      { carIdx: 1, lapsCompleted: 1, lastLapTime: 96, bestLapTime: 96 },
      { carIdx: 2, lapsCompleted: 1, lastLapTime: 100, bestLapTime: 100 },
    ]});
    detectLapPerformance(null, f0, state, classCtx);
    state.classBestLapTimes.set(100, 95);
    state.classBestLapTimes.set(200, 100);

    const f1 = bumpLap(f0, 1, 2, 93, 93);
    const events = detectLapPerformance(f0, f1, state, classCtx);

    const cb = events.find(e => e.type === 'CLASS_BEST_LAP');
    expect(cb).toBeDefined();
    expect(cb!.payload).toMatchObject({ lapTime: 93, carClassId: 100, carClassShortName: 'GT3' });
    expect(state.classBestLapTimes.get(100)).toBe(93);
    expect(state.classBestLapTimes.get(200)).toBe(100); // unchanged
  });

  it('does NOT emit when no class best improves', () => {
    const carClassByCarIdx = new Map<number, number>([[0, 100], [1, 100]]);
    const classCtx = { ...ctx, carClassByCarIdx };

    const f0 = makeFrame({ cars: [
      { carIdx: 0, lapsCompleted: 1, lastLapTime: 90, bestLapTime: 90 },
      { carIdx: 1, lapsCompleted: 1, lastLapTime: 92, bestLapTime: 92 },
    ]});
    detectLapPerformance(null, f0, state, classCtx);
    state.classBestLapTimes.set(100, 90);

    const f1 = bumpLap(f0, 1, 2, 91, 91);
    const events = detectLapPerformance(f0, f1, state, classCtx);
    expect(events.find(e => e.type === 'CLASS_BEST_LAP')).toBeUndefined();
  });

  it('skips class detection when carClassByCarIdx is empty', () => {
    const f0 = makeFrame();
    detectLapPerformance(null, f0, state, ctx);
    const f1 = bumpLap(f0, 0, 1, 90, 90);
    const events = detectLapPerformance(f0, f1, state, ctx);
    expect(events.find(e => e.type === 'CLASS_BEST_LAP')).toBeUndefined();
  });
});

// Sanity check on CAR_COUNT export (used inside detector module).
describe('detectLapPerformance — slot coverage', () => {
  it('iterates all 64 car slots', () => {
    expect(CAR_COUNT).toBe(64);
  });
});
