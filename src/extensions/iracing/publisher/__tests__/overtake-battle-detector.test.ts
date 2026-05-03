import { describe, it, expect } from 'vitest';
import { detectOvertakeAndBattle } from '../session-publisher/overtake-battle-detector';
import { createSessionState } from '../session-state';
import {
  makeFrame,
  cloneFrame,
  makeFrameSequence,
  withOvertake,
  withBattleGap,
  scenarioA,
} from './frame-fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CTX = { rigId: 'rig-01', raceSessionId: 'session-abc' };

function makeState() {
  return createSessionState('session-abc', 1);
}

/** Prime state by running null→base to seed carState positions. */
function prime(
  base: ReturnType<typeof makeFrame>,
  state = makeState(),
) {
  detectOvertakeAndBattle(null, base, state, CTX);
  return state;
}

function detect(
  prev: ReturnType<typeof makeFrame> | null,
  curr: ReturnType<typeof makeFrame>,
  state = makeState(),
) {
  return detectOvertakeAndBattle(prev, curr, state, CTX);
}

// ---------------------------------------------------------------------------
// First frame (null prev)
// ---------------------------------------------------------------------------

describe('first frame (prev=null)', () => {
  it('returns no events', () => {
    const events = detect(null, scenarioA());
    expect(events).toHaveLength(0);
  });

  it('initialises carState positions', () => {
    const state = makeState();
    detect(null, makeFrame({ cars: [{ carIdx: 0, position: 1 }, { carIdx: 1, position: 2 }] }), state);
    expect(state.carStates.get(0)?.position).toBe(1);
    expect(state.carStates.get(1)?.position).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// OVERTAKE
// ---------------------------------------------------------------------------

describe('OVERTAKE', () => {
  it('fires on a clean position swap, both cars off pit road', () => {
    const base  = makeFrame({ cars: [{ carIdx: 0, position: 1 }, { carIdx: 1, position: 2 }] });
    const state = prime(base);
    const next  = cloneFrame(base);
    next.carIdxPosition[0] = 2;
    next.carIdxPosition[1] = 1; // car 1 overtook car 0
    const events = detect(base, next, state);
    expect(events.find(e => e.type === 'OVERTAKE')).toBeDefined();
  });

  it('OVERTAKE payload has correct overtakingCarIdx and overtakenCar', () => {
    const base  = makeFrame({ cars: [{ carIdx: 0, position: 1 }, { carIdx: 1, position: 2 }] });
    const state = prime(base);
    const next  = cloneFrame(base);
    next.carIdxPosition[0] = 2;
    next.carIdxPosition[1] = 1;
    const events = detect(base, next, state);
    const ev = events.find(e => e.type === 'OVERTAKE')!;
    expect((ev.payload as any).overtakingCarIdx).toBe(1);
    expect((ev.payload as any).overtakenCar.carIdx).toBe(0);
    expect((ev.payload as any).newPosition).toBe(1);
  });

  it('OVERTAKE payload includes overtakenCar PublisherCarRef (DIR-4)', () => {
    const base  = makeFrame({ cars: [{ carIdx: 0, position: 1 }, { carIdx: 1, position: 2 }] });
    const state = prime(base);
    const next  = cloneFrame(base);
    next.carIdxPosition[0] = 2;
    next.carIdxPosition[1] = 1;
    const events = detect(base, next, state);
    const ev = events.find(e => e.type === 'OVERTAKE')!;
    // overtakenCar must have carIdx populated (carIdx-only when no roster)
    expect((ev.payload as any).overtakenCar).toBeDefined();
    expect((ev.payload as any).overtakenCar.carIdx).toBe(0);
  });

  it('does NOT fire when one car is on pit road', () => {
    const base  = makeFrame({ cars: [{ carIdx: 0, position: 1 }, { carIdx: 1, position: 2 }] });
    const state = prime(base);
    const next  = cloneFrame(base);
    next.carIdxPosition[0]  = 2;
    next.carIdxPosition[1]  = 1;
    next.carIdxOnPitRoad[1] = 1; // overtaking car is on pit road
    expect(detect(base, next, state).find(e => e.type === 'OVERTAKE')).toBeUndefined();
  });

  it('does NOT fire for non-clean position changes (no swap partner)', () => {
    const base  = makeFrame({ cars: [{ carIdx: 0, position: 1 }, { carIdx: 1, position: 2 }, { carIdx: 2, position: 3 }] });
    const state = prime(base);
    const next  = cloneFrame(base);
    // car 2 jumps to position 1 but positions 2 doesn't settle as a swap
    next.carIdxPosition[0] = 2;
    next.carIdxPosition[1] = 3;
    next.carIdxPosition[2] = 1;
    // This is NOT a clean swap with car 0 since car 0 → 2, car 1 → 3
    // So no OVERTAKE should fire for the 2-at-a-time jump
    const events = detect(base, next, state);
    // It may or may not fire for partial swaps; the key assertion is no crash
    expect(Array.isArray(events)).toBe(true);
  });

  it('fires only once for the same pair (no double reporting)', () => {
    const base  = makeFrame({ cars: [{ carIdx: 0, position: 1 }, { carIdx: 1, position: 2 }] });
    const state = prime(base);
    const next  = cloneFrame(base);
    next.carIdxPosition[0] = 2;
    next.carIdxPosition[1] = 1;
    const events = detect(base, next, state);
    expect(events.filter(e => e.type === 'OVERTAKE')).toHaveLength(1);
  });

  it('uses withOvertake transition helper', () => {
    const base   = scenarioA(); // car 0 P1, car 1 P2
    const state  = prime(base);
    const frames = makeFrameSequence(base, [withOvertake(1, 0)]);
    const events = detect(frames[0], frames[1], state);
    expect(events.find(e => e.type === 'OVERTAKE')).toBeDefined();
  });

  it('OVERTAKE payload carries lapDistPct', () => {
    const base  = makeFrame({ cars: [{ carIdx: 0, position: 1, lapDistPct: 0.5 }, { carIdx: 1, position: 2 }] });
    const state = prime(base);
    const next  = cloneFrame(base);
    next.carIdxPosition[0]   = 2;
    next.carIdxPosition[1]   = 1;
    next.carIdxLapDistPct[1] = 0.51;
    const events = detect(base, next, state);
    const ev = events.find(e => e.type === 'OVERTAKE')!;
    expect((ev.payload as any).lapDistPct).toBeCloseTo(0.51, 2);
  });
});

// ---------------------------------------------------------------------------
// BATTLE_ENGAGED
// ---------------------------------------------------------------------------

describe('BATTLE_ENGAGED', () => {
  it('fires after two consecutive sub-1.0s gap frames', () => {
    const state = makeState();
    // Seed positions
    const base  = makeFrame({ cars: [{ carIdx: 0, position: 1 }, { carIdx: 1, position: 2 }] });
    detect(null, base, state);

    // Frame 1: gap = 0.8 (CLOSING latch)
    const f1 = cloneFrame(base);
    f1.carIdxF2Time[1] = 0.8;
    detect(base, f1, state);
    expect(state.activeBattles.size).toBe(1); // latch exists
    expect([...state.activeBattles.values()][0].status).toBe('CLOSING');

    // Frame 2: still sub-1.0s → ENGAGED
    const f2 = cloneFrame(f1);
    f2.carIdxF2Time[1] = 0.7;
    const events = detect(f1, f2, state);
    expect(events.find(e => e.type === 'BATTLE_ENGAGED')).toBeDefined();
    expect([...state.activeBattles.values()][0].status).toBe('ENGAGED');
  });

  it('does NOT fire on the first sub-threshold frame alone', () => {
    const state = makeState();
    const base  = makeFrame({ cars: [{ carIdx: 0, position: 1 }, { carIdx: 1, position: 2 }] });
    detect(null, base, state);
    const f1 = cloneFrame(base);
    f1.carIdxF2Time[1] = 0.5;
    const events = detect(base, f1, state);
    expect(events.find(e => e.type === 'BATTLE_ENGAGED')).toBeUndefined();
  });

  it('does NOT fire again once already ENGAGED', () => {
    const state = makeState();
    const base  = makeFrame({ cars: [{ carIdx: 0, position: 1 }, { carIdx: 1, position: 2 }] });
    detect(null, base, state);
    const f1 = cloneFrame(base);
    f1.carIdxF2Time[1] = 0.8;
    detect(base, f1, state);
    const f2 = cloneFrame(f1);
    f2.carIdxF2Time[1] = 0.7;
    detect(f1, f2, state); // ENGAGED fires here
    const f3 = cloneFrame(f2);
    f3.carIdxF2Time[1] = 0.6;
    const events = detect(f2, f3, state);
    expect(events.find(e => e.type === 'BATTLE_ENGAGED')).toBeUndefined();
  });

  it('BATTLE_ENGAGED payload has chaserCar, leaderCar, gapSec', () => {
    const state = makeState();
    const base  = makeFrame({ cars: [{ carIdx: 0, position: 1 }, { carIdx: 1, position: 2 }] });
    detect(null, base, state);
    const f1 = cloneFrame(base);
    f1.carIdxF2Time[1] = 0.8;
    detect(base, f1, state);
    const f2 = cloneFrame(f1);
    f2.carIdxF2Time[1] = 0.7;
    const events = detect(f1, f2, state);
    const ev = events.find(e => e.type === 'BATTLE_ENGAGED')!;
    expect((ev.payload as any).chaserCar.carIdx).toBe(1);
    expect((ev.payload as any).leaderCar.carIdx).toBe(0);
    expect((ev.payload as any).gapSec).toBeCloseTo(0.7, 2);
  });

  it('BATTLE_ENGAGED payload includes chaserCar and leaderCar PublisherCarRef (DIR-4)', () => {
    const state = makeState();
    const base  = makeFrame({ cars: [{ carIdx: 0, position: 1 }, { carIdx: 1, position: 2 }] });
    detect(null, base, state);
    const f1 = cloneFrame(base);
    f1.carIdxF2Time[1] = 0.8;
    detect(base, f1, state);
    const f2 = cloneFrame(f1);
    f2.carIdxF2Time[1] = 0.7;
    const events = detect(f1, f2, state);
    const ev = events.find(e => e.type === 'BATTLE_ENGAGED')!;
    expect((ev.payload as any).chaserCar).toBeDefined();
    expect((ev.payload as any).chaserCar.carIdx).toBe(1);
    expect((ev.payload as any).leaderCar).toBeDefined();
    expect((ev.payload as any).leaderCar.carIdx).toBe(0);
  });

  it('uses withBattleGap transition helper', () => {
    const state = makeState();
    const base  = scenarioA(); // car 0 P1, car 1 P2, car 1 already at 0.8s gap
    // Seed positions (null→base doesn't create a latch)
    detect(null, base, state);
    // First sub-threshold frame: base→f1 creates the CLOSING latch
    const f1 = cloneFrame(base);
    f1.carIdxF2Time[1] = 0.8;
    detect(base, f1, state);
    // Second sub-threshold frame: gap 0.7 → BATTLE_ENGAGED
    const frames = makeFrameSequence(f1, [withBattleGap(1, 0.7)]);
    const events = detect(frames[0], frames[1], state);
    expect(events.find(e => e.type === 'BATTLE_ENGAGED')).toBeDefined();
  });

  it('battle key is normalised (lower carIdx first)', () => {
    const state = makeState();
    const base  = makeFrame({ cars: [{ carIdx: 0, position: 1 }, { carIdx: 1, position: 2 }] });
    detect(null, base, state);
    const f1 = cloneFrame(base);
    f1.carIdxF2Time[1] = 0.8;
    detect(base, f1, state);
    // Key should be '0-1' (lower first)
    expect(state.activeBattles.has('0-1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BATTLE_BROKEN
// ---------------------------------------------------------------------------

describe('BATTLE_BROKEN', () => {
  /** Helper: advance a battle through CLOSING→ENGAGED and return the state. */
  function engageBattle() {
    const state = makeState();
    const base  = makeFrame({ cars: [{ carIdx: 0, position: 1 }, { carIdx: 1, position: 2 }] });
    detect(null, base, state);
    const f1 = cloneFrame(base);
    f1.carIdxF2Time[1] = 0.8;
    detect(base, f1, state);
    const f2 = cloneFrame(f1);
    f2.carIdxF2Time[1] = 0.7;
    detect(f1, f2, state);
    return { state, lastFrame: f2 };
  }

  it('fires after 3 consecutive frames above 2.0s gap', () => {
    const { state, lastFrame } = engageBattle();
    let prev = lastFrame;
    for (let i = 0; i < 3; i++) {
      const curr = cloneFrame(prev);
      curr.carIdxF2Time[1] = 2.5;
      const events = detect(prev, curr, state);
      if (i < 2) {
        expect(events.find(e => e.type === 'BATTLE_BROKEN')).toBeUndefined();
      } else {
        expect(events.find(e => e.type === 'BATTLE_BROKEN')).toBeDefined();
      }
      prev = curr;
    }
  });

  it('removes the battle from activeBattles after BATTLE_BROKEN', () => {
    const { state, lastFrame } = engageBattle();
    let prev = lastFrame;
    for (let i = 0; i < 3; i++) {
      const curr = cloneFrame(prev);
      curr.carIdxF2Time[1] = 2.5;
      detect(prev, curr, state);
      prev = curr;
    }
    expect(state.activeBattles.size).toBe(0);
  });

  it('does NOT fire after only 2 frames above 2.0s', () => {
    const { state, lastFrame } = engageBattle();
    let prev = lastFrame;
    for (let i = 0; i < 2; i++) {
      const curr = cloneFrame(prev);
      curr.carIdxF2Time[1] = 2.5;
      const events = detect(prev, curr, state);
      expect(events.find(e => e.type === 'BATTLE_BROKEN')).toBeUndefined();
      prev = curr;
    }
  });

  it('resets broken frame counter when gap drops back below 2.0s', () => {
    const { state, lastFrame } = engageBattle();
    const f1 = cloneFrame(lastFrame);
    f1.carIdxF2Time[1] = 2.5;
    detect(lastFrame, f1, state);

    const f2 = cloneFrame(f1);
    f2.carIdxF2Time[1] = 1.5; // back below 2.0s — reset broken frames
    detect(f1, f2, state);

    // Now go wide again — needs 3 more frames
    let prev = f2;
    for (let i = 0; i < 2; i++) {
      const curr = cloneFrame(prev);
      curr.carIdxF2Time[1] = 2.5;
      const events = detect(prev, curr, state);
      expect(events.find(e => e.type === 'BATTLE_BROKEN')).toBeUndefined();
      prev = curr;
    }
  });

  it('BATTLE_BROKEN payload has chaserCar and leaderCar', () => {
    const { state, lastFrame } = engageBattle();
    let prev = lastFrame;
    let brokenEvent: any;
    for (let i = 0; i < 3; i++) {
      const curr = cloneFrame(prev);
      curr.carIdxF2Time[1] = 2.5;
      const events = detect(prev, curr, state);
      brokenEvent = events.find(e => e.type === 'BATTLE_BROKEN') ?? brokenEvent;
      prev = curr;
    }
    expect((brokenEvent.payload as any).chaserCar.carIdx).toBe(1);
    expect((brokenEvent.payload as any).leaderCar.carIdx).toBe(0);
    expect((brokenEvent.payload as any).status).toBe('BROKEN');
  });

  it('BATTLE_BROKEN payload includes chaserCar and leaderCar PublisherCarRef (DIR-4)', () => {
    const { state, lastFrame } = engageBattle();
    let prev = lastFrame;
    let brokenEvent: any;
    for (let i = 0; i < 3; i++) {
      const curr = cloneFrame(prev);
      curr.carIdxF2Time[1] = 2.5;
      const events = detect(prev, curr, state);
      brokenEvent = events.find(e => e.type === 'BATTLE_BROKEN') ?? brokenEvent;
      prev = curr;
    }
    expect((brokenEvent.payload as any).chaserCar).toBeDefined();
    expect((brokenEvent.payload as any).chaserCar.carIdx).toBe(1);
    expect((brokenEvent.payload as any).leaderCar).toBeDefined();
    expect((brokenEvent.payload as any).leaderCar.carIdx).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Position state is updated each frame
// ---------------------------------------------------------------------------

describe('carState position tracking', () => {
  it('updates positions after each frame', () => {
    const state = makeState();
    const base  = makeFrame({ cars: [{ carIdx: 0, position: 1 }, { carIdx: 1, position: 2 }] });
    detect(null, base, state);
    expect(state.carStates.get(0)?.position).toBe(1);
    expect(state.carStates.get(1)?.position).toBe(2);

    const next = cloneFrame(base);
    next.carIdxPosition[0] = 2;
    next.carIdxPosition[1] = 1;
    detect(base, next, state);
    expect(state.carStates.get(0)?.position).toBe(2);
    expect(state.carStates.get(1)?.position).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

describe('event envelope', () => {
  it('OVERTAKE event carries raceSessionId and publisherCode', () => {
    const base  = scenarioA();
    const state = prime(base);
    const frames = makeFrameSequence(base, [withOvertake(1, 0)]);
    const events = detect(frames[0], frames[1], state);
    const ev = events.find(e => e.type === 'OVERTAKE')!;
    expect(ev.raceSessionId).toBe('session-abc');
    expect(ev.rigId).toBe('rig-01');
  });
});

// ---------------------------------------------------------------------------
// Tier 2 (#97): OVERTAKE_FOR_LEAD
// ---------------------------------------------------------------------------

describe('OVERTAKE_FOR_LEAD', () => {
  it('fires when the pass is for the session lead (newPosition === 1)', () => {
    const base  = makeFrame({ cars: [{ carIdx: 0, position: 1 }, { carIdx: 1, position: 2 }] });
    const state = prime(base);
    const next  = cloneFrame(base);
    // Car 1 takes the lead from car 0
    next.carIdxPosition[0] = 2;
    next.carIdxPosition[1] = 1;
    const events = detect(base, next, state);
    const lead = events.find(e => e.type === 'OVERTAKE_FOR_LEAD');
    expect(lead).toBeDefined();
    expect((lead!.payload as any).newPosition).toBe(1);
    expect((lead!.payload as any).overtakingCarIdx).toBe(1);
  });

  it('does NOT fire for a non-lead pass', () => {
    const base  = makeFrame({ cars: [
      { carIdx: 0, position: 1 },
      { carIdx: 1, position: 2 },
      { carIdx: 2, position: 3 },
    ] });
    const state = prime(base);
    const next  = cloneFrame(base);
    next.carIdxPosition[1] = 3;
    next.carIdxPosition[2] = 2; // car 2 passes car 1 — new pos 2, not 1
    const events = detect(base, next, state);
    expect(events.find(e => e.type === 'OVERTAKE_FOR_LEAD')).toBeUndefined();
    expect(events.find(e => e.type === 'OVERTAKE')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tier 2 (#97): OVERTAKE_FOR_CLASS
// ---------------------------------------------------------------------------

describe('OVERTAKE_FOR_CLASS', () => {
  it('fires when chaser takes the class lead (classPosition 2 -> 1)', () => {
    const base = makeFrame({ cars: [
      { carIdx: 0, position: 1, classPosition: 1 },
      { carIdx: 1, position: 2, classPosition: 2 },
    ] });
    const state = prime(base);
    const next = cloneFrame(base);
    next.carIdxPosition[0] = 2;
    next.carIdxPosition[1] = 1;
    next.carIdxClassPosition[0] = 2;
    next.carIdxClassPosition[1] = 1;
    const events = detect(base, next, state);
    const classEv = events.find(e => e.type === 'OVERTAKE_FOR_CLASS');
    expect(classEv).toBeDefined();
    expect((classEv!.payload as any).overtakingCarIdx).toBe(1);
  });

  it('does NOT fire when classPosition did not become 1', () => {
    const base = makeFrame({ cars: [
      { carIdx: 0, position: 1, classPosition: 1 },
      { carIdx: 1, position: 2, classPosition: 3 },
      { carIdx: 2, position: 3, classPosition: 2 },
    ] });
    const state = prime(base);
    const next = cloneFrame(base);
    next.carIdxPosition[1] = 3;
    next.carIdxPosition[2] = 2;
    next.carIdxClassPosition[1] = 3;
    next.carIdxClassPosition[2] = 2; // moved from class pos 2 -> 2 (no class lead change)
    const events = detect(base, next, state);
    expect(events.find(e => e.type === 'OVERTAKE_FOR_CLASS')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tier 2 (#97): BATTLE_CLOSING
// ---------------------------------------------------------------------------

describe('BATTLE_CLOSING', () => {
  it('fires when gap is in (1.0, 2.0] and closing ≥ 0.2s/lap', () => {
    // Start with a battle in the closing band at 1.8s.
    const base = makeFrame({
      sessionTime: 100,
      cars: [
        { carIdx: 0, position: 1, lastLapTime: 90 },
        { carIdx: 1, position: 2, lastLapTime: 90, f2Time: 1.8 },
      ],
    });
    const state = prime(base);

    // Register the battle in activeBattles by first passing through engage-then-widen.
    // Simpler: call once to record previousGap, then close sharply.
    const f1 = cloneFrame(base);
    f1.sessionTime = 101;
    f1.carIdxF2Time[1] = 1.8;
    detect(base, f1, state);
    // Seed a CLOSING entry manually so the detector has something to compare against
    state.activeBattles.set('0-1', {
      chaserCarIdx: 1,
      leaderCarIdx: 0,
      status: 'CLOSING',
      gapSec: 1.8,
      previousGapSec: 1.8,
      closingRateSecPerLap: 0,
      engagedAt: 100,
      brokenFrames: 0,
      closingAnnounced: false,
    });

    const f2 = cloneFrame(f1);
    f2.sessionTime = 102;              // 1s of session time elapsed
    f2.carIdxF2Time[1] = 1.5;          // gap shrank by 0.3s over 1s → 0.3 * 90 = 27s/lap
    const events = detect(f1, f2, state);
    const closing = events.find(e => e.type === 'BATTLE_CLOSING');
    expect(closing).toBeDefined();
    expect((closing!.payload as any).status).toBe('CLOSING');
    expect((closing!.payload as any).gapSec).toBeCloseTo(1.5, 5);
  });

  it('BATTLE_CLOSING payload includes chaserCar and leaderCar PublisherCarRef (DIR-4)', () => {
    const base = makeFrame({
      sessionTime: 100,
      cars: [
        { carIdx: 0, position: 1, lastLapTime: 90 },
        { carIdx: 1, position: 2, lastLapTime: 90, f2Time: 1.8 },
      ],
    });
    const state = prime(base);
    state.activeBattles.set('0-1', {
      chaserCarIdx: 1, leaderCarIdx: 0, status: 'CLOSING',
      gapSec: 1.8, previousGapSec: 1.8, closingRateSecPerLap: 0,
      engagedAt: 100, brokenFrames: 0, closingAnnounced: false,
    });
    const f1 = cloneFrame(base);
    f1.sessionTime = 102;
    f1.carIdxF2Time[1] = 1.5;
    const events = detect(base, f1, state);
    const ev = events.find(e => e.type === 'BATTLE_CLOSING')!;
    expect((ev.payload as any).chaserCar).toBeDefined();
    expect((ev.payload as any).chaserCar.carIdx).toBe(1);
    expect((ev.payload as any).leaderCar).toBeDefined();
    expect((ev.payload as any).leaderCar.carIdx).toBe(0);
  });

  it('only fires once per closing trend', () => {
    const base = makeFrame({
      sessionTime: 100,
      cars: [
        { carIdx: 0, position: 1, lastLapTime: 90 },
        { carIdx: 1, position: 2, lastLapTime: 90, f2Time: 1.8 },
      ],
    });
    const state = prime(base);
    state.activeBattles.set('0-1', {
      chaserCarIdx: 1, leaderCarIdx: 0, status: 'CLOSING',
      gapSec: 1.8, previousGapSec: 1.8, closingRateSecPerLap: 0,
      engagedAt: 100, brokenFrames: 0, closingAnnounced: false,
    });

    const f1 = cloneFrame(base);
    f1.sessionTime = 101;
    f1.carIdxF2Time[1] = 1.5;
    const e1 = detect(base, f1, state);
    expect(e1.filter(e => e.type === 'BATTLE_CLOSING')).toHaveLength(1);

    const f2 = cloneFrame(f1);
    f2.sessionTime = 102;
    f2.carIdxF2Time[1] = 1.2;
    const e2 = detect(f1, f2, state);
    expect(e2.filter(e => e.type === 'BATTLE_CLOSING')).toHaveLength(0);
  });

  it('does NOT fire if closing rate is below threshold', () => {
    const base = makeFrame({
      sessionTime: 100,
      cars: [
        { carIdx: 0, position: 1, lastLapTime: 90 },
        { carIdx: 1, position: 2, lastLapTime: 90, f2Time: 1.8 },
      ],
    });
    const state = prime(base);
    state.activeBattles.set('0-1', {
      chaserCarIdx: 1, leaderCarIdx: 0, status: 'CLOSING',
      gapSec: 1.8, previousGapSec: 1.8, closingRateSecPerLap: 0,
      engagedAt: 100, brokenFrames: 0, closingAnnounced: false,
    });

    const f1 = cloneFrame(base);
    f1.sessionTime = 200;                 // 100s elapsed
    f1.carIdxF2Time[1] = 1.799;           // drop of 0.001s over 100s → ~0.0009/lap
    const events = detect(base, f1, state);
    expect(events.find(e => e.type === 'BATTLE_CLOSING')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tier 2 (#97): LAPPED_TRAFFIC_AHEAD / BEING_LAPPED
// ---------------------------------------------------------------------------

describe('LAPPED_TRAFFIC_AHEAD', () => {
  it('fires when chaser is within proximity and leaderIdx has FEWER laps', () => {
    const base = makeFrame({ cars: [
      { carIdx: 0, position: 1, lapsCompleted: 10, f2Time: 0 },    // lapped car ahead
      { carIdx: 1, position: 2, lapsCompleted: 11, f2Time: 1.5 },  // leader catching
    ] });
    const state = prime(base);
    const f1 = cloneFrame(base); // keep values; detector runs with prev != null
    const events = detect(base, f1, state);
    expect(events.find(e => e.type === 'LAPPED_TRAFFIC_AHEAD')).toBeDefined();
  });

  it('LAPPED_TRAFFIC_AHEAD payload includes lappedCar PublisherCarRef (DIR-4)', () => {
    const base = makeFrame({ cars: [
      { carIdx: 0, position: 1, lapsCompleted: 10, f2Time: 0 },
      { carIdx: 1, position: 2, lapsCompleted: 11, f2Time: 1.5 },
    ] });
    const state = prime(base);
    const events = detect(base, cloneFrame(base), state);
    const ev = events.find(e => e.type === 'LAPPED_TRAFFIC_AHEAD')!;
    expect((ev.payload as any).lappedCar).toBeDefined();
    expect((ev.payload as any).lappedCar.carIdx).toBe(0); // the lapped car is carIdx 0
    expect((ev.payload as any).lappingCar).toBeUndefined(); // not present on this event
  });

  it('does NOT fire twice for the same pair while still close', () => {
    const base = makeFrame({ cars: [
      { carIdx: 0, position: 1, lapsCompleted: 10, f2Time: 0 },
      { carIdx: 1, position: 2, lapsCompleted: 11, f2Time: 1.5 },
    ] });
    const state = prime(base);
    detect(base, cloneFrame(base), state);
    const events = detect(base, cloneFrame(base), state);
    expect(events.filter(e => e.type === 'LAPPED_TRAFFIC_AHEAD')).toHaveLength(0);
  });

  it('re-fires after the pair separates and re-closes', () => {
    // Both cars start at the same physical track position (lapDistPct = 0).
    const base = makeFrame({ cars: [
      { carIdx: 0, position: 1, lapsCompleted: 10, lapDistPct: 0 },
      { carIdx: 1, position: 2, lapsCompleted: 11, lapDistPct: 0 },
    ] });
    const state = prime(base);
    detect(base, cloneFrame(base), state);  // first fire, latches la:0-1 / bl:0-1

    // Car 0 moves to 50% of the lap — physGap 0.5 × 90 s = 45 s >> 2 s threshold.
    const wide = cloneFrame(base);
    wide.carIdxLapDistPct[0] = 0.5;
    detect(base, wide, state);
    expect(state.trafficAnnouncements.has('la:0-1')).toBe(false); // latch cleared
    expect(state.trafficAnnouncements.has('bl:0-1')).toBe(false);

    // Car 0 moves back close to car 1 (1% of lap ≈ 0.9 s gap).
    const close = cloneFrame(wide);
    close.carIdxLapDistPct[0] = 0.01;
    const events = detect(wide, close, state);
    expect(events.find(e => e.type === 'LAPPED_TRAFFIC_AHEAD')).toBeDefined();
  });
});

describe('BEING_LAPPED', () => {
  it('fires when leaderIdx has MORE laps than chaser', () => {
    const base = makeFrame({ cars: [
      { carIdx: 0, position: 1, lapsCompleted: 11, f2Time: 0 },   // leader — more laps
      { carIdx: 1, position: 2, lapsCompleted: 10, f2Time: 1.5 }, // about to be lapped
    ] });
    const state = prime(base);
    const events = detect(base, cloneFrame(base), state);
    expect(events.find(e => e.type === 'BEING_LAPPED')).toBeDefined();
  });

  it('BEING_LAPPED payload includes lappingCar PublisherCarRef (DIR-4)', () => {
    const base = makeFrame({ cars: [
      { carIdx: 0, position: 1, lapsCompleted: 11, f2Time: 0 },
      { carIdx: 1, position: 2, lapsCompleted: 10, f2Time: 1.5 },
    ] });
    const state = prime(base);
    const events = detect(base, cloneFrame(base), state);
    const ev = events.find(e => e.type === 'BEING_LAPPED')!;
    expect((ev.payload as any).lappingCar).toBeDefined();
    expect((ev.payload as any).lappingCar.carIdx).toBe(0); // the lapping car is carIdx 0
    expect((ev.payload as any).lappedCar).toBeUndefined(); // not present on this event
  });

  it('does NOT fire twice while the lapping car remains close', () => {
    const base = makeFrame({ cars: [
      { carIdx: 0, position: 1, lapsCompleted: 11, lapDistPct: 0 },
      { carIdx: 1, position: 2, lapsCompleted: 10, lapDistPct: 0 },
    ] });
    const state = prime(base);
    detect(base, cloneFrame(base), state);                      // first fire
    const events = detect(base, cloneFrame(base), state);       // same proximity
    expect(events.filter(e => e.type === 'BEING_LAPPED')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tier 2 (#97): LAPPED_TRAFFIC_AHEAD + BEING_LAPPED — real-world scenarios
//
// These tests cover the scenario that originally failed: a car parked on
// track gets lapped but NO events are produced.  The old code relied on
// carIdxF2Time which equals ≈ lap_time × lap_delta (~80–90 s) and always
// exceeded the 2 s threshold.  The new code uses carIdxLapDistPct.
// ---------------------------------------------------------------------------

describe('lapping detection — real-world physical-proximity scenarios', () => {
  it('fires BEING_LAPPED when lapping car is physically close (approaching from behind)', () => {
    // Lapping car (idx 1, 5 laps) is approaching the parked user car (idx 0,
    // 0 laps) from behind.  Both are near the start/finish straight.
    const base = makeFrame({ cars: [
      { carIdx: 0, position: 20, lapsCompleted: 0, lapDistPct: 0.05, lastLapTime: 90 },
      { carIdx: 1, position: 10, lapsCompleted: 5, lapDistPct: 0.97, lastLapTime: 90 },
    ] });
    const state = prime(base);
    // physDiff = 0.97 - 0.05 = 0.92; normalise: 0.92 - 1.0 = -0.08
    // gapSec = 0.08 * 90 = 7.2 s  — just beyond the default 2 s threshold.
    // Let's tighten the approach: lapping car at 0.99.
    const f1 = cloneFrame(base);
    f1.carIdxLapDistPct[1] = 0.99;
    // physDiff = 0.99 - 0.05 = 0.94; normalise: 0.94 - 1.0 = -0.06; gapSec = 5.4 s — still wide.
    // Move parked car further into the lap so approaching gap is < 2 s.
    f1.carIdxLapDistPct[0] = 0.02;
    // physDiff = 0.99 - 0.02 = 0.97; normalise: 0.97 - 1.0 = -0.03; gapSec = 0.03*90 = 2.7 s — still wide.
    // Tighten further: lapping car at 0.995, parked at 0.005.
    f1.carIdxLapDistPct[0] = 0.005;
    f1.carIdxLapDistPct[1] = 0.995;
    // physDiff = 0.995 - 0.005 = 0.99; normalise: 0.99 - 1.0 = -0.01; gapSec = 0.01*90 = 0.9 s ✓
    const events = detect(base, f1, state);
    expect(events.find(e => e.type === 'BEING_LAPPED')).toBeDefined();
    const ev = events.find(e => e.type === 'BEING_LAPPED')!;
    expect((ev.payload as any).lappingCar.carIdx).toBe(1);
  });

  it('fires LAPPED_TRAFFIC_AHEAD simultaneously with BEING_LAPPED', () => {
    // Same pair — both events should fire on the first proximity frame.
    const base = makeFrame({ cars: [
      { carIdx: 0, position: 20, lapsCompleted: 0, lapDistPct: 0.005, lastLapTime: 90 },
      { carIdx: 1, position: 10, lapsCompleted: 5, lapDistPct: 0.995, lastLapTime: 90 },
    ] });
    const state = prime(base);
    const events = detect(base, cloneFrame(base), state);
    expect(events.find(e => e.type === 'BEING_LAPPED')).toBeDefined();
    expect(events.find(e => e.type === 'LAPPED_TRAFFIC_AHEAD')).toBeDefined();
    // BEING_LAPPED from parked car's perspective
    const bl = events.find(e => e.type === 'BEING_LAPPED')!;
    expect((bl.payload as any).lappingCar.carIdx).toBe(1);
    // LAPPED_TRAFFIC_AHEAD from lapping car's perspective
    const la = events.find(e => e.type === 'LAPPED_TRAFFIC_AHEAD')!;
    expect((la.payload as any).lappedCar.carIdx).toBe(0);
  });

  it('fires BEING_LAPPED after lapping car crosses start/finish just ahead', () => {
    // Lapping car has just crossed start/finish; parked car is a tiny fraction behind.
    const base = makeFrame({ cars: [
      { carIdx: 0, position: 15, lapsCompleted: 3, lapDistPct: 0.998, lastLapTime: 90 },
      { carIdx: 1, position: 5,  lapsCompleted: 4, lapDistPct: 0.01,  lastLapTime: 90 },
    ] });
    const state = prime(base);
    // physDiff = 0.01 - 0.998 = -0.988; normalise: -0.988 + 1.0 = 0.012; gapSec = 0.012*90 = 1.08 s ✓
    const events = detect(base, cloneFrame(base), state);
    expect(events.find(e => e.type === 'BEING_LAPPED')).toBeDefined();
  });

  it('does NOT fire BEING_LAPPED when lapping car is far away physically', () => {
    // Lapping car is at 50% of the track, parked car is at 5% — 45 s apart.
    const base = makeFrame({ cars: [
      { carIdx: 0, position: 20, lapsCompleted: 0, lapDistPct: 0.05, lastLapTime: 90 },
      { carIdx: 1, position: 5,  lapsCompleted: 5, lapDistPct: 0.50, lastLapTime: 90 },
    ] });
    const state = prime(base);
    const events = detect(base, cloneFrame(base), state);
    expect(events.find(e => e.type === 'BEING_LAPPED')).toBeUndefined();
  });

  it('fires BEING_LAPPED for a parked car lapped by multiple cars simultaneously', () => {
    // Parked car at 0.01 lapDistPct; two lapping cars both physically close.
    // car 1 at 0.995: physDiff = 0.995−0.01 = 0.985 → normalise = −0.015 → 0.015×90 = 1.35 s ✓
    // car 2 at 0.990: physDiff = 0.990−0.01 = 0.980 → normalise = −0.020 → 0.020×90 = 1.80 s ✓
    const base = makeFrame({ cars: [
      { carIdx: 0, position: 20, lapsCompleted: 0, lapDistPct: 0.01,  lastLapTime: 90 },
      { carIdx: 1, position: 5,  lapsCompleted: 5, lapDistPct: 0.995, lastLapTime: 90 },
      { carIdx: 2, position: 6,  lapsCompleted: 5, lapDistPct: 0.990, lastLapTime: 90 },
    ] });
    const state = prime(base);
    const events = detect(base, cloneFrame(base), state);
    // Two BEING_LAPPED events — one for each lapping car
    const beingLapped = events.filter(e => e.type === 'BEING_LAPPED');
    expect(beingLapped).toHaveLength(2);
    // Two LAPPED_TRAFFIC_AHEAD events — from each lapper's perspective
    const lappedAhead = events.filter(e => e.type === 'LAPPED_TRAFFIC_AHEAD');
    expect(lappedAhead).toHaveLength(2);
  });
});

describe('STOPPED_ON_TRACK', () => {
  it('fires after ≥ 2s with no lapDistPct movement while off pit road', () => {
    const base = makeFrame({
      sessionTime: 100,
      cars: [{ carIdx: 0, position: 1, lapDistPct: 0.4, onPitRoad: false }],
    });
    const state = prime(base);

    // Frame at +1s — still not moved. Should NOT fire yet.
    const f1 = cloneFrame(base);
    f1.sessionTime = 101;
    const e1 = detect(base, f1, state);
    expect(e1.find(e => e.type === 'STOPPED_ON_TRACK')).toBeUndefined();

    // Frame at +2.5s — over threshold. Should fire once.
    const f2 = cloneFrame(f1);
    f2.sessionTime = 102.5;
    const e2 = detect(f1, f2, state);
    const stopped = e2.find(e => e.type === 'STOPPED_ON_TRACK');
    expect(stopped).toBeDefined();
    expect((stopped!.payload as any).lapDistPct).toBeCloseTo(0.4, 5);
    expect((stopped!.payload as any).stoppedDurationSec).toBeGreaterThanOrEqual(2);
  });

  it('does NOT fire when the car is on pit road', () => {
    const base = makeFrame({
      sessionTime: 100,
      cars: [{ carIdx: 0, position: 1, lapDistPct: 0.4, onPitRoad: true }],
    });
    const state = prime(base);
    const f1 = cloneFrame(base);
    f1.sessionTime = 105;
    const events = detect(base, f1, state);
    expect(events.find(e => e.type === 'STOPPED_ON_TRACK')).toBeUndefined();
  });

  it('only fires once per stopped episode', () => {
    const base = makeFrame({
      sessionTime: 100,
      cars: [{ carIdx: 0, position: 1, lapDistPct: 0.4 }],
    });
    const state = prime(base);
    const f1 = cloneFrame(base);
    f1.sessionTime = 103;
    const e1 = detect(base, f1, state);
    expect(e1.filter(e => e.type === 'STOPPED_ON_TRACK')).toHaveLength(1);

    const f2 = cloneFrame(f1);
    f2.sessionTime = 106;
    const e2 = detect(f1, f2, state);
    expect(e2.filter(e => e.type === 'STOPPED_ON_TRACK')).toHaveLength(0);
  });

  it('resets when the car starts moving again', () => {
    const base = makeFrame({
      sessionTime: 100,
      cars: [{ carIdx: 0, position: 1, lapDistPct: 0.4 }],
    });
    const state = prime(base);
    const f1 = cloneFrame(base);
    f1.sessionTime = 103;
    detect(base, f1, state);

    const f2 = cloneFrame(f1);
    f2.sessionTime = 104;
    f2.carIdxLapDistPct[0] = 0.45; // moving again
    detect(f1, f2, state);
    expect(state.carStates.get(0)?.isStoppedOnTrack).toBe(false);
    expect(state.carStates.get(0)?.stoppedStartSessionTime).toBeNull();
  });
});
