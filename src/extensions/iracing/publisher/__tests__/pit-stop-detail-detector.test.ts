/**
 * pit-stop-detail-detector.test.ts — Issue #96
 *
 * Covers the Tier 2 pit stop state machine:
 *   PIT_STOP_BEGIN, PIT_STOP_END, OUT_LAP, FUEL_LOW, FUEL_LEVEL_CHANGE
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  detectPitStopDetail,
  DEFAULT_FUEL_JUMP_THRESHOLD_L,
  type PitStopDetailContext,
} from '../driver-publisher/pit-stop-detail-detector';
import { createSessionState, type SessionState } from '../session-state';
import {
  makeFrame,
  cloneFrame,
  makeFrameSequence,
  TrackSurface,
  withPitEntry,
  withPitStall,
  withPitExit,
  withLapCompleted,
} from './frame-fixtures';

const CTX: PitStopDetailContext = { publisherCode: 'rig-01', raceSessionId: 'rs-1', playerCarIdx: 0 };

let state: SessionState;
beforeEach(() => { state = createSessionState('rs-1', 1); });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detect(
  prev: ReturnType<typeof makeFrame> | null,
  curr: ReturnType<typeof makeFrame>,
  s = state,
  ctx = CTX,
) {
  return detectPitStopDetail(prev, curr, s, ctx);
}

/** Advance a frame's sessionTime by dt seconds. */
function advanceTime(f: ReturnType<typeof makeFrame>, dt: number): ReturnType<typeof makeFrame> {
  const next = cloneFrame(f);
  next.sessionTime = f.sessionTime + dt;
  return next;
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

describe('detectPitStopDetail — seeding', () => {
  it('returns no events on first frame', () => {
    expect(detect(null, makeFrame())).toEqual([]);
  });

  it('seeds playerFuelAtLapStart on first frame', () => {
    detect(null, makeFrame({ fuelLevel: 42 }));
    expect(state.playerFuelAtLapStart).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Full state machine: OnTrack(1)→ApproachingPits(3)→PitLane(4)→PitStall(2)→
//                    PitLane(4)→ApproachingPits(3)→OnTrack(1)
// ---------------------------------------------------------------------------

describe('detectPitStopDetail — state machine 1→3→4→2→4→3→1', () => {
  function runStopMachine(options: { refuelLevel?: number } = {}) {
    const base = makeFrame({
      sessionTime: 100,
      fuelLevel: options.refuelLevel !== undefined ? 10 : 40,
      cars: [{ carIdx: 0, trackSurface: TrackSurface.OnTrack }],
    });

    // Build frames via transition helpers
    const [f0, f1, f2, f3] = makeFrameSequence(base, [
      withPitEntry(0),   // → ApproachingPits (3), onPitRoad=true
      (p) => {           // → PitLane (4)
        const n = cloneFrame(p);
        n.carIdxTrackSurface[0] = TrackSurface.PitLane;
        n.sessionTime += 0.5;
        return n;
      },
      withPitStall(0),   // → PitStall (2), PIT_STOP_BEGIN fires
    ]);

    // Service completes 8 s later; refuel if requested.
    const f4 = cloneFrame(f3);
    f4.sessionTime = f3.sessionTime + 8;
    if (options.refuelLevel !== undefined) f4.fuelLevel = options.refuelLevel;
    // Leave stall → PitLane
    f4.carIdxTrackSurface[0] = TrackSurface.PitLane;

    // → ApproachingPits
    const f5 = cloneFrame(f4);
    f5.sessionTime += 0.5;
    f5.carIdxTrackSurface[0] = TrackSurface.ApproachingPits;

    // → OnTrack, onPitRoad=0 (PIT_EXIT)
    const f6 = withPitExit(0)(f5);

    return { frames: [f0, f1, f2, f3, f4, f5, f6] };
  }

  it('emits PIT_STOP_BEGIN when car enters pit stall', () => {
    const { frames } = runStopMachine();
    const eventsAtStall = detect(frames[2], frames[3]);
    const begin = eventsAtStall.find(e => e.type === 'PIT_STOP_BEGIN');
    expect(begin).toBeDefined();
    expect(begin!.car?.carIdx).toBe(0);
    expect((begin!.payload as { arrivalSessionTime: number }).arrivalSessionTime)
      .toBe(frames[3].sessionTime);
  });

  it('emits PIT_STOP_END with correct duration when car leaves pit stall', () => {
    const { frames } = runStopMachine();
    // Seed the stall arrival state
    detect(frames[2], frames[3]); // PIT_STOP_BEGIN

    const eventsLeave = detect(frames[3], frames[4]);
    const end = eventsLeave.find(e => e.type === 'PIT_STOP_END');
    expect(end).toBeDefined();
    const payload = end!.payload as { serviceDurationSec: number; fuelLevelDelta: number };
    expect(payload.serviceDurationSec).toBeCloseTo(8, 5);
  });

  it('PIT_STOP_END includes fuelLevelDelta when player is refuelled', () => {
    const { frames } = runStopMachine({ refuelLevel: 45 });
    detect(frames[2], frames[3]); // seeds arrival fuel (10L)
    const events = detect(frames[3], frames[4]);
    const end = events.find(e => e.type === 'PIT_STOP_END');
    expect(end).toBeDefined();
    const payload = end!.payload as { fuelLevelDelta: number };
    expect(payload.fuelLevelDelta).toBeCloseTo(35, 5); // 45 - 10
  });

  it('does NOT emit PIT_STOP_BEGIN/END for surface transitions within stall', () => {
    const f0 = makeFrame({ cars: [{ carIdx: 0, trackSurface: TrackSurface.PitStall }] });
    const f1 = cloneFrame(f0);
    f1.sessionTime += 1;
    const events = detect(f0, f1);
    expect(events.find(e => e.type === 'PIT_STOP_BEGIN')).toBeUndefined();
    expect(events.find(e => e.type === 'PIT_STOP_END')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// OUT_LAP
// ---------------------------------------------------------------------------

describe('detectPitStopDetail — OUT_LAP', () => {
  it('emits OUT_LAP after car completes first lap post pit-exit', () => {
    // Car is on pit road in prev, exits in curr.
    const f0 = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 5 }] });
    f0.carIdxOnPitRoad[0] = 1; // on pit road
    const f1 = withPitExit(0)(f0);  // exits pit road

    detect(f0, f1); // sets cs.onOutLap = true, pitExitLapsCompleted = 5

    // Complete a lap
    const f2 = withLapCompleted(0, 92)(f1);
    const events = detect(f1, f2);
    expect(events.find(e => e.type === 'OUT_LAP')).toBeDefined();
    expect(state.carStates.get(0)?.onOutLap).toBe(false);
  });

  it('does NOT emit OUT_LAP before a lap is completed after pit exit', () => {
    const f0 = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 5 }] });
    f0.carIdxOnPitRoad[0] = 1;
    const f1 = withPitExit(0)(f0);
    detect(f0, f1);

    // Same lap count — no OUT_LAP yet
    const f2 = cloneFrame(f1);
    f2.sessionTime += 10;
    const events = detect(f1, f2);
    expect(events.find(e => e.type === 'OUT_LAP')).toBeUndefined();
    expect(state.carStates.get(0)?.onOutLap).toBe(true);
  });

  it('only fires OUT_LAP once per pit stop', () => {
    const f0 = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 5 }] });
    f0.carIdxOnPitRoad[0] = 1;
    const f1 = withPitExit(0)(f0);
    detect(f0, f1);

    const f2 = withLapCompleted(0, 92)(f1);
    const first  = detect(f1, f2);
    const f3     = withLapCompleted(0, 91)(f2);
    const second = detect(f2, f3);

    expect(first.find(e => e.type === 'OUT_LAP')).toBeDefined();
    expect(second.find(e => e.type === 'OUT_LAP')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// FUEL_LOW
// ---------------------------------------------------------------------------

describe('detectPitStopDetail — FUEL_LOW', () => {
  it('fires at 0.10 threshold crossing', () => {
    const f0 = makeFrame({ fuelLevelPct: 0.12, fuelLevel: 6 });
    const f1 = cloneFrame(f0);
    f1.fuelLevelPct = 0.09;
    f1.fuelLevel    = 4.5;

    detect(null, f0); // seed
    const events = detect(f0, f1);
    const low = events.find(e => e.type === 'FUEL_LOW');
    expect(low).toBeDefined();
    expect((low!.payload as { threshold: number }).threshold).toBe(0.10);
  });

  it('fires at 0.05 threshold crossing (after 0.10)', () => {
    state.firedFuelLowThresholds.add(0.10); // already fired

    const f0 = makeFrame({ fuelLevelPct: 0.06, fuelLevel: 3 });
    const f1 = cloneFrame(f0);
    f1.fuelLevelPct = 0.04;
    f1.fuelLevel    = 2;

    detect(null, f0);
    const events = detect(f0, f1);
    const low = events.find(e => e.type === 'FUEL_LOW');
    expect(low).toBeDefined();
    expect((low!.payload as { threshold: number }).threshold).toBe(0.05);
  });

  it('fires at both thresholds in a single step if fuel drops below 0.05', () => {
    const f0 = makeFrame({ fuelLevelPct: 0.12, fuelLevel: 6 });
    const f1 = cloneFrame(f0);
    f1.fuelLevelPct = 0.03;
    f1.fuelLevel    = 1.5;

    detect(null, f0);
    const events = detect(f0, f1);
    const lows = events.filter(e => e.type === 'FUEL_LOW');
    expect(lows).toHaveLength(2);
    const thresholds = lows.map(e => (e.payload as { threshold: number }).threshold).sort();
    expect(thresholds).toEqual([0.05, 0.10]);
  });

  it('fires each threshold exactly once per session', () => {
    const f0 = makeFrame({ fuelLevelPct: 0.12, fuelLevel: 6 });
    const f1 = cloneFrame(f0);
    f1.fuelLevelPct = 0.04;
    f1.fuelLevel    = 2;

    detect(null, f0);
    const first  = detect(f0, f1);
    const f2     = cloneFrame(f1);
    const second = detect(f1, f2);

    expect(first.filter(e => e.type === 'FUEL_LOW')).toHaveLength(2);
    expect(second.filter(e => e.type === 'FUEL_LOW')).toHaveLength(0);
  });

  it('includes estimatedLapsRemaining based on playerFuelPerLap', () => {
    state.playerFuelPerLap = 3; // 3L per lap
    state.firedFuelLowThresholds.clear();

    const f0 = makeFrame({ fuelLevelPct: 0.12, fuelLevel: 6 });
    const f1 = cloneFrame(f0);
    f1.fuelLevelPct = 0.09;
    f1.fuelLevel    = 4.5;

    detect(null, f0);
    const events = detect(f0, f1);
    const low = events.find(e => e.type === 'FUEL_LOW')!;
    expect((low.payload as { estimatedLapsRemaining: number }).estimatedLapsRemaining).toBe(1);
  });

  it('gives estimatedLapsRemaining = 0 before fuel-per-lap is known', () => {
    const f0 = makeFrame({ fuelLevelPct: 0.12, fuelLevel: 6 });
    const f1 = cloneFrame(f0);
    f1.fuelLevelPct = 0.09;

    detect(null, f0);
    const events = detect(f0, f1);
    const low = events.find(e => e.type === 'FUEL_LOW');
    expect((low!.payload as { estimatedLapsRemaining: number }).estimatedLapsRemaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// FUEL_LEVEL_CHANGE
// ---------------------------------------------------------------------------

describe('detectPitStopDetail — FUEL_LEVEL_CHANGE', () => {
  it('fires when FuelLevel jumps by more than the threshold', () => {
    const f0 = makeFrame({ fuelLevel: 10 });
    const f1 = cloneFrame(f0);
    f1.fuelLevel = 40; // +30L refuel

    detect(null, f0);
    const events = detect(f0, f1);
    const change = events.find(e => e.type === 'FUEL_LEVEL_CHANGE');
    expect(change).toBeDefined();
    expect(change!.payload).toMatchObject({ previousLevel: 10, newLevel: 40, deltaLitres: 30 });
  });

  it('does NOT fire when FuelLevel decreases (consumption)', () => {
    const f0 = makeFrame({ fuelLevel: 40 });
    const f1 = cloneFrame(f0);
    f1.fuelLevel = 38.5;

    detect(null, f0);
    const events = detect(f0, f1);
    expect(events.find(e => e.type === 'FUEL_LEVEL_CHANGE')).toBeUndefined();
  });

  it('does NOT fire for small fuel changes below threshold', () => {
    const f0 = makeFrame({ fuelLevel: 10 });
    const f1 = cloneFrame(f0);
    f1.fuelLevel = 10.5; // under 1L default threshold

    detect(null, f0);
    const events = detect(f0, f1);
    expect(events.find(e => e.type === 'FUEL_LEVEL_CHANGE')).toBeUndefined();
  });

  it('honours a custom fuelJumpThresholdL', () => {
    const customCtx = { ...CTX, fuelJumpThresholdL: 5.0 };

    const f0 = makeFrame({ fuelLevel: 10 });
    const f1 = cloneFrame(f0);
    f1.fuelLevel = 13; // +3L — under 5L threshold

    detect(null, f0, state, customCtx);
    const events = detect(f0, f1, state, customCtx);
    expect(events.find(e => e.type === 'FUEL_LEVEL_CHANGE')).toBeUndefined();

    // Now jump to 20L (+10L — above 5L threshold)
    const f2 = cloneFrame(f1);
    f2.fuelLevel = 23;
    const events2 = detect(f1, f2, state, customCtx);
    expect(events2.find(e => e.type === 'FUEL_LEVEL_CHANGE')).toBeDefined();
  });

  it('fires multiple times during a session if there are multiple refuels', () => {
    const f0 = makeFrame({ fuelLevel: 10 });
    const f1 = cloneFrame(f0); f1.fuelLevel = 40;
    detect(null, f0);
    const first = detect(f0, f1);
    expect(first.find(e => e.type === 'FUEL_LEVEL_CHANGE')).toBeDefined();

    // Burn fuel, then refuel again
    const f2 = cloneFrame(f1); f2.fuelLevel = 5;
    detect(f1, f2); // burn

    const f3 = cloneFrame(f2); f3.fuelLevel = 35;
    const second = detect(f2, f3);
    expect(second.find(e => e.type === 'FUEL_LEVEL_CHANGE')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// playerFuelPerLap tracking
// ---------------------------------------------------------------------------

describe('detectPitStopDetail — fuel-per-lap tracking', () => {
  it('updates playerFuelPerLap when a player lap is completed', () => {
    const f0 = makeFrame({ fuelLevel: 50, cars: [{ carIdx: 0, lapsCompleted: 1 }] });
    detect(null, f0); // seeds playerFuelAtLapStart = 50

    const f1 = cloneFrame(f0);
    f1.carIdxLapCompleted[0] = 2;
    f1.fuelLevel = 47; // used 3L

    detect(f0, f1);
    expect(state.playerFuelPerLap).toBe(3);
    expect(state.playerFuelAtLapStart).toBe(47);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_FUEL_JUMP_THRESHOLD_L constant export
// ---------------------------------------------------------------------------

describe('DEFAULT_FUEL_JUMP_THRESHOLD_L', () => {
  it('is a positive number', () => {
    expect(DEFAULT_FUEL_JUMP_THRESHOLD_L).toBeGreaterThan(0);
  });
});
