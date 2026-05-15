/**
 * safety-car-imminent-detector.test.ts — Issue #181
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  detectSafetyCarImminent,
  lapDistPctToSector,
  SAFETY_CAR_WINDOW_SEC,
  SAFETY_CAR_COOLDOWN_SEC,
  type SafetyCarImminentContext,
} from '../session-publisher/safety-car-imminent-detector';
import { createSessionState, type SessionState, buildEvent, carRefFromRoster } from '../session-state';
import { makeFrame, seedRoster, ALL_CAR_INDICES } from './frame-fixtures';
import type { PublisherEvent, StoppedOnTrackPayload } from '../event-types';

let state: SessionState;
let ctx:   SafetyCarImminentContext;

beforeEach(() => {
  state = createSessionState('rs-1', 1);
  seedRoster(state, ALL_CAR_INDICES);
  ctx = {
    rigId:           'rig-01',
    raceSessionId:   'rs-1',
    emittedThisTick: [],
  };
});

function stoppedOnTrackEvent(carIdx: number, lapDistPct: number, frame: ReturnType<typeof makeFrame>): PublisherEvent {
  const ref = carRefFromRoster(state, carIdx)!;
  const payload: StoppedOnTrackPayload = {
    lapDistPct,
    stoppedDurationSec: 6,
  } as StoppedOnTrackPayload;
  return buildEvent('STOPPED_ON_TRACK', ref, payload, {
    raceSessionId: 'rs-1',
    rigId:         'rig-01',
    frame,
  });
}

describe('lapDistPctToSector', () => {
  it('maps 0..1 into 3 thirds', () => {
    expect(lapDistPctToSector(0.0)).toBe(0);
    expect(lapDistPctToSector(0.30)).toBe(0);
    expect(lapDistPctToSector(0.34)).toBe(1);
    expect(lapDistPctToSector(0.66)).toBe(1);
    expect(lapDistPctToSector(0.67)).toBe(2);
    expect(lapDistPctToSector(0.99)).toBe(2);
  });
  it('clamps and wraps gracefully', () => {
    expect(lapDistPctToSector(1.0)).toBe(0);
    expect(lapDistPctToSector(-0.1)).toBeGreaterThanOrEqual(0);
  });
});

describe('detectSafetyCarImminent', () => {
  it('does NOT fire on a single stopped car', () => {
    const f = makeFrame({ sessionTime: 100 });
    ctx.emittedThisTick = [stoppedOnTrackEvent(3, 0.5, f)];

    const events = detectSafetyCarImminent(null, f, state, ctx);
    expect(events).toEqual([]);
  });

  it('fires when ≥3 cars stop within the rolling window', () => {
    let f = makeFrame({ sessionTime: 100 });
    ctx.emittedThisTick = [stoppedOnTrackEvent(1, 0.10, f)];
    expect(detectSafetyCarImminent(null, f, state, ctx)).toEqual([]);

    f = makeFrame({ sessionTime: 110 });
    ctx.emittedThisTick = [stoppedOnTrackEvent(2, 0.45, f)];
    expect(detectSafetyCarImminent(null, f, state, ctx)).toEqual([]);

    f = makeFrame({ sessionTime: 120 });
    ctx.emittedThisTick = [stoppedOnTrackEvent(3, 0.80, f)];
    const events = detectSafetyCarImminent(null, f, state, ctx);

    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.type).toBe('SAFETY_CAR_IMMINENT');
    const p = ev.payload as any;
    expect(p.stoppedCarCount).toBe(3);
    expect(p.windowSec).toBe(SAFETY_CAR_WINDOW_SEC);
    expect(p.affectedSectors).toEqual([0, 1, 2]);
    expect(p.affectedCars.map((c: any) => c.carIdx).sort()).toEqual([1, 2, 3]);
  });

  it('fires when ≥2 cars stop in the same sector even with low total count', () => {
    let f = makeFrame({ sessionTime: 100 });
    ctx.emittedThisTick = [stoppedOnTrackEvent(7, 0.40, f)]; // sector 1
    expect(detectSafetyCarImminent(null, f, state, ctx)).toEqual([]);

    f = makeFrame({ sessionTime: 105 });
    ctx.emittedThisTick = [stoppedOnTrackEvent(8, 0.55, f)]; // sector 1
    const events = detectSafetyCarImminent(null, f, state, ctx);

    expect(events).toHaveLength(1);
    const p = events[0]!.payload as any;
    expect(p.stoppedCarCount).toBe(2);
    expect(p.affectedSectors).toEqual([1]);
  });

  it('prunes entries older than the rolling window', () => {
    // Two old entries at sessionTime 0 in sector 0.
    let f = makeFrame({ sessionTime: 0 });
    ctx.emittedThisTick = [stoppedOnTrackEvent(1, 0.10, f), stoppedOnTrackEvent(2, 0.15, f)];
    // Two stoppages = within-sector trigger — emit and set cooldown.
    expect(detectSafetyCarImminent(null, f, state, ctx)).toHaveLength(1);

    // Wait long enough to pass cooldown AND prune the old entries.
    const later = SAFETY_CAR_WINDOW_SEC + SAFETY_CAR_COOLDOWN_SEC + 10;
    f = makeFrame({ sessionTime: later });
    ctx.emittedThisTick = [stoppedOnTrackEvent(3, 0.10, f)]; // single new stoppage
    const events = detectSafetyCarImminent(null, f, state, ctx);
    expect(events).toEqual([]);
    // Only the fresh entry should remain.
    expect(state.recentStoppedOnTrackEvents).toHaveLength(1);
    expect(state.recentStoppedOnTrackEvents[0].carIdx).toBe(3);
  });

  it('respects the cooldown between successive emissions', () => {
    let f = makeFrame({ sessionTime: 100 });
    ctx.emittedThisTick = [
      stoppedOnTrackEvent(1, 0.10, f),
      stoppedOnTrackEvent(2, 0.45, f),
      stoppedOnTrackEvent(3, 0.80, f),
    ];
    expect(detectSafetyCarImminent(null, f, state, ctx)).toHaveLength(1);

    // Same window, more cars — cooldown blocks.
    f = makeFrame({ sessionTime: 105 });
    ctx.emittedThisTick = [stoppedOnTrackEvent(4, 0.20, f)];
    expect(detectSafetyCarImminent(null, f, state, ctx)).toEqual([]);

    // After cooldown elapses, a fresh cluster fires again. (The original
    // entries are now pruned by the rolling window, so we need new stoppages.)
    f = makeFrame({ sessionTime: 100 + SAFETY_CAR_COOLDOWN_SEC + 1 });
    ctx.emittedThisTick = [
      stoppedOnTrackEvent(10, 0.10, f),
      stoppedOnTrackEvent(11, 0.45, f),
      stoppedOnTrackEvent(12, 0.80, f),
    ];
    const events = detectSafetyCarImminent(null, f, state, ctx);
    expect(events).toHaveLength(1);
  });

  it('deduplicates the same car repeating STOPPED_ON_TRACK events', () => {
    let f = makeFrame({ sessionTime: 100 });
    ctx.emittedThisTick = [
      stoppedOnTrackEvent(7, 0.40, f),
      stoppedOnTrackEvent(7, 0.40, f),
      stoppedOnTrackEvent(7, 0.40, f),
    ];
    const events = detectSafetyCarImminent(null, f, state, ctx);
    expect(events).toEqual([]);
  });
});
