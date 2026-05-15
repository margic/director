/**
 * being-passed-while-stopped-detector.test.ts — Issue #181
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  detectBeingPassedWhileStopped,
  _resetBeingPassedWhileStoppedState,
  type BeingPassedWhileStoppedContext,
} from '../driver-publisher/being-passed-while-stopped-detector';
import { createSessionState, type SessionState, buildEvent, carRefFromRoster } from '../session-state';
import { type DriverState } from '../driver-state';
import { makeFrame, seedRoster, ALL_CAR_INDICES, makeDriverState } from './frame-fixtures';
import type { PublisherEvent, OverallPositionChangePayload } from '../event-types';

const PLAYER = 0;
const RIVAL  = 7;

let state:       SessionState;
let driverState: DriverState;
let ctx:         BeingPassedWhileStoppedContext;

beforeEach(() => {
  _resetBeingPassedWhileStoppedState();
  state = createSessionState('rs-1', 1);
  seedRoster(state, ALL_CAR_INDICES);
  driverState = makeDriverState(PLAYER);
  ctx = {
    rigId:           'rig-01',
    raceSessionId:   'rs-1',
    playerCarIdx:    PLAYER,
    emittedThisTick: [],
  };
});

function makeOvertakeLossEvent(frame: ReturnType<typeof makeFrame>): PublisherEvent {
  const overtakingCar = carRefFromRoster(state, RIVAL)!;
  const playerRef     = carRefFromRoster(state, PLAYER)!;
  const payload: OverallPositionChangePayload = {
    previousPosition: 5,
    newPosition:      6,
    reason:           'overtake',
    overtakingCar,
  };
  return buildEvent('OVERALL_POSITION_LOSS', playerRef, payload, {
    raceSessionId: 'rs-1',
    rigId:         'rig-01',
    frame,
  });
}

describe('detectBeingPassedWhileStopped', () => {
  it('emits BEING_PASSED_WHILE_STOPPED when player is stopped and an overtake loss occurs', () => {
    const frame = makeFrame({ sessionTime: 100 });
    driverState.isStoppedBySpeed         = true;
    driverState.stoppedBySpeedStartTime  = 95;
    ctx.emittedThisTick.push(makeOvertakeLossEvent(frame));

    const events = detectBeingPassedWhileStopped(null, frame, state, driverState, ctx);

    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.type).toBe('BEING_PASSED_WHILE_STOPPED');
    const p = ev.payload as any;
    expect(p.positionsLostThisStop).toBe(1);
    expect(p.secondsStopped).toBeCloseTo(5, 5);
    expect(p.overtakingCar.carIdx).toBe(RIVAL);
  });

  it('increments positionsLostThisStop across multiple overtakes within one stop episode', () => {
    const f1 = makeFrame({ sessionTime: 100 });
    driverState.isStoppedBySpeed        = true;
    driverState.stoppedBySpeedStartTime = 99;
    ctx.emittedThisTick.push(makeOvertakeLossEvent(f1));
    const e1 = detectBeingPassedWhileStopped(null, f1, state, driverState, ctx);
    expect((e1[0]!.payload as any).positionsLostThisStop).toBe(1);

    const f2 = makeFrame({ sessionTime: 102 });
    ctx.emittedThisTick = [makeOvertakeLossEvent(f2)];
    const e2 = detectBeingPassedWhileStopped(f1, f2, state, driverState, ctx);
    expect((e2[0]!.payload as any).positionsLostThisStop).toBe(2);

    const f3 = makeFrame({ sessionTime: 104 });
    ctx.emittedThisTick = [makeOvertakeLossEvent(f3), makeOvertakeLossEvent(f3)];
    const e3 = detectBeingPassedWhileStopped(f2, f3, state, driverState, ctx);
    expect(e3).toHaveLength(2);
    expect((e3[0]!.payload as any).positionsLostThisStop).toBe(3);
    expect((e3[1]!.payload as any).positionsLostThisStop).toBe(4);
  });

  it('does NOT fire when the player is not stopped', () => {
    const frame = makeFrame({ sessionTime: 100 });
    driverState.isStoppedBySpeed = false;
    ctx.emittedThisTick.push(makeOvertakeLossEvent(frame));

    const events = detectBeingPassedWhileStopped(null, frame, state, driverState, ctx);

    expect(events).toEqual([]);
    expect(driverState.positionsLostThisStop).toBe(0);
  });

  it('resets positionsLostThisStop when the player resumes (stopped → moving edge)', () => {
    // Stopped frame with one loss.
    const f1 = makeFrame({ sessionTime: 100 });
    driverState.isStoppedBySpeed        = true;
    driverState.stoppedBySpeedStartTime = 99;
    ctx.emittedThisTick.push(makeOvertakeLossEvent(f1));
    detectBeingPassedWhileStopped(null, f1, state, driverState, ctx);
    expect(driverState.positionsLostThisStop).toBe(1);

    // Player resumes — counter resets, no event.
    const f2 = makeFrame({ sessionTime: 105 });
    driverState.isStoppedBySpeed = false;
    ctx.emittedThisTick = [];
    const e2 = detectBeingPassedWhileStopped(f1, f2, state, driverState, ctx);
    expect(e2).toEqual([]);
    expect(driverState.positionsLostThisStop).toBe(0);

    // New stop episode — counter starts fresh.
    const f3 = makeFrame({ sessionTime: 200 });
    driverState.isStoppedBySpeed        = true;
    driverState.stoppedBySpeedStartTime = 198;
    ctx.emittedThisTick = [makeOvertakeLossEvent(f3)];
    const e3 = detectBeingPassedWhileStopped(f2, f3, state, driverState, ctx);
    expect((e3[0]!.payload as any).positionsLostThisStop).toBe(1);
  });

  it('ignores non-overtake position losses (e.g. pit_cycle)', () => {
    const frame = makeFrame({ sessionTime: 100 });
    driverState.isStoppedBySpeed        = true;
    driverState.stoppedBySpeedStartTime = 99;

    const playerRef = carRefFromRoster(state, PLAYER)!;
    const pitLoss = buildEvent('OVERALL_POSITION_LOSS', playerRef, {
      previousPosition: 5,
      newPosition:      6,
      reason:           'pit_cycle',
    } as OverallPositionChangePayload, {
      raceSessionId: 'rs-1',
      rigId:         'rig-01',
      frame,
    });
    ctx.emittedThisTick.push(pitLoss);

    const events = detectBeingPassedWhileStopped(null, frame, state, driverState, ctx);
    expect(events).toEqual([]);
    expect(driverState.positionsLostThisStop).toBe(0);
  });

  it('returns no events when there are no OVERALL_POSITION_LOSS events this tick', () => {
    const frame = makeFrame({ sessionTime: 100 });
    driverState.isStoppedBySpeed        = true;
    driverState.stoppedBySpeedStartTime = 99;
    ctx.emittedThisTick = [];

    const events = detectBeingPassedWhileStopped(null, frame, state, driverState, ctx);
    expect(events).toEqual([]);
  });
});
