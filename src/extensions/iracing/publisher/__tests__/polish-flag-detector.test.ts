/**
 * polish-flag-detector.test.ts — Issue #99
 *
 * Covers FLAG_RED, FLAG_DEBRIS (session-level) and FLAG_BLUE_DRIVER,
 * FLAG_BLACK_DRIVER, FLAG_MEATBALL_DRIVER, FLAG_DISQUALIFY (per-car).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  detectPolishFlags,
  SESSION_FLAG_RED,
  SESSION_FLAG_DEBRIS,
  CAR_FLAG_BLUE,
  CAR_FLAG_BLACK,
  CAR_FLAG_MEATBALL,
  CAR_FLAG_DISQUALIFY,
  type PolishFlagDetectorContext,
} from '../session-publisher/polish-flag-detector';
import { createSessionState, type SessionState } from '../session-state';
import { makeFrame, cloneFrame } from './frame-fixtures';

const CTX: PolishFlagDetectorContext = {
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
  ctx = CTX,
) {
  return detectPolishFlags(prev, curr, state, ctx);
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

describe('detectPolishFlags — seeding', () => {
  it('returns no events on first (null prev) frame', () => {
    expect(detect(null, makeFrame())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// FLAG_RED (session-level)
// ---------------------------------------------------------------------------

describe('FLAG_RED', () => {
  it('fires on rising edge of SESSION_FLAG_RED', () => {
    const f0 = makeFrame({ sessionFlags: 0 });
    const f1 = cloneFrame(f0);
    f1.sessionFlags = SESSION_FLAG_RED;
    const events = detect(f0, f1);
    expect(events.find(e => e.type === 'FLAG_RED')).toBeDefined();
  });

  it('does NOT fire when flag was already set in prev', () => {
    const f0 = makeFrame({ sessionFlags: SESSION_FLAG_RED });
    const f1 = cloneFrame(f0);
    expect(detect(f0, f1).find(e => e.type === 'FLAG_RED')).toBeUndefined();
  });

  it('does NOT fire on falling edge (flag cleared)', () => {
    const f0 = makeFrame({ sessionFlags: SESSION_FLAG_RED });
    const f1 = cloneFrame(f0);
    f1.sessionFlags = 0;
    expect(detect(f0, f1).find(e => e.type === 'FLAG_RED')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// FLAG_DEBRIS (session-level)
// ---------------------------------------------------------------------------

describe('FLAG_DEBRIS', () => {
  it('fires on rising edge of SESSION_FLAG_DEBRIS', () => {
    const f0 = makeFrame({ sessionFlags: 0 });
    const f1 = cloneFrame(f0);
    f1.sessionFlags = SESSION_FLAG_DEBRIS;
    expect(detect(f0, f1).find(e => e.type === 'FLAG_DEBRIS')).toBeDefined();
  });

  it('does NOT fire when flag was already set', () => {
    const f0 = makeFrame({ sessionFlags: SESSION_FLAG_DEBRIS });
    const f1 = cloneFrame(f0);
    expect(detect(f0, f1).find(e => e.type === 'FLAG_DEBRIS')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Per-car flags — blue, black, meatball, disqualify
// ---------------------------------------------------------------------------

describe('FLAG_BLUE_DRIVER', () => {
  it('fires when CAR_FLAG_BLUE rises for a car', () => {
    const f0 = makeFrame();
    const f1 = cloneFrame(f0);
    f1.carIdxSessionFlags[3] = CAR_FLAG_BLUE;
    const events = detect(f0, f1);
    const ev = events.find(e => e.type === 'FLAG_BLUE_DRIVER');
    expect(ev).toBeDefined();
    expect(ev!.payload).toMatchObject({ carIdx: 3 });
  });

  it('does NOT fire when already set in prev', () => {
    const f0 = makeFrame();
    f0.carIdxSessionFlags[3] = CAR_FLAG_BLUE;
    const f1 = cloneFrame(f0);
    expect(detect(f0, f1).find(e => e.type === 'FLAG_BLUE_DRIVER')).toBeUndefined();
  });
});

describe('FLAG_BLACK_DRIVER', () => {
  it('fires when CAR_FLAG_BLACK rises', () => {
    const f0 = makeFrame();
    const f1 = cloneFrame(f0);
    f1.carIdxSessionFlags[5] = CAR_FLAG_BLACK;
    const ev = detect(f0, f1).find(e => e.type === 'FLAG_BLACK_DRIVER');
    expect(ev).toBeDefined();
    expect(ev!.payload).toMatchObject({ carIdx: 5 });
  });
});

describe('FLAG_MEATBALL_DRIVER', () => {
  it('fires when CAR_FLAG_MEATBALL rises', () => {
    const f0 = makeFrame();
    const f1 = cloneFrame(f0);
    f1.carIdxSessionFlags[7] = CAR_FLAG_MEATBALL;
    expect(detect(f0, f1).find(e => e.type === 'FLAG_MEATBALL_DRIVER')).toBeDefined();
  });
});

describe('FLAG_DISQUALIFY', () => {
  it('fires when CAR_FLAG_DISQUALIFY rises', () => {
    const f0 = makeFrame();
    const f1 = cloneFrame(f0);
    f1.carIdxSessionFlags[2] = CAR_FLAG_DISQUALIFY;
    expect(detect(f0, f1).find(e => e.type === 'FLAG_DISQUALIFY')).toBeDefined();
  });
});

describe('per-car flags — combined', () => {
  it('fires multiple flag events in the same frame for different cars', () => {
    const f0 = makeFrame();
    const f1 = cloneFrame(f0);
    f1.carIdxSessionFlags[1] = CAR_FLAG_BLUE;
    f1.carIdxSessionFlags[4] = CAR_FLAG_BLACK;
    const events = detect(f0, f1);
    expect(events.find(e => e.type === 'FLAG_BLUE_DRIVER')).toBeDefined();
    expect(events.find(e => e.type === 'FLAG_BLACK_DRIVER')).toBeDefined();
  });

  it('populates carNumber from carNumberByCarIdx context when provided', () => {
    const f0 = makeFrame();
    const f1 = cloneFrame(f0);
    f1.carIdxSessionFlags[8] = CAR_FLAG_DISQUALIFY;
    const ctx: PolishFlagDetectorContext = {
      ...CTX,
      carNumberByCarIdx: new Map([[8, '42']]),
    };
    const ev = detect(f0, f1, ctx).find(e => e.type === 'FLAG_DISQUALIFY');
    expect(ev!.payload).toMatchObject({ carNumber: '42' });
  });
});
