/**
 * contact-detector.test.ts — Issue #180
 *
 * Covers CONTACT_DETECTED — trigger edges, severity classification, cause
 * classification (car_contact vs solo_incident), cooldown, and the negative
 * case of a clean lap.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  detectContact,
  exceedsContactThresholds,
  lapDistPctDistance,
  computeContactSeverity,
  pushProximitySnapshot,
  CONTACT_LAT_ACCEL_THRESHOLD,
  CONTACT_LONG_ACCEL_THRESHOLD,
  CONTACT_VERT_ACCEL_THRESHOLD,
  CONTACT_YAW_RATE_THRESHOLD,
  CONTACT_RESOLUTION_WINDOW_SEC,
  CONTACT_COOLDOWN_TICKS,
  CONTACT_PROXIMITY_LAP_DIST_PCT,
  CONTACT_YAW_SUSTAIN_FRAMES,
  type ContactDetectorContext,
} from '../driver-publisher/contact-detector';
import { createSessionState, type SessionState } from '../session-state';
import { CONTACT_PROXIMITY_RING_CAPACITY, type DriverState, type PendingContactState } from '../driver-state';
import { makeFrame, cloneFrame, seedRoster, ALL_CAR_INDICES, makeDriverState } from './frame-fixtures';
import type { ContactDetectedPayload, PublisherEvent } from '../event-types';

const PLAYER = 0;
const RIVAL  = 14;

const CTX: ContactDetectorContext = {
  rigId:         'rig-01',
  raceSessionId: 'rs-1',
  playerCarIdx:  PLAYER,
};

let state: SessionState;
let driverState: DriverState;

beforeEach(() => {
  state = createSessionState('rs-1', 1);
  seedRoster(state, ALL_CAR_INDICES);
  driverState = makeDriverState(PLAYER);
});

/** Run the detector and assert it returned a single CONTACT_DETECTED event. */
function expectSingleContact(events: PublisherEvent[]): PublisherEvent {
  const c = events.find(e => e.type === 'CONTACT_DETECTED');
  expect(c, 'expected one CONTACT_DETECTED event').toBeDefined();
  return c!;
}

/**
 * Drive a trigger frame followed by enough idle frames to elapse the 1 s
 * resolution window. Returns the events emitted on the frame that finalises
 * the pending contact (window closed).
 *
 * - `triggerOverrides` shape the trigger frame (sets latAccel etc.)
 * - `windowOverrides`  shape every frame inside the resolution window
 *   (e.g. final speed drop) — applied to the LAST window frame.
 */
function runContactScenario(opts: {
  prev?: ReturnType<typeof makeFrame>;
  triggerOverrides: Parameters<typeof makeFrame>[0];
  windowOverrides?: Parameters<typeof makeFrame>[0];
}): { events: PublisherEvent[]; trigger: ReturnType<typeof makeFrame>; final: ReturnType<typeof makeFrame> } {
  const baseTick = 1000;
  const baseTime = 100;

  const prev = opts.prev ?? makeFrame({ sessionTick: baseTick - 5, sessionTime: baseTime - 0.1, speed: 50 });
  const trigger = makeFrame({
    sessionTick: baseTick,
    sessionTime: baseTime,
    speed:       opts.triggerOverrides?.speed ?? 50,
    ...opts.triggerOverrides,
  });

  // Trigger frame should kick off the pending state but emit nothing.
  const triggerEvents = detectContact(prev, trigger, state, driverState, CTX);
  expect(triggerEvents).toEqual([]);

  // Walk frames every 0.05s for >1 s to elapse the resolution window.
  let lastFrame = trigger;
  let lastEvents: PublisherEvent[] = [];
  for (let i = 1; i <= 25; i++) {
    const t = baseTime + i * 0.05;
    const isFinal = t - baseTime >= CONTACT_RESOLUTION_WINDOW_SEC;
    const f = makeFrame({
      sessionTick: baseTick + i * 5,
      sessionTime: t,
      speed:       opts.windowOverrides?.speed ?? trigger.speed,
      ...opts.windowOverrides,
    });
    const ev = detectContact(lastFrame, f, state, driverState, CTX);
    if (ev.length > 0 || isFinal) {
      lastEvents = ev;
      lastFrame = f;
      break;
    }
    lastFrame = f;
  }

  return { events: lastEvents, trigger, final: lastFrame };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('exceedsContactThresholds', () => {
  it('returns false on a clean frame', () => {
    expect(exceedsContactThresholds(makeFrame())).toBe(false);
  });

  it.each([
    ['latAccel',  { latAccel:  CONTACT_LAT_ACCEL_THRESHOLD  + 1 }],
    ['longAccel', { longAccel: CONTACT_LONG_ACCEL_THRESHOLD + 1 }],
    ['vertAccel', { vertAccel: CONTACT_VERT_ACCEL_THRESHOLD + 1 }],
    ['yawRate',   { yawRate:   CONTACT_YAW_RATE_THRESHOLD   + 0.1 }],
  ] as const)('returns true when %s exceeds threshold', (_name, overrides) => {
    expect(exceedsContactThresholds(makeFrame(overrides))).toBe(true);
  });

  it('treats negative values via absolute value', () => {
    expect(exceedsContactThresholds(makeFrame({ latAccel: -(CONTACT_LAT_ACCEL_THRESHOLD + 1) }))).toBe(true);
  });
});

describe('lapDistPctDistance', () => {
  it('returns straight distance for non-wrap pairs', () => {
    expect(lapDistPctDistance(0.1, 0.15)).toBeCloseTo(0.05, 6);
  });

  it('handles wrap-around at 1.0/0.0 boundary', () => {
    expect(lapDistPctDistance(0.99, 0.01)).toBeCloseTo(0.02, 6);
  });
});

describe('computeContactSeverity', () => {
  const base: PendingContactState = {
    startSessionTime: 0, startTick: 0, speedBefore: 50,
    peakLatAccel: 0, peakLongAccel: 0, peakVertAccel: 0, peakYawRate: 0,
    yawSustainedFrames: 0, cause: 'solo_incident',
    trackSurface: 1, lapDistPct: 0,
  };

  it('returns light when speed barely drops', () => {
    expect(computeContactSeverity({ ...base }, 47)).toBe('light');
  });

  it('returns moderate at 20–50% drop', () => {
    expect(computeContactSeverity({ ...base }, 30)).toBe('moderate');
  });

  it('returns severe when speed drops > 50%', () => {
    expect(computeContactSeverity({ ...base }, 10)).toBe('severe');
  });

  it('returns severe on sustained spin even without big speed drop', () => {
    expect(computeContactSeverity({ ...base, yawSustainedFrames: CONTACT_YAW_SUSTAIN_FRAMES + 1 }, 47))
      .toBe('severe');
  });
});

describe('pushProximitySnapshot', () => {
  it('caps the ring at CONTACT_PROXIMITY_RING_CAPACITY', () => {
    for (let i = 0; i < CONTACT_PROXIMITY_RING_CAPACITY + 5; i++) {
      pushProximitySnapshot(driverState, makeFrame());
    }
    expect(driverState.proximityRing.length).toBe(CONTACT_PROXIMITY_RING_CAPACITY);
  });
});

// ---------------------------------------------------------------------------
// Detector — guards
// ---------------------------------------------------------------------------

describe('detectContact — guards', () => {
  it('returns no events on the first (null prev) frame', () => {
    expect(detectContact(null, makeFrame(), state, driverState, CTX)).toEqual([]);
  });

  it('returns no events when playerCarIdx is unset (sentinel -1)', () => {
    const ctx: ContactDetectorContext = { ...CTX, playerCarIdx: -1 };
    const f = makeFrame();
    expect(detectContact(f, cloneFrame(f), state, driverState, ctx)).toEqual([]);
  });

  it('updates the proximity ring on every call (used by next trigger)', () => {
    detectContact(null, makeFrame(), state, driverState, CTX);
    expect(driverState.proximityRing.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Negative cases
// ---------------------------------------------------------------------------

describe('detectContact — negative cases', () => {
  it('emits zero events on a clean qualifying lap (no thresholds met)', () => {
    let prev: ReturnType<typeof makeFrame> | null = null;
    let events: PublisherEvent[] = [];
    for (let i = 0; i < 60; i++) {
      const f = makeFrame({
        sessionTick: 1000 + i * 5,
        sessionTime: 100 + i * 0.1,
        speed:       55,
        latAccel:    8 * Math.sin(i / 5),  // normal cornering
        longAccel:   -3,                    // gentle braking
      });
      events = events.concat(detectContact(prev, f, state, driverState, CTX));
      prev = f;
    }
    expect(events.filter(e => e.type === 'CONTACT_DETECTED')).toHaveLength(0);
  });

  it('does NOT trigger on hard braking alone (longAccel within threshold)', () => {
    const prev = makeFrame({ sessionTick: 1000, sessionTime: 100, speed: 60, longAccel: -20 });
    const curr = makeFrame({ sessionTick: 1005, sessionTime: 100.1, speed: 55, longAccel: -28 });
    expect(detectContact(prev, curr, state, driverState, CTX)).toEqual([]);
    expect(driverState.pendingContact).toBeNull();
  });

  it('does not re-trigger when prev frame already exceeded thresholds (edge guard)', () => {
    // prev already over-threshold; curr also over → no edge → no new trigger
    const prev = makeFrame({ sessionTick: 1000, sessionTime: 100, speed: 50, latAccel: 30 });
    const curr = makeFrame({ sessionTick: 1005, sessionTime: 100.1, speed: 50, latAccel: 32 });
    expect(detectContact(prev, curr, state, driverState, CTX)).toEqual([]);
    expect(driverState.pendingContact).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Trigger + severity
// ---------------------------------------------------------------------------

describe('detectContact — kerb-strike (solo_incident, light)', () => {
  it('classifies a vertAccel spike with minor speed drop as solo light', () => {
    // Park the player at a unique lapDistPct so the default rivals (lapDistPct=0)
    // are far away and the classifier resolves to solo_incident.
    const aloneCars = [{ carIdx: PLAYER, lapDistPct: 0.42, lapsCompleted: 5 }];
    const prev = makeFrame({ sessionTick: 995, sessionTime: 99.9, speed: 50, cars: aloneCars });
    const { events } = runContactScenario({
      prev,
      triggerOverrides: { speed: 50, vertAccel: CONTACT_VERT_ACCEL_THRESHOLD + 5, cars: aloneCars },
      windowOverrides:  { speed: 47, cars: aloneCars },
    });
    const c = expectSingleContact(events);
    const p = c.payload as ContactDetectedPayload;
    expect(p.cause).toBe('solo_incident');
    expect(p.contactCar).toBeUndefined();
    expect(p.severity).toBe('light');
    expect(p.peakVertAccel).toBeGreaterThanOrEqual(CONTACT_VERT_ACCEL_THRESHOLD);
    expect(p.speedBeforeMps).toBe(50);
    expect(p.speedAfterMps).toBe(47);
  });
});

describe('detectContact — car-to-car contact (moderate)', () => {
  it('classifies a high latAccel hit with a nearby car as car_contact moderate', () => {
    // Place the rival car alongside the player on the proximity grid.
    const playerLapPct = 0.42;
    const rivalLapPct  = playerLapPct + CONTACT_PROXIMITY_LAP_DIST_PCT * 0.5;

    const prev = makeFrame({
      sessionTick: 1000, sessionTime: 100, speed: 60,
      cars: [
        { carIdx: PLAYER, lapDistPct: playerLapPct, lapsCompleted: 5 },
        { carIdx: RIVAL,  lapDistPct: rivalLapPct,  lapsCompleted: 5 },
      ],
    });
    const trigger = makeFrame({
      sessionTick: 1005, sessionTime: 100.1, speed: 60,
      latAccel: CONTACT_LAT_ACCEL_THRESHOLD + 5,
      cars: [
        { carIdx: PLAYER, lapDistPct: playerLapPct, lapsCompleted: 5 },
        { carIdx: RIVAL,  lapDistPct: rivalLapPct,  lapsCompleted: 5 },
      ],
    });

    expect(detectContact(prev, trigger, state, driverState, CTX)).toEqual([]);

    // Final frame: ~35% drop → moderate.
    let lastFrame = trigger;
    let events: PublisherEvent[] = [];
    for (let i = 1; i <= 25; i++) {
      const t = 100.1 + i * 0.05;
      const f = makeFrame({
        sessionTick: 1005 + i * 5,
        sessionTime: t,
        speed:       40,
        cars: [
          { carIdx: PLAYER, lapDistPct: playerLapPct, lapsCompleted: 5 },
          { carIdx: RIVAL,  lapDistPct: rivalLapPct,  lapsCompleted: 5 },
        ],
      });
      events = detectContact(lastFrame, f, state, driverState, CTX);
      if (events.length > 0) break;
      lastFrame = f;
    }

    const c = expectSingleContact(events);
    const p = c.payload as ContactDetectedPayload;
    expect(p.cause).toBe('car_contact');
    expect(p.contactCar?.carIdx).toBe(RIVAL);
    expect(p.severity).toBe('moderate');
  });

  it('classifies as solo_incident when no car is within proximity', () => {
    const playerLapPct = 0.42;
    // Rival far away.
    const farLapPct = 0.6;

    const prev = makeFrame({
      sessionTick: 1000, sessionTime: 100, speed: 60,
      cars: [
        { carIdx: PLAYER, lapDistPct: playerLapPct, lapsCompleted: 5 },
        { carIdx: RIVAL,  lapDistPct: farLapPct,    lapsCompleted: 5 },
      ],
    });
    const trigger = makeFrame({
      sessionTick: 1005, sessionTime: 100.1, speed: 60,
      latAccel: CONTACT_LAT_ACCEL_THRESHOLD + 5,
      cars: [
        { carIdx: PLAYER, lapDistPct: playerLapPct, lapsCompleted: 5 },
        { carIdx: RIVAL,  lapDistPct: farLapPct,    lapsCompleted: 5 },
      ],
    });
    detectContact(prev, trigger, state, driverState, CTX);
    expect(driverState.pendingContact?.cause).toBe('solo_incident');
    expect(driverState.pendingContact?.contactCar).toBeUndefined();
  });

  it('does not classify a lapped car at the same lapDistPct as contact', () => {
    const playerLapPct = 0.42;
    const prev = makeFrame({
      sessionTick: 1000, sessionTime: 100, speed: 60,
      cars: [
        { carIdx: PLAYER, lapDistPct: playerLapPct, lapsCompleted: 5 },
        // Same position on track but a lap down.
        { carIdx: RIVAL,  lapDistPct: playerLapPct, lapsCompleted: 4 },
      ],
    });
    const trigger = makeFrame({
      sessionTick: 1005, sessionTime: 100.1, speed: 60,
      latAccel: CONTACT_LAT_ACCEL_THRESHOLD + 5,
      cars: [
        { carIdx: PLAYER, lapDistPct: playerLapPct, lapsCompleted: 5 },
        { carIdx: RIVAL,  lapDistPct: playerLapPct, lapsCompleted: 4 },
      ],
    });
    detectContact(prev, trigger, state, driverState, CTX);
    expect(driverState.pendingContact?.cause).toBe('solo_incident');
  });
});

describe('detectContact — severe shunt', () => {
  it('classifies a > 50 % speed drop as severe', () => {
    const { events } = runContactScenario({
      triggerOverrides: { speed: 60, latAccel: CONTACT_LAT_ACCEL_THRESHOLD + 10 },
      windowOverrides:  { speed: 20 }, // ~67% drop → severe
    });
    const c = expectSingleContact(events);
    const p = c.payload as ContactDetectedPayload;
    expect(p.severity).toBe('severe');
  });
});

describe('detectContact — sustained spin', () => {
  it('escalates to severe when yawRate sustains over the threshold > 0.5 s', () => {
    const prev = makeFrame({ sessionTick: 1000, sessionTime: 100, speed: 40 });
    // Trigger with high yawRate.
    const trigger = makeFrame({
      sessionTick: 1005, sessionTime: 100.1, speed: 40,
      yawRate: CONTACT_YAW_RATE_THRESHOLD + 0.5,
    });
    expect(detectContact(prev, trigger, state, driverState, CTX)).toEqual([]);

    // Window frames every ~16ms (~60 Hz) so we sustain over CONTACT_YAW_SUSTAIN_FRAMES.
    let lastFrame = trigger;
    let events: PublisherEvent[] = [];
    for (let i = 1; i <= 80; i++) {
      const f = makeFrame({
        sessionTick: 1005 + i,
        sessionTime: 100.1 + i * (1 / 60),
        speed:       38,           // tiny drop → would otherwise be 'light'
        yawRate:     CONTACT_YAW_RATE_THRESHOLD + 0.5,
      });
      events = detectContact(lastFrame, f, state, driverState, CTX);
      lastFrame = f;
      if (events.length > 0) break;
    }
    const c = expectSingleContact(events);
    const p = c.payload as ContactDetectedPayload;
    expect(p.severity).toBe('severe');
    expect(p.peakYawRate).toBeGreaterThanOrEqual(CONTACT_YAW_RATE_THRESHOLD);
  });
});

// ---------------------------------------------------------------------------
// Cooldown
// ---------------------------------------------------------------------------

describe('detectContact — cooldown', () => {
  it('does not re-emit while inside CONTACT_COOLDOWN_TICKS', () => {
    runContactScenario({
      triggerOverrides: { speed: 50, latAccel: CONTACT_LAT_ACCEL_THRESHOLD + 5 },
      windowOverrides:  { speed: 30 },
    });
    expect(driverState.contactDetectedCooldownUntilTick).toBeGreaterThan(0);
    const cooldownTick = driverState.contactDetectedCooldownUntilTick;

    // Try to trigger again before the cooldown expires.
    const prev = makeFrame({ sessionTick: cooldownTick - 50, sessionTime: 200, speed: 50 });
    const curr = makeFrame({
      sessionTick: cooldownTick - 45, sessionTime: 200.1, speed: 50,
      latAccel: CONTACT_LAT_ACCEL_THRESHOLD + 5,
    });
    expect(detectContact(prev, curr, state, driverState, CTX)).toEqual([]);
    expect(driverState.pendingContact).toBeNull();
  });

  it('allows a new trigger after cooldown expires', () => {
    runContactScenario({
      triggerOverrides: { speed: 50, latAccel: CONTACT_LAT_ACCEL_THRESHOLD + 5 },
      windowOverrides:  { speed: 30 },
    });
    const tickAfter = driverState.contactDetectedCooldownUntilTick + 10;
    const prev = makeFrame({ sessionTick: tickAfter,     sessionTime: 300,   speed: 50 });
    const curr = makeFrame({
      sessionTick: tickAfter + 5, sessionTime: 300.1, speed: 50,
      latAccel: CONTACT_LAT_ACCEL_THRESHOLD + 5,
    });
    detectContact(prev, curr, state, driverState, CTX);
    expect(driverState.pendingContact).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Constant sanity
// ---------------------------------------------------------------------------

describe('contact-detector constants', () => {
  it('CONTACT_COOLDOWN_TICKS matches ~5 s @ 60 Hz', () => {
    expect(CONTACT_COOLDOWN_TICKS).toBe(300);
  });
  it('CONTACT_RESOLUTION_WINDOW_SEC equals 1.0', () => {
    expect(CONTACT_RESOLUTION_WINDOW_SEC).toBe(1.0);
  });
});
