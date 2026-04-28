/**
 * player-physics-detector.test.ts — Issue #99
 *
 * Covers SPIN_DETECTED, BIG_HIT, SLOW_CAR_AHEAD.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  detectPlayerPhysics,
  SPIN_STEERING_MIN_RAD,
  SPIN_MIN_SPEED_MPS,
  SPIN_SPEED_DROP_RATIO,
  SPIN_COOLDOWN_TICKS,
  BIG_HIT_TORQUE_THRESHOLD,
  BIG_HIT_SPEED_DROP_MPS,
  BIG_HIT_COOLDOWN_TICKS,
  SLOW_CAR_GAP_THRESHOLD_SEC,
  SLOW_CAR_CLOSING_RATE_SEC,
  SLOW_CAR_SPEED_DIFF_MPS,
  SLOW_CAR_MIN_ACTIVE_MPS,
  SLOW_CAR_COOLDOWN_TICKS,
  type PlayerPhysicsDetectorContext,
} from '../player-physics-detector';
import { createSessionState, type SessionState } from '../session-state';
import { makeFrame, cloneFrame } from './frame-fixtures';

const PLAYER = 0;

const CTX: PlayerPhysicsDetectorContext = {
  publisherCode: 'rig-01',
  raceSessionId: 'rs-1',
  playerCarIdx:  PLAYER,
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
  return detectPlayerPhysics(prev, curr, s, ctx);
}

// ---------------------------------------------------------------------------
// Guard conditions
// ---------------------------------------------------------------------------

describe('detectPlayerPhysics — guards', () => {
  it('returns no events on first (null prev) frame', () => {
    expect(detect(null, makeFrame())).toEqual([]);
  });

  it('returns no events when playerCarIdx is not provided', () => {
    const ctx: PlayerPhysicsDetectorContext = { publisherCode: 'rig-01', raceSessionId: 'rs-1' };
    const f = makeFrame();
    expect(detect(f, cloneFrame(f), state, ctx)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SPIN_DETECTED
// ---------------------------------------------------------------------------

/** Make a frame where the player car has a specific steering angle and speed. */
function spinFrame(opts: {
  steeringWheelAngle: number;
  speed: number;
  sessionTick?: number;
}) {
  return makeFrame({
    steeringWheelAngle: opts.steeringWheelAngle,
    speed:              opts.speed,
    sessionTick:        opts.sessionTick ?? 1000,
  });
}

describe('SPIN_DETECTED', () => {
  it('fires on steering reversal + speed drop', () => {
    // prev: turning right at speed, curr: now turning left (reversed) and slowing
    const prevSpeed = 50;
    const f0 = spinFrame({ steeringWheelAngle:  SPIN_STEERING_MIN_RAD + 0.1, speed: prevSpeed });
    const f1 = cloneFrame(f0);
    f1.steeringWheelAngle = -(SPIN_STEERING_MIN_RAD + 0.1); // reversal
    f1.speed              = prevSpeed * (1 - SPIN_SPEED_DROP_RATIO - 0.01); // dropped enough

    const events = detect(f0, f1);
    expect(events.find(e => e.type === 'SPIN_DETECTED')).toBeDefined();
  });

  it('does NOT fire without steering reversal (same sign)', () => {
    const f0 = spinFrame({ steeringWheelAngle: SPIN_STEERING_MIN_RAD + 0.1, speed: 50 });
    const f1 = cloneFrame(f0);
    f1.steeringWheelAngle = SPIN_STEERING_MIN_RAD + 0.2; // same direction, larger
    f1.speed = 46;
    expect(detect(f0, f1).find(e => e.type === 'SPIN_DETECTED')).toBeUndefined();
  });

  it('does NOT fire when steering angles are too small (below SPIN_STEERING_MIN_RAD)', () => {
    const f0 = spinFrame({ steeringWheelAngle:  0.1, speed: 50 });
    const f1 = cloneFrame(f0);
    f1.steeringWheelAngle = -0.1; // reversal but tiny — below min
    f1.speed = 40;
    expect(detect(f0, f1).find(e => e.type === 'SPIN_DETECTED')).toBeUndefined();
  });

  it('does NOT fire when speed drop is below threshold', () => {
    const prevSpeed = 50;
    const f0 = spinFrame({ steeringWheelAngle:  SPIN_STEERING_MIN_RAD + 0.1, speed: prevSpeed });
    const f1 = cloneFrame(f0);
    f1.steeringWheelAngle = -(SPIN_STEERING_MIN_RAD + 0.1);
    f1.speed = prevSpeed * (1 - SPIN_SPEED_DROP_RATIO * 0.5); // not enough drop
    expect(detect(f0, f1).find(e => e.type === 'SPIN_DETECTED')).toBeUndefined();
  });

  it('does NOT fire when speed is below SPIN_MIN_SPEED_MPS', () => {
    const f0 = spinFrame({ steeringWheelAngle: SPIN_STEERING_MIN_RAD + 0.1, speed: SPIN_MIN_SPEED_MPS - 1 });
    const f1 = cloneFrame(f0);
    f1.steeringWheelAngle = -(SPIN_STEERING_MIN_RAD + 0.1);
    f1.speed = 0;
    expect(detect(f0, f1).find(e => e.type === 'SPIN_DETECTED')).toBeUndefined();
  });

  it('respects cooldown — does not re-fire within cooldown window', () => {
    const prevSpeed = 50;
    const f0 = spinFrame({ steeringWheelAngle:  SPIN_STEERING_MIN_RAD + 0.1, speed: prevSpeed, sessionTick: 1000 });
    const f1 = cloneFrame(f0);
    f1.steeringWheelAngle = -(SPIN_STEERING_MIN_RAD + 0.1);
    f1.speed              = prevSpeed * (1 - SPIN_SPEED_DROP_RATIO - 0.01);
    f1.sessionTick        = 1000;

    detect(f0, f1); // fires — sets cooldown to 1000 + SPIN_COOLDOWN_TICKS

    // Next frame within cooldown
    const f2 = cloneFrame(f1);
    f2.sessionTick = 1001;
    expect(detect(f1, f2).find(e => e.type === 'SPIN_DETECTED')).toBeUndefined();
  });

  it('can re-fire after cooldown expires', () => {
    const prevSpeed = 50;
    const f0 = spinFrame({ steeringWheelAngle:  SPIN_STEERING_MIN_RAD + 0.1, speed: prevSpeed, sessionTick: 1000 });
    const f1 = cloneFrame(f0);
    f1.steeringWheelAngle = -(SPIN_STEERING_MIN_RAD + 0.1);
    f1.speed              = prevSpeed * (1 - SPIN_SPEED_DROP_RATIO - 0.01);
    f1.sessionTick        = 1000;

    detect(f0, f1); // fires

    // Past cooldown
    const f2 = cloneFrame(f0);
    f2.steeringWheelAngle = -(SPIN_STEERING_MIN_RAD + 0.1);
    f2.speed              = prevSpeed * (1 - SPIN_SPEED_DROP_RATIO - 0.01);
    f2.sessionTick        = 1000 + SPIN_COOLDOWN_TICKS;

    expect(detect(f0, f2).find(e => e.type === 'SPIN_DETECTED')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// BIG_HIT
// ---------------------------------------------------------------------------

describe('BIG_HIT', () => {
  it('fires when torque spike + speed crash both occur', () => {
    const f0 = makeFrame({ speed: 80, steeringWheelPctTorque: 0.1, sessionTick: 1000 });
    const f1 = cloneFrame(f0);
    f1.steeringWheelPctTorque = BIG_HIT_TORQUE_THRESHOLD + 0.01;
    f1.speed = 80 - BIG_HIT_SPEED_DROP_MPS - 1;
    expect(detect(f0, f1).find(e => e.type === 'BIG_HIT')).toBeDefined();
  });

  it('does NOT fire on torque spike alone (no speed drop)', () => {
    const f0 = makeFrame({ speed: 80, steeringWheelPctTorque: 0.1 });
    const f1 = cloneFrame(f0);
    f1.steeringWheelPctTorque = BIG_HIT_TORQUE_THRESHOLD + 0.01;
    f1.speed = 80; // no drop
    expect(detect(f0, f1).find(e => e.type === 'BIG_HIT')).toBeUndefined();
  });

  it('does NOT fire on speed drop alone (no torque spike)', () => {
    const f0 = makeFrame({ speed: 80, steeringWheelPctTorque: 0.1 });
    const f1 = cloneFrame(f0);
    f1.steeringWheelPctTorque = BIG_HIT_TORQUE_THRESHOLD - 0.1; // below threshold
    f1.speed = 80 - BIG_HIT_SPEED_DROP_MPS - 1;
    expect(detect(f0, f1).find(e => e.type === 'BIG_HIT')).toBeUndefined();
  });

  it('respects cooldown', () => {
    const f0 = makeFrame({ speed: 80, steeringWheelPctTorque: 0.1, sessionTick: 1000 });
    const f1 = cloneFrame(f0);
    f1.steeringWheelPctTorque = BIG_HIT_TORQUE_THRESHOLD + 0.01;
    f1.speed = 80 - BIG_HIT_SPEED_DROP_MPS - 1;
    f1.sessionTick = 1000;
    detect(f0, f1); // fires

    const f2 = cloneFrame(f1);
    f2.sessionTick = 1001;
    expect(detect(f1, f2).find(e => e.type === 'BIG_HIT')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SLOW_CAR_AHEAD
// ---------------------------------------------------------------------------

describe('SLOW_CAR_AHEAD', () => {
  /** Build a frame with player at position 2, target car at position 1, with
   *  the player closing and the target being slow. */
  function slowCarScenario(opts: {
    playerSpeed?: number;
    targetSpeed?: number;
    currGap?: number;
    prevGap?: number;
    sessionTick?: number;
  } = {}) {
    const playerSpeed  = opts.playerSpeed  ?? SLOW_CAR_MIN_ACTIVE_MPS + 10;
    const targetSpeed  = opts.targetSpeed  ?? playerSpeed - SLOW_CAR_SPEED_DIFF_MPS - 2;
    const currGap      = opts.currGap      ?? SLOW_CAR_GAP_THRESHOLD_SEC * 0.5;
    const prevGap      = opts.prevGap      ?? currGap + SLOW_CAR_CLOSING_RATE_SEC + 0.01;
    const tick         = opts.sessionTick  ?? 1000;

    const f0 = makeFrame({
      sessionTick: tick,
      cars: [
        { carIdx: PLAYER, position: 2 },
        { carIdx: 1,      position: 1 },
      ],
    });
    f0.carIdxF2Time[PLAYER]  = prevGap;
    f0.carIdxSpeed[PLAYER]   = playerSpeed;
    f0.carIdxSpeed[1]        = targetSpeed;
    f0.speed                 = playerSpeed;

    const f1 = cloneFrame(f0);
    f1.carIdxF2Time[PLAYER]  = currGap;
    f1.carIdxSpeed[PLAYER]   = playerSpeed;
    f1.carIdxSpeed[1]        = targetSpeed;
    f1.speed                 = playerSpeed;
    f1.sessionTick           = tick;

    return { f0, f1 };
  }

  it('fires when closing on a significantly slower car', () => {
    const { f0, f1 } = slowCarScenario();
    const events = detect(f0, f1);
    const ev = events.find(e => e.type === 'SLOW_CAR_AHEAD');
    expect(ev).toBeDefined();
    expect(ev!.payload).toMatchObject({ targetCarIdx: 1 });
  });

  it('closingRateMps reflects playerSpeed - targetSpeed', () => {
    const { f0, f1 } = slowCarScenario({ playerSpeed: 50, targetSpeed: 30 });
    const ev = detect(f0, f1).find(e => e.type === 'SLOW_CAR_AHEAD');
    expect(ev).toBeDefined();
    expect((ev!.payload as { closingRateMps: number }).closingRateMps).toBeCloseTo(20);
  });

  it('does NOT fire when player speed is below MIN_ACTIVE', () => {
    const { f0, f1 } = slowCarScenario({
      playerSpeed: SLOW_CAR_MIN_ACTIVE_MPS - 1,
      targetSpeed: 5,
    });
    expect(detect(f0, f1).find(e => e.type === 'SLOW_CAR_AHEAD')).toBeUndefined();
  });

  it('does NOT fire when gap is not closing fast enough', () => {
    const { f0, f1 } = slowCarScenario({
      prevGap: SLOW_CAR_GAP_THRESHOLD_SEC * 0.5 + SLOW_CAR_CLOSING_RATE_SEC * 0.5, // tiny change
      currGap: SLOW_CAR_GAP_THRESHOLD_SEC * 0.5,
    });
    // Override so closing rate is below threshold
    f0.carIdxF2Time[PLAYER] = SLOW_CAR_GAP_THRESHOLD_SEC * 0.5 + SLOW_CAR_CLOSING_RATE_SEC * 0.4;
    f1.carIdxF2Time[PLAYER] = SLOW_CAR_GAP_THRESHOLD_SEC * 0.5;
    expect(detect(f0, f1).find(e => e.type === 'SLOW_CAR_AHEAD')).toBeUndefined();
  });

  it('does NOT fire when player is in the lead (position 1)', () => {
    const f0 = makeFrame({ cars: [{ carIdx: PLAYER, position: 1 }] });
    f0.carIdxF2Time[PLAYER] = 0.5;
    f0.speed = 50;
    const f1 = cloneFrame(f0);
    f1.carIdxF2Time[PLAYER] = 0.1;
    f1.speed = 50;
    expect(detect(f0, f1).find(e => e.type === 'SLOW_CAR_AHEAD')).toBeUndefined();
  });

  it('does NOT fire when gap > threshold', () => {
    const { f0, f1 } = slowCarScenario({
      currGap: SLOW_CAR_GAP_THRESHOLD_SEC + 1, // too far
    });
    expect(detect(f0, f1).find(e => e.type === 'SLOW_CAR_AHEAD')).toBeUndefined();
  });

  it('respects cooldown', () => {
    const { f0, f1 } = slowCarScenario({ sessionTick: 1000 });
    detect(f0, f1); // fires — sets cooldown

    const f2 = cloneFrame(f1);
    f2.sessionTick = 1001;
    expect(detect(f1, f2).find(e => e.type === 'SLOW_CAR_AHEAD')).toBeUndefined();
  });

  it('can re-fire after cooldown expires', () => {
    const { f0, f1 } = slowCarScenario({ sessionTick: 1000 });
    detect(f0, f1); // fires

    const { f0: f0b, f1: f1b } = slowCarScenario({ sessionTick: 1000 + SLOW_CAR_COOLDOWN_TICKS });
    expect(detect(f0b, f1b).find(e => e.type === 'SLOW_CAR_AHEAD')).toBeDefined();
  });
});
