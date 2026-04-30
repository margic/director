/**
 * environment-detector.test.ts — Issue #99
 *
 * Covers WEATHER_CHANGE, TRACK_TEMP_DRIFT, WIND_SHIFT, TIME_OF_DAY_PHASE.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  detectEnvironment,
  WEATHER_HUMIDITY_THRESHOLD,
  WEATHER_FOG_THRESHOLD,
  WIND_SHIFT_MIN_DEG,
  TRACK_TEMP_DRIFT_MIN_DEG,
  SUN_DAY_THRESHOLD,
  SUN_NIGHT_THRESHOLD,
  type EnvironmentDetectorContext,
} from '../session-publisher/environment-detector';
import { createSessionState, type SessionState } from '../session-state';
import { makeFrame, cloneFrame } from './frame-fixtures';

const CTX: EnvironmentDetectorContext = {
  rigId: 'rig-01',
  raceSessionId: 'rs-1',
};

let state: SessionState;
beforeEach(() => {
  state = createSessionState('rs-1', 1);
});

function detect(
  prev: ReturnType<typeof makeFrame> | null,
  curr: ReturnType<typeof makeFrame>,
  s = state,
  ctx = CTX,
) {
  return detectEnvironment(prev, curr, s, ctx);
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

describe('detectEnvironment — seeding', () => {
  it('returns no events on first (null prev) frame', () => {
    expect(detect(null, makeFrame())).toEqual([]);
  });

  it('seeds lastWeather* from the first frame without emitting', () => {
    const f = makeFrame({ skies: 2, relativeHumidity: 0.7, fogLevel: 0.1 });
    detect(null, f);
    expect(state.lastWeatherSkies).toBe(2);
    expect(state.lastWeatherRelativeHumidity).toBeCloseTo(0.7);
    expect(state.lastWeatherFogLevel).toBeCloseTo(0.1);
  });
});

// ---------------------------------------------------------------------------
// WEATHER_CHANGE
// ---------------------------------------------------------------------------

describe('WEATHER_CHANGE', () => {
  it('fires when Skies value changes', () => {
    const f0 = makeFrame({ skies: 0 });
    detect(null, f0); // seed
    const f1 = cloneFrame(f0);
    f1.skies = 2;
    const events = detect(f0, f1);
    const ev = events.find(e => e.type === 'WEATHER_CHANGE');
    expect(ev).toBeDefined();
    expect(ev!.payload).toMatchObject({ previousSkies: 0, newSkies: 2 });
  });

  it('fires when relativeHumidity changes by >= threshold', () => {
    const f0 = makeFrame({ relativeHumidity: 0.5 });
    detect(null, f0); // seed
    const f1 = cloneFrame(f0);
    f1.relativeHumidity = 0.5 + WEATHER_HUMIDITY_THRESHOLD;
    const events = detect(f0, f1);
    expect(events.find(e => e.type === 'WEATHER_CHANGE')).toBeDefined();
  });

  it('fires when fogLevel changes by >= threshold', () => {
    const f0 = makeFrame({ fogLevel: 0.0 });
    detect(null, f0); // seed
    const f1 = cloneFrame(f0);
    f1.fogLevel = WEATHER_FOG_THRESHOLD;
    const events = detect(f0, f1);
    expect(events.find(e => e.type === 'WEATHER_CHANGE')).toBeDefined();
  });

  it('does NOT fire for tiny humidity change below threshold', () => {
    const f0 = makeFrame({ relativeHumidity: 0.5 });
    detect(null, f0); // seed
    const f1 = cloneFrame(f0);
    f1.relativeHumidity = 0.5 + WEATHER_HUMIDITY_THRESHOLD * 0.5;
    expect(detect(f0, f1).find(e => e.type === 'WEATHER_CHANGE')).toBeUndefined();
  });

  it('updates state.lastWeather* after firing so subsequent identical frame does not re-fire', () => {
    const f0 = makeFrame({ skies: 0 });
    detect(null, f0); // seed
    const f1 = cloneFrame(f0);
    f1.skies = 3;
    detect(f0, f1); // fires + updates state

    // Same frame again — should not re-fire
    const events = detect(f1, cloneFrame(f1));
    expect(events.find(e => e.type === 'WEATHER_CHANGE')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// TRACK_TEMP_DRIFT
// ---------------------------------------------------------------------------

describe('TRACK_TEMP_DRIFT', () => {
  it('fires when trackTemp drifts >= TRACK_TEMP_DRIFT_MIN_DEG from session start', () => {
    state.sessionStartTrackTemp = 25;
    const f0 = makeFrame({ trackTemp: 25 });
    detect(null, f0); // seed
    const f1 = cloneFrame(f0);
    f1.trackTemp = 25 + TRACK_TEMP_DRIFT_MIN_DEG;
    const events = detect(f0, f1);
    const ev = events.find(e => e.type === 'TRACK_TEMP_DRIFT');
    expect(ev).toBeDefined();
    expect(ev!.payload).toMatchObject({
      trackTempCelsius:        f1.trackTemp,
      sessionStartTempCelsius: 25,
      deltaFromStartCelsius:   TRACK_TEMP_DRIFT_MIN_DEG,
    });
  });

  it('fires for negative drift (cooling)', () => {
    state.sessionStartTrackTemp = 35;
    const f0 = makeFrame({ trackTemp: 35 });
    detect(null, f0);
    const f1 = cloneFrame(f0);
    f1.trackTemp = 35 - TRACK_TEMP_DRIFT_MIN_DEG;
    const events = detect(f0, f1);
    expect(events.find(e => e.type === 'TRACK_TEMP_DRIFT')).toBeDefined();
  });

  it('does NOT fire when drift < threshold', () => {
    state.sessionStartTrackTemp = 25;
    const f0 = makeFrame({ trackTemp: 25 });
    detect(null, f0);
    const f1 = cloneFrame(f0);
    f1.trackTemp = 25 + TRACK_TEMP_DRIFT_MIN_DEG - 1;
    expect(detect(f0, f1).find(e => e.type === 'TRACK_TEMP_DRIFT')).toBeUndefined();
  });

  it('only fires once per session (one-shot latch)', () => {
    state.sessionStartTrackTemp = 25;
    const f0 = makeFrame({ trackTemp: 25 });
    detect(null, f0);
    const f1 = cloneFrame(f0);
    f1.trackTemp = 35;
    detect(f0, f1); // fires — latch set

    const f2 = cloneFrame(f1);
    f2.trackTemp = 40; // even bigger drift
    const events = detect(f1, f2);
    expect(events.find(e => e.type === 'TRACK_TEMP_DRIFT')).toBeUndefined();
  });

  it('does NOT fire when sessionStartTrackTemp is 0 (uninitialised)', () => {
    state.sessionStartTrackTemp = 0;
    const f0 = makeFrame({ trackTemp: 0 });
    detect(null, f0);
    const f1 = cloneFrame(f0);
    f1.trackTemp = 40;
    expect(detect(f0, f1).find(e => e.type === 'TRACK_TEMP_DRIFT')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// WIND_SHIFT
// ---------------------------------------------------------------------------

describe('WIND_SHIFT', () => {
  const degToRad = (d: number) => d * (Math.PI / 180);

  it('fires when windDir changes by >= WIND_SHIFT_MIN_DEG', () => {
    const f0 = makeFrame({ windDir: 0 });
    detect(null, f0);
    const f1 = cloneFrame(f0);
    f1.windDir = degToRad(WIND_SHIFT_MIN_DEG);
    const events = detect(f0, f1);
    expect(events.find(e => e.type === 'WIND_SHIFT')).toBeDefined();
  });

  it('does NOT fire for change below WIND_SHIFT_MIN_DEG', () => {
    const f0 = makeFrame({ windDir: 0 });
    detect(null, f0);
    const f1 = cloneFrame(f0);
    f1.windDir = degToRad(WIND_SHIFT_MIN_DEG - 1);
    expect(detect(f0, f1).find(e => e.type === 'WIND_SHIFT')).toBeUndefined();
  });

  it('handles wrap-around: 350° to 10° = 20° (not 340°)', () => {
    const f0 = makeFrame({ windDir: degToRad(350) });
    detect(null, f0);
    const f1 = cloneFrame(f0);
    f1.windDir = degToRad(10);
    // 20° change — below threshold, should NOT fire
    expect(detect(f0, f1).find(e => e.type === 'WIND_SHIFT')).toBeUndefined();
  });

  it('includes deltaDeg and current windVel in payload', () => {
    const f0 = makeFrame({ windDir: 0, windVel: 5 });
    detect(null, f0);
    const f1 = cloneFrame(f0);
    f1.windDir = degToRad(90);
    f1.windVel = 8;
    const events = detect(f0, f1);
    const ev = events.find(e => e.type === 'WIND_SHIFT');
    expect(ev).toBeDefined();
    expect(ev!.payload).toMatchObject({ deltaDeg: 90, windVelMps: 8 });
  });
});

// ---------------------------------------------------------------------------
// TIME_OF_DAY_PHASE
// ---------------------------------------------------------------------------

describe('TIME_OF_DAY_PHASE', () => {
  it('seeds phase silently on null prev — no event emitted', () => {
    expect(detect(null, makeFrame({ solarAltitude: 0.5 }))).toEqual([]);
    expect(state.lastTimeOfDayPhase).toBe('day');
  });

  it('fires dawn when solar altitude crosses 0 upward', () => {
    const f0 = makeFrame({ solarAltitude: -0.01 });
    detect(null, f0); // seed → phase = 'dusk' (between 0 and night threshold)
    const f1 = cloneFrame(f0);
    f1.solarAltitude = 0.01; // just above 0 — 'dawn'
    const events = detect(f0, f1);
    const ev = events.find(e => e.type === 'TIME_OF_DAY_PHASE');
    expect(ev).toBeDefined();
    expect(ev!.payload).toMatchObject({ phase: 'dawn' });
  });

  it('fires day when solar altitude rises above DAY_THRESHOLD', () => {
    const f0 = makeFrame({ solarAltitude: SUN_DAY_THRESHOLD - 0.01 });
    detect(null, f0); // seeds as 'dawn'
    const f1 = cloneFrame(f0);
    f1.solarAltitude = SUN_DAY_THRESHOLD + 0.01; // enters 'day'
    const events = detect(f0, f1);
    const ev = events.find(e => e.type === 'TIME_OF_DAY_PHASE');
    expect(ev).toBeDefined();
    expect(ev!.payload).toMatchObject({ phase: 'day' });
  });

  it('fires dusk when solar altitude falls below 0', () => {
    const f0 = makeFrame({ solarAltitude: 0.01 });
    detect(null, f0); // seeds as 'dawn'
    const f1 = cloneFrame(f0);
    f1.solarAltitude = -0.01; // enters 'dusk'
    const events = detect(f0, f1);
    const ev = events.find(e => e.type === 'TIME_OF_DAY_PHASE');
    expect(ev).toBeDefined();
    expect(ev!.payload).toMatchObject({ phase: 'dusk' });
  });

  it('fires night when solar altitude drops below NIGHT_THRESHOLD', () => {
    const f0 = makeFrame({ solarAltitude: SUN_NIGHT_THRESHOLD + 0.01 });
    detect(null, f0); // seeds as 'dusk'
    const f1 = cloneFrame(f0);
    f1.solarAltitude = SUN_NIGHT_THRESHOLD - 0.01; // enters 'night'
    const events = detect(f0, f1);
    const ev = events.find(e => e.type === 'TIME_OF_DAY_PHASE');
    expect(ev).toBeDefined();
    expect(ev!.payload).toMatchObject({ phase: 'night' });
  });

  it('does NOT re-fire when phase is unchanged', () => {
    const f0 = makeFrame({ solarAltitude: 0.5 });
    detect(null, f0); // seed → 'day'
    const f1 = cloneFrame(f0);
    f1.solarAltitude = 0.6; // still 'day'
    expect(detect(f0, f1).find(e => e.type === 'TIME_OF_DAY_PHASE')).toBeUndefined();
  });
});
