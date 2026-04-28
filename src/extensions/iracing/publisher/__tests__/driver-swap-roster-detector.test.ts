/**
 * driver-swap-roster-detector.test.ts — Issue #101
 *
 * Unit tests for detectDriverSwapAndRoster:
 *   - DRIVER_SWAP_COMPLETED fires on pit exit while swap is pending
 *   - DRIVER_SWAP_COMPLETED does NOT fire when no swap is pending
 *   - DRIVER_SWAP_COMPLETED includes correct payload (duration, names, stintNumber)
 *   - Swap state is cleared after completion
 *   - ROSTER_UPDATED fires when cars are added/removed
 *   - ROSTER_UPDATED does NOT fire on first-call seed
 *   - ROSTER_UPDATED does NOT fire when roster is unchanged
 *   - ROSTER_UPDATED fires with correct added/removed arrays
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  detectDriverSwapAndRoster,
  type DriverSwapRosterContext,
} from '../driver-swap-roster-detector';
import { createSessionState, type SessionState } from '../session-state';
import type { PublisherCarRef } from '../event-types';
import { makeFrame, cloneFrame, withPitExit } from './frame-fixtures';

const CTX: DriverSwapRosterContext = {
  publisherCode: 'rig-01',
  raceSessionId: 'rs-1',
  playerCarIdx:  0,
};

let state: SessionState;
beforeEach(() => { state = createSessionState('rs-1', 1); });

function detect(
  prev: ReturnType<typeof makeFrame> | null,
  curr: ReturnType<typeof makeFrame>,
  s = state,
  ctx = CTX,
) {
  return detectDriverSwapAndRoster(prev, curr, s, ctx);
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

describe('detectDriverSwapAndRoster — seeding', () => {
  it('returns no events on first (null prev) frame', () => {
    expect(detect(null, makeFrame())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DRIVER_SWAP_COMPLETED
// ---------------------------------------------------------------------------

describe('DRIVER_SWAP_COMPLETED', () => {
  function pendingSwapState(s: SessionState, sessionTimeAtInitiation = 100): void {
    s.driverSwapPending = true;
    s.pendingSwapOutgoingDriverId = 'driver-out';
    s.pendingSwapIncomingDriverId = 'driver-in';
    s.pendingSwapIncomingDriverName = 'Alice Incoming';
    s.pendingSwapInitiatedSessionTime = sessionTimeAtInitiation;
    s.playerStintNumber = 1;
  }

  it('fires when player car exits pits while swap is pending', () => {
    pendingSwapState(state, 100);

    const f0 = makeFrame({ cars: [{ carIdx: 0 }] });
    f0.carIdxOnPitRoad[0] = 1; // on pit road
    const f1 = withPitExit(0)(f0); // exits pit road
    f1.sessionTime = 145;

    const events = detect(f0, f1);
    const ev = events.find(e => e.type === 'DRIVER_SWAP_COMPLETED');
    expect(ev).toBeDefined();
    expect(ev!.payload).toMatchObject({
      incomingDriverId:    'driver-in',
      incomingDriverName:  'Alice Incoming',
      stintNumberStarting: 2, // incremented from 1
    });
    expect((ev!.payload as any).swapDurationSec).toBeCloseTo(45, 1); // 145 - 100
  });

  it('does NOT fire when no swap is pending', () => {
    // driverSwapPending = false (default)
    const f0 = makeFrame();
    f0.carIdxOnPitRoad[0] = 1;
    const f1 = withPitExit(0)(f0);
    const events = detect(f0, f1);
    expect(events.find(e => e.type === 'DRIVER_SWAP_COMPLETED')).toBeUndefined();
  });

  it('does NOT fire when car stays on pit road', () => {
    pendingSwapState(state);
    const f0 = makeFrame();
    f0.carIdxOnPitRoad[0] = 1;
    const f1 = cloneFrame(f0); // still on pit road
    const events = detect(f0, f1);
    expect(events.find(e => e.type === 'DRIVER_SWAP_COMPLETED')).toBeUndefined();
  });

  it('does NOT fire when car was never on pit road', () => {
    pendingSwapState(state);
    const f0 = makeFrame(); // carIdxOnPitRoad[0] = 0
    const f1 = cloneFrame(f0);
    const events = detect(f0, f1);
    expect(events.find(e => e.type === 'DRIVER_SWAP_COMPLETED')).toBeUndefined();
  });

  it('clears driverSwapPending after DRIVER_SWAP_COMPLETED', () => {
    pendingSwapState(state, 0);
    const f0 = makeFrame(); f0.carIdxOnPitRoad[0] = 1;
    const f1 = withPitExit(0)(f0);
    detect(f0, f1);
    expect(state.driverSwapPending).toBe(false);
    expect(state.pendingSwapIncomingDriverId).toBe('');
    expect(state.pendingSwapIncomingDriverName).toBe('');
    expect(state.pendingSwapOutgoingDriverId).toBe('');
    expect(state.pendingSwapInitiatedSessionTime).toBe(0);
  });

  it('increments playerStintNumber on each completed swap', () => {
    pendingSwapState(state);
    const f0 = makeFrame(); f0.carIdxOnPitRoad[0] = 1;
    const f1 = withPitExit(0)(f0);
    detect(f0, f1);
    expect(state.playerStintNumber).toBe(2);

    // Second swap
    state.driverSwapPending = true;
    state.pendingSwapIncomingDriverId = 'driver-in-2';
    state.pendingSwapIncomingDriverName = 'Bob Next';
    state.pendingSwapInitiatedSessionTime = f1.sessionTime;
    const f2 = cloneFrame(f1); f2.carIdxOnPitRoad[0] = 1;
    const f3 = withPitExit(0)(f2);
    const events2 = detect(f2, f3);
    const ev2 = events2.find(e => e.type === 'DRIVER_SWAP_COMPLETED');
    expect((ev2!.payload as any).stintNumberStarting).toBe(3);
    expect(state.playerStintNumber).toBe(3);
  });

  it('sets swapDurationSec to 0 when initiatedSessionTime is 0', () => {
    pendingSwapState(state, 0);
    const f0 = makeFrame({ sessionTime: 50 }); f0.carIdxOnPitRoad[0] = 1;
    const f1 = withPitExit(0)(f0); f1.sessionTime = 75;
    const events = detect(f0, f1);
    // initiatedSessionTime = 0 → guard in detector returns 0 (unknown start time)
    expect((events.find(e => e.type === 'DRIVER_SWAP_COMPLETED')!.payload as any).swapDurationSec).toBe(0);
  });

  it('resets stintStartLap and firedStintMilestones for player after swap', () => {
    pendingSwapState(state);
    const f0 = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 10 }] });
    f0.carIdxOnPitRoad[0] = 1;
    const f1 = withPitExit(0)(f0);
    f1.carIdxLapCompleted[0] = 10;
    detect(f0, f1);
    const cs = state.carStates.get(0);
    if (cs) {
      expect(cs.stintStartLap).toBe(10);
      expect(cs.firedStintMilestones.size).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// ROSTER_UPDATED
// ---------------------------------------------------------------------------

function ref(carIdx: number, driverName = `driver-${carIdx}`): PublisherCarRef {
  return { carIdx, carNumber: String(carIdx), driverName };
}

describe('ROSTER_UPDATED', () => {
  it('does NOT emit on first-call seed (empty knownRoster → populated)', () => {
    const roster = new Map([[0, ref(0)], [1, ref(1)]]);
    const f0 = makeFrame();
    const f1 = cloneFrame(f0);
    const events = detect(f0, f1, state, { ...CTX, currentRoster: roster });
    expect(events.find(e => e.type === 'ROSTER_UPDATED')).toBeUndefined();
    expect(state.knownRoster.size).toBe(2);
  });

  it('does NOT emit when roster is unchanged', () => {
    const roster = new Map([[0, ref(0)], [1, ref(1)]]);
    const f0 = makeFrame(); const f1 = cloneFrame(f0);
    detect(f0, f1, state, { ...CTX, currentRoster: roster }); // seed

    const f2 = cloneFrame(f1); const f3 = cloneFrame(f2);
    const events = detect(f2, f3, state, { ...CTX, currentRoster: new Map(roster) });
    expect(events.find(e => e.type === 'ROSTER_UPDATED')).toBeUndefined();
  });

  it('fires when a new car is added', () => {
    const initial = new Map([[0, ref(0)]]);
    const f0 = makeFrame(); const f1 = cloneFrame(f0);
    detect(f0, f1, state, { ...CTX, currentRoster: initial }); // seed

    const updated = new Map([[0, ref(0)], [5, ref(5)]]);
    const f2 = cloneFrame(f1); const f3 = cloneFrame(f2);
    const events = detect(f2, f3, state, { ...CTX, currentRoster: updated });
    const ev = events.find(e => e.type === 'ROSTER_UPDATED');
    expect(ev).toBeDefined();
    expect((ev!.payload as any).added).toHaveLength(1);
    expect((ev!.payload as any).added[0].carIdx).toBe(5);
    expect((ev!.payload as any).removed).toHaveLength(0);
  });

  it('fires when a car is removed', () => {
    const initial = new Map([[0, ref(0)], [3, ref(3)]]);
    const f0 = makeFrame(); const f1 = cloneFrame(f0);
    detect(f0, f1, state, { ...CTX, currentRoster: initial }); // seed

    const updated = new Map([[0, ref(0)]]); // car 3 dropped
    const f2 = cloneFrame(f1); const f3 = cloneFrame(f2);
    const events = detect(f2, f3, state, { ...CTX, currentRoster: updated });
    const ev = events.find(e => e.type === 'ROSTER_UPDATED');
    expect(ev).toBeDefined();
    expect((ev!.payload as any).removed[0].carIdx).toBe(3);
    expect((ev!.payload as any).added).toHaveLength(0);
  });

  it('fires with both added and removed in a single diff', () => {
    const initial = new Map([[1, ref(1)], [2, ref(2)]]);
    const f0 = makeFrame(); const f1 = cloneFrame(f0);
    detect(f0, f1, state, { ...CTX, currentRoster: initial });

    const updated = new Map([[2, ref(2)], [7, ref(7)]]); // 1 removed, 7 added
    const f2 = cloneFrame(f1); const f3 = cloneFrame(f2);
    const events = detect(f2, f3, state, { ...CTX, currentRoster: updated });
    const ev = events.find(e => e.type === 'ROSTER_UPDATED');
    expect((ev!.payload as any).added.map((r: PublisherCarRef) => r.carIdx)).toContain(7);
    expect((ev!.payload as any).removed.map((r: PublisherCarRef) => r.carIdx)).toContain(1);
  });

  it('updates knownRoster snapshot after emitting', () => {
    const initial = new Map([[0, ref(0)]]);
    const f0 = makeFrame(); const f1 = cloneFrame(f0);
    detect(f0, f1, state, { ...CTX, currentRoster: initial });

    const updated = new Map([[0, ref(0)], [9, ref(9)]]);
    const f2 = cloneFrame(f1); const f3 = cloneFrame(f2);
    detect(f2, f3, state, { ...CTX, currentRoster: updated });
    expect(state.knownRoster.has(9)).toBe(true);
  });

  it('does not emit when currentRoster is undefined (skip)', () => {
    const roster = new Map([[0, ref(0)]]);
    const f0 = makeFrame(); const f1 = cloneFrame(f0);
    detect(f0, f1, state, { ...CTX, currentRoster: roster });

    // Next frame: no currentRoster passed
    const f2 = cloneFrame(f1); const f3 = cloneFrame(f2);
    const events = detect(f2, f3, state, { ...CTX }); // no currentRoster
    expect(events.find(e => e.type === 'ROSTER_UPDATED')).toBeUndefined();
  });
});
