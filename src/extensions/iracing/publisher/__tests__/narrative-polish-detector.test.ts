/**
 * narrative-polish-detector.test.ts — Issue #156
 */
import { describe, it, expect } from 'vitest';
import {
  detectPaceDrop,
  detectSectorPersonalBest,
  detectTyreTempDrift,
  detectEngineWarning,
} from '../driver-publisher/narrative-polish-detector';
import { createSessionState, getOrCreateCarState } from '../session-state';
import { makeFrame, seedRoster } from './frame-fixtures';

const PLAYER = 0;
const ctx = { rigId: 'r1', raceSessionId: 's1', playerCarIdx: PLAYER };

describe('detectPaceDrop (#156)', () => {
  it('emits PACE_DROP after 2 consecutive laps ≥ 1.5% slower than stint best', () => {
    const state = createSessionState('s1', 1);
    seedRoster(state, [PLAYER]);
    const cs = getOrCreateCarState(state, PLAYER);
    cs.stintBestLapTime = 90.0;
    cs.stintLapTimes = [91.5, 91.6]; // both ≥ 1.5% over 90.0
    const frame = makeFrame();
    const events = detectPaceDrop(frame, frame, state, ctx);
    expect(events.filter((e) => e.type === 'PACE_DROP').length).toBe(1);
  });

  it('does not emit when only one slow lap', () => {
    const state = createSessionState('s1', 1);
    seedRoster(state, [PLAYER]);
    const cs = getOrCreateCarState(state, PLAYER);
    cs.stintBestLapTime = 90.0;
    cs.stintLapTimes = [90.2, 92.0];
    const frame = makeFrame();
    const events = detectPaceDrop(frame, frame, state, ctx);
    expect(events).toHaveLength(0);
  });
});

describe('detectSectorPersonalBest (#156)', () => {
  it('emits when LapDeltaToBestLap crosses below zero', () => {
    const state = createSessionState('s1', 1);
    seedRoster(state, [PLAYER]);
    const prev = makeFrame({ lapDeltaToBestLap: 0.05, lapDeltaToBestLapOk: 1 });
    const curr = makeFrame({
      lapDeltaToBestLap: -0.12, lapDeltaToBestLapOk: 1,
      cars: [{ carIdx: PLAYER, lapDistPct: 0.5, lapsCompleted: 5 }],
    });
    const events = detectSectorPersonalBest(prev, curr, state, ctx);
    expect(events.length).toBe(1);
    const payload = events[0].payload as { sector: number; deltaSec: number };
    expect(payload.sector).toBe(2);
    expect(payload.deltaSec).toBeCloseTo(0.12, 3);
  });

  it('does not emit when delta is positive', () => {
    const state = createSessionState('s1', 1);
    seedRoster(state, [PLAYER]);
    const prev = makeFrame({ lapDeltaToBestLap: 0.1, lapDeltaToBestLapOk: 1 });
    const curr = makeFrame({ lapDeltaToBestLap: 0.05, lapDeltaToBestLapOk: 1 });
    expect(detectSectorPersonalBest(prev, curr, state, ctx)).toHaveLength(0);
  });
});

describe('detectTyreTempDrift (#156)', () => {
  it('emits TYRE_TEMP_DRIFT after baseline forms and tyre rises > 15 °C', () => {
    const state = createSessionState('s1', 1);
    seedRoster(state, [PLAYER]);
    // Seed baseline of 5 samples at 80 °C
    for (let i = 0; i < 5; i++) {
      const f = makeFrame({ sessionTime: i, lfTempCM: 80 });
      detectTyreTempDrift(f, f, state, ctx);
    }
    // Now spike to 100 °C → delta 20 above baseline 80
    const spike = makeFrame({ sessionTime: 100, lfTempCM: 100 });
    const events = detectTyreTempDrift(spike, spike, state, ctx);
    const drift = events.filter((e) => e.type === 'TYRE_TEMP_DRIFT');
    expect(drift.length).toBe(1);
    const driftPayload = drift[0].payload as { tyre: string; deltaC: number };
    expect(driftPayload.tyre).toBe('LF');
    expect(driftPayload.deltaC).toBeGreaterThanOrEqual(15);
  });
});

describe('detectEngineWarning (#156)', () => {
  it('emits when a new warning bit is set', () => {
    const state = createSessionState('s1', 1);
    seedRoster(state, [PLAYER]);
    const prev = makeFrame({ engineWarnings: 0 });
    const curr = makeFrame({ engineWarnings: 0x04 }); // OilPressure
    const events = detectEngineWarning(prev, curr, state, ctx);
    expect(events).toHaveLength(1);
    expect((events[0].payload as { warningNames: string[] }).warningNames).toContain('OilPressureWarning');
  });

  it('does not re-emit while bitmask is unchanged', () => {
    const state = createSessionState('s1', 1);
    seedRoster(state, [PLAYER]);
    state.lastEngineWarnings = 0x04;
    const f = makeFrame({ engineWarnings: 0x04 });
    expect(detectEngineWarning(f, f, state, ctx)).toHaveLength(0);
  });

  it('does not emit when warnings clear (good news is not a story)', () => {
    const state = createSessionState('s1', 1);
    seedRoster(state, [PLAYER]);
    state.lastEngineWarnings = 0x04;
    const f = makeFrame({ engineWarnings: 0 });
    expect(detectEngineWarning(f, f, state, ctx)).toHaveLength(0);
  });
});
