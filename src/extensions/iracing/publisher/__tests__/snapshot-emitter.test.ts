/**
 * snapshot-emitter.test.ts — Issue #179
 *
 * Validates DRIVER_STATE_SNAPSHOT cadence, forced-flush triggers, payload
 * shape, and the recentEvents ring buffer cap on DriverState.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSnapshot,
  maybeBuildSnapshot,
  findForcedTrigger,
  isCadenceElapsed,
  deriveFlag,
  DEFAULT_SNAPSHOT_INTERVAL_SEC,
  SNAPSHOT_RECENT_EVENTS_LIMIT,
} from '../driver-publisher/snapshot-emitter';
import {
  createDriverState,
  pushRecentEvent,
  RECENT_EVENTS_CAPACITY,
} from '../driver-state';
import { createSessionState, buildEvent, getOrCreateCarState } from '../session-state';
import type { PublisherEvent, PublisherEventType } from '../event-types';
import { makeFrame, seedRoster, FlagBits } from './frame-fixtures';

const PLAYER = 0;
const ctx = { rigId: 'r1', raceSessionId: 's1', playerCarIdx: PLAYER };

function makeRosteredState() {
  const state = createSessionState('s1', 1);
  seedRoster(state, [PLAYER, 1, 2]);
  state.estimatedStintLaps = 30;
  return state;
}

function makeFakeEvent(type: PublisherEventType, sessionTime = 1): PublisherEvent {
  const frame = makeFrame({ sessionTime, cars: [{ carIdx: PLAYER, position: 5 }] });
  return buildEvent(
    type as any,
    { carIdx: PLAYER, carNumber: '0', driverName: 'Driver 0' },
    {} as any,
    { raceSessionId: 's1', rigId: 'r1', frame },
  );
}

// ---------------------------------------------------------------------------
// pushRecentEvent — ring buffer
// ---------------------------------------------------------------------------

describe('pushRecentEvent ring buffer', () => {
  it('appends events in order', () => {
    const ds = createDriverState(PLAYER);
    pushRecentEvent(ds, makeFakeEvent('OFF_TRACK', 1));
    pushRecentEvent(ds, makeFakeEvent('OVERTAKE', 2));
    expect(ds.recentEvents).toHaveLength(2);
    expect(ds.recentEvents[0].type).toBe('OFF_TRACK');
    expect(ds.recentEvents[1].type).toBe('OVERTAKE');
  });

  it('caps at RECENT_EVENTS_CAPACITY (50) and drops oldest', () => {
    const ds = createDriverState(PLAYER);
    for (let i = 0; i < RECENT_EVENTS_CAPACITY + 10; i++) {
      pushRecentEvent(ds, makeFakeEvent('LAP_COMPLETED', i));
    }
    expect(ds.recentEvents).toHaveLength(RECENT_EVENTS_CAPACITY);
    // Oldest 10 should have been shifted out — first remaining should be sessionTime=10.
    expect(ds.recentEvents[0].sessionTime).toBe(10);
    expect(ds.recentEvents[ds.recentEvents.length - 1].sessionTime).toBe(RECENT_EVENTS_CAPACITY + 10 - 1);
  });

  it('skips DRIVER_STATE_SNAPSHOT to avoid recursion', () => {
    const ds = createDriverState(PLAYER);
    pushRecentEvent(ds, makeFakeEvent('DRIVER_STATE_SNAPSHOT', 1));
    expect(ds.recentEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findForcedTrigger
// ---------------------------------------------------------------------------

describe('findForcedTrigger', () => {
  it('returns the first HIGH_PRIORITY event in the batch', () => {
    const t = findForcedTrigger([makeFakeEvent('OFF_TRACK'), makeFakeEvent('RACE_GREEN')]);
    expect(t?.type).toBe('RACE_GREEN');
  });

  it('returns PIT_ENTRY/PIT_EXIT/DRIVER_SWAP_COMPLETED forced triggers', () => {
    expect(findForcedTrigger([makeFakeEvent('PIT_ENTRY')])?.type).toBe('PIT_ENTRY');
    expect(findForcedTrigger([makeFakeEvent('PIT_EXIT')])?.type).toBe('PIT_EXIT');
    expect(findForcedTrigger([makeFakeEvent('DRIVER_SWAP_COMPLETED')])?.type).toBe('DRIVER_SWAP_COMPLETED');
  });

  it('returns null when no triggers present', () => {
    expect(findForcedTrigger([makeFakeEvent('LAP_COMPLETED'), makeFakeEvent('OVERTAKE')])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isCadenceElapsed
// ---------------------------------------------------------------------------

describe('isCadenceElapsed', () => {
  it('returns true on first call (lastSnapshotSessionTime = -Infinity)', () => {
    const ds = createDriverState(PLAYER);
    const frame = makeFrame({ sessionTime: 0 });
    expect(isCadenceElapsed(ds, frame, 15)).toBe(true);
  });

  it('returns false before interval elapses', () => {
    const ds = createDriverState(PLAYER);
    ds.lastSnapshotSessionTime = 100;
    const frame = makeFrame({ sessionTime: 110 });
    expect(isCadenceElapsed(ds, frame, 15)).toBe(false);
  });

  it('returns true when interval reached exactly', () => {
    const ds = createDriverState(PLAYER);
    ds.lastSnapshotSessionTime = 100;
    const frame = makeFrame({ sessionTime: 115 });
    expect(isCadenceElapsed(ds, frame, 15)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildSnapshot — payload shape
// ---------------------------------------------------------------------------

describe('buildSnapshot payload', () => {
  it('returns null when player car not in roster', () => {
    const state = createSessionState('s1', 1); // no roster seeded
    const ds = createDriverState(PLAYER);
    const frame = makeFrame({ sessionTime: 1 });
    expect(buildSnapshot(frame, state, ds, ctx, 'cadence')).toBeNull();
  });

  it('produces a well-formed snapshot with identity, state, and metadata', () => {
    const state = makeRosteredState();
    const ds = createDriverState(PLAYER);
    const frame = makeFrame({
      sessionTime: 100,
      fuelLevel: 42.5,
      sessionFlags: FlagBits.Green,
      cars: [
        { carIdx: PLAYER, position: 5, classPosition: 3, lapDistPct: 0.45, lapsCompleted: 12 },
        { carIdx: 1, position: 4 },
        { carIdx: 2, position: 6 },
      ],
    });

    const snap = buildSnapshot(frame, state, ds, ctx, 'cadence');
    expect(snap).not.toBeNull();
    expect(snap!.type).toBe('DRIVER_STATE_SNAPSHOT');

    const p = snap!.payload as any;
    expect(p.reason).toBe('cadence');
    expect(p.driverName).toBe('Driver 0');
    expect(p.carIdx).toBe(0);
    expect(p.position).toBe(5);
    expect(p.classPosition).toBe(3);
    expect(p.lap).toBe(12);
    expect(p.lapDistPct).toBeCloseTo(0.45);
    expect(p.fuelLevel).toBe(42.5);
    expect(p.flag).toBe('green');
    expect(p.recentEvents).toEqual([]);
    expect(p.estimatedStintLaps).toBe(30);
  });

  it('includes carAhead and carBehind from state', () => {
    const state = makeRosteredState();
    const ds = createDriverState(PLAYER);

    // Player at P5, gap to ahead = 1.2s, gap to behind tracked via carBehind's gapToAhead
    const cs = getOrCreateCarState(state, PLAYER);
    cs.recentGapToBehind = [2.0, 1.8, 1.5];
    cs.closingRateToBehind = 0.25;
    cs.closingRateToAhead = 0.10;

    const frame = makeFrame({
      sessionTime: 100,
      cars: [
        { carIdx: PLAYER, position: 5, f2Time: 1.2 },
        { carIdx: 1, position: 4 }, // car ahead
        { carIdx: 2, position: 6 }, // car behind
      ],
    });

    const snap = buildSnapshot(frame, state, ds, ctx, 'cadence');
    const p = snap!.payload as any;
    expect(p.carAhead).toBeDefined();
    expect(p.carAhead.car.carIdx).toBe(1);
    expect(p.carAhead.gapSec).toBeCloseTo(1.2);
    expect(p.carAhead.closingRateSecPerLap).toBeCloseTo(0.10);

    expect(p.carBehind).toBeDefined();
    expect(p.carBehind.car.carIdx).toBe(2);
    expect(p.carBehind.gapSec).toBeCloseTo(1.5);
    expect(p.carBehind.closingRateSecPerLap).toBeCloseTo(0.25);
  });

  it('embeds at most SNAPSHOT_RECENT_EVENTS_LIMIT recent events', () => {
    const state = makeRosteredState();
    const ds = createDriverState(PLAYER);
    for (let i = 0; i < SNAPSHOT_RECENT_EVENTS_LIMIT + 5; i++) {
      pushRecentEvent(ds, makeFakeEvent('LAP_COMPLETED', i));
    }
    const frame = makeFrame({ sessionTime: 100, cars: [{ carIdx: PLAYER }] });
    const snap = buildSnapshot(frame, state, ds, ctx, 'forced');
    const p = snap!.payload as any;
    expect(p.recentEvents).toHaveLength(SNAPSHOT_RECENT_EVENTS_LIMIT);
    // Newest last
    expect(p.recentEvents[p.recentEvents.length - 1].sessionTime).toBe(SNAPSHOT_RECENT_EVENTS_LIMIT + 5 - 1);
    // Each digest carries summary string
    expect(p.recentEvents[0].summary).toContain('completed lap');
  });

  it('updates lastSnapshotSessionTime on success', () => {
    const state = makeRosteredState();
    const ds = createDriverState(PLAYER);
    const frame = makeFrame({ sessionTime: 50, cars: [{ carIdx: PLAYER }] });
    buildSnapshot(frame, state, ds, ctx, 'cadence');
    expect(ds.lastSnapshotSessionTime).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// maybeBuildSnapshot — decision logic
// ---------------------------------------------------------------------------

describe('maybeBuildSnapshot', () => {
  it('emits on first frame (no prior snapshot)', () => {
    const state = makeRosteredState();
    const ds = createDriverState(PLAYER);
    const frame = makeFrame({ sessionTime: 0, cars: [{ carIdx: PLAYER }] });
    const snap = maybeBuildSnapshot(frame, state, ds, [], ctx);
    expect(snap).not.toBeNull();
    expect((snap!.payload as any).reason).toBe('cadence');
  });

  it('emits a forced snapshot when batch contains RACE_GREEN', () => {
    const state = makeRosteredState();
    const ds = createDriverState(PLAYER);
    ds.lastSnapshotSessionTime = 100; // recent — would normally suppress
    const frame = makeFrame({ sessionTime: 102, cars: [{ carIdx: PLAYER }] });
    const snap = maybeBuildSnapshot(frame, state, ds, [makeFakeEvent('RACE_GREEN')], ctx);
    expect(snap).not.toBeNull();
    expect((snap!.payload as any).reason).toBe('forced');
  });

  it('emits a forced snapshot on PIT_ENTRY', () => {
    const state = makeRosteredState();
    const ds = createDriverState(PLAYER);
    ds.lastSnapshotSessionTime = 100;
    const frame = makeFrame({ sessionTime: 102, cars: [{ carIdx: PLAYER }] });
    const snap = maybeBuildSnapshot(frame, state, ds, [makeFakeEvent('PIT_ENTRY')], ctx);
    expect(snap).not.toBeNull();
    expect((snap!.payload as any).reason).toBe('forced');
  });

  it('suppresses a snapshot when neither cadence elapsed nor trigger present', () => {
    const state = makeRosteredState();
    const ds = createDriverState(PLAYER);
    ds.lastSnapshotSessionTime = 100;
    const frame = makeFrame({ sessionTime: 105, cars: [{ carIdx: PLAYER }] });
    const snap = maybeBuildSnapshot(frame, state, ds, [makeFakeEvent('LAP_COMPLETED')], ctx);
    expect(snap).toBeNull();
  });

  it('emits at the cadence boundary', () => {
    const state = makeRosteredState();
    const ds = createDriverState(PLAYER);
    ds.lastSnapshotSessionTime = 100;
    const frame = makeFrame({
      sessionTime: 100 + DEFAULT_SNAPSHOT_INTERVAL_SEC,
      cars: [{ carIdx: PLAYER }],
    });
    const snap = maybeBuildSnapshot(frame, state, ds, [], ctx);
    expect(snap).not.toBeNull();
    expect((snap!.payload as any).reason).toBe('cadence');
  });

  it('honours custom snapshotIntervalSec', () => {
    const state = makeRosteredState();
    const ds = createDriverState(PLAYER);
    ds.lastSnapshotSessionTime = 100;
    const frame = makeFrame({ sessionTime: 103, cars: [{ carIdx: PLAYER }] });
    const snap = maybeBuildSnapshot(frame, state, ds, [], { ...ctx, snapshotIntervalSec: 2 });
    expect(snap).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deriveFlag
// ---------------------------------------------------------------------------

describe('deriveFlag', () => {
  it.each([
    [FlagBits.Green, 'green'],
    [FlagBits.Yellow, 'yellow'],
    [FlagBits.YellowFullCourse, 'yellow'],
    [FlagBits.Red, 'red'],
    [FlagBits.White, 'white'],
    [FlagBits.Blue, 'blue'],
    [FlagBits.Checkered, 'checkered'],
    [0, 'unknown'],
  ])('maps %d → %s', (flags, expected) => {
    expect(deriveFlag(flags)).toBe(expected);
  });

  it('prioritises red over yellow', () => {
    expect(deriveFlag(FlagBits.Red | FlagBits.Yellow)).toBe('red');
  });
});
