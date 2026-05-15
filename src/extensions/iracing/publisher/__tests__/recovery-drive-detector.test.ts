/**
 * recovery-drive-detector.test.ts — Issue #181
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  detectRecoveryDrive,
  RECOVERY_WINDOW_SEC,
  type RecoveryDriveContext,
} from '../driver-publisher/recovery-drive-detector';
import { createSessionState, type SessionState, buildEvent, carRefFromRoster } from '../session-state';
import { type DriverState } from '../driver-state';
import { makeFrame, seedRoster, ALL_CAR_INDICES, makeDriverState } from './frame-fixtures';
import type { PublisherEvent, PublisherEventType } from '../event-types';

const PLAYER = 0;

let state:       SessionState;
let driverState: DriverState;
let ctx:         RecoveryDriveContext;

beforeEach(() => {
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

function frameAt(sessionTime: number, playerPosition: number): ReturnType<typeof makeFrame> {
  return makeFrame({
    sessionTime,
    cars: [{ carIdx: PLAYER, position: playerPosition }],
  });
}

function makeTriggerEvent(type: PublisherEventType, frame: ReturnType<typeof makeFrame>): PublisherEvent {
  const playerRef = carRefFromRoster(state, PLAYER)!;
  return buildEvent(type, playerRef, {} as never, {
    raceSessionId: 'rs-1',
    rigId:         'rig-01',
    frame,
  });
}

describe('detectRecoveryDrive', () => {
  it.each<['PLAYER_STOPPED' | 'OFF_TRACK' | 'CONTACT_DETECTED']>([
    ['PLAYER_STOPPED'],
    ['OFF_TRACK'],
    ['CONTACT_DETECTED'],
  ])('arms recoveryActive on trigger %s', (trigger) => {
    const f = frameAt(100, 10);
    ctx.emittedThisTick.push(makeTriggerEvent(trigger, f));

    const events = detectRecoveryDrive(null, f, state, driverState, ctx);

    expect(events).toEqual([]);
    expect(driverState.recoveryActive).not.toBeNull();
    expect(driverState.recoveryActive!.trigger).toBe(trigger);
    expect(driverState.recoveryActive!.startPosition).toBe(10);
    expect(driverState.recoveryActive!.startedAtSessionTime).toBe(100);
  });

  it('emits RECOVERY_DRIVE when player climbs ≥2 positions within window', () => {
    const f1 = frameAt(100, 12);
    ctx.emittedThisTick = [makeTriggerEvent('PLAYER_STOPPED', f1)];
    detectRecoveryDrive(null, f1, state, driverState, ctx);

    const f2 = frameAt(120, 9); // gained 3
    ctx.emittedThisTick = [];
    const events = detectRecoveryDrive(f1, f2, state, driverState, ctx);

    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.type).toBe('RECOVERY_DRIVE');
    const p = ev.payload as any;
    expect(p.triggerEvent).toBe('PLAYER_STOPPED');
    expect(p.positionsRecovered).toBe(3);
    expect(p.startPosition).toBe(12);
    expect(p.currentPosition).toBe(9);
    expect(p.recoveryDurationSec).toBeCloseTo(20, 5);
    // State cleared on success.
    expect(driverState.recoveryActive).toBeNull();
  });

  it('does NOT fire on natural strategy gains without a trigger', () => {
    const f1 = frameAt(100, 12);
    const e1 = detectRecoveryDrive(null, f1, state, driverState, ctx);
    expect(e1).toEqual([]);
    expect(driverState.recoveryActive).toBeNull();

    const f2 = frameAt(110, 8); // big gain — but no trigger
    const e2 = detectRecoveryDrive(f1, f2, state, driverState, ctx);
    expect(e2).toEqual([]);
  });

  it('clears recoveryActive after window expires without firing', () => {
    const f1 = frameAt(100, 10);
    ctx.emittedThisTick = [makeTriggerEvent('OFF_TRACK', f1)];
    detectRecoveryDrive(null, f1, state, driverState, ctx);
    expect(driverState.recoveryActive).not.toBeNull();

    // Player only gained 1 position — below threshold — past the window.
    const f2 = frameAt(100 + RECOVERY_WINDOW_SEC + 1, 9);
    ctx.emittedThisTick = [];
    const events = detectRecoveryDrive(f1, f2, state, driverState, ctx);

    expect(events).toEqual([]);
    expect(driverState.recoveryActive).toBeNull();
  });

  it('does not double-fire after a successful recovery (state cleared)', () => {
    const f1 = frameAt(100, 12);
    ctx.emittedThisTick = [makeTriggerEvent('CONTACT_DETECTED', f1)];
    detectRecoveryDrive(null, f1, state, driverState, ctx);

    const f2 = frameAt(110, 10);
    ctx.emittedThisTick = [];
    const e2 = detectRecoveryDrive(f1, f2, state, driverState, ctx);
    expect(e2).toHaveLength(1);

    // Further frames with more gains — should NOT emit again.
    const f3 = frameAt(115, 8);
    const e3 = detectRecoveryDrive(f2, f3, state, driverState, ctx);
    expect(e3).toEqual([]);
  });

  it('ignores trigger events for cars other than the player', () => {
    const f = frameAt(100, 10);
    const otherRef = carRefFromRoster(state, 5)!;
    const otherEv = buildEvent('PLAYER_STOPPED', otherRef, {} as never, {
      raceSessionId: 'rs-1',
      rigId:         'rig-01',
      frame:         f,
    });
    ctx.emittedThisTick.push(otherEv);

    const events = detectRecoveryDrive(null, f, state, driverState, ctx);
    expect(events).toEqual([]);
    expect(driverState.recoveryActive).toBeNull();
  });
});
