import { describe, it, expect } from 'vitest';
import { detectLapCompleted } from '../session-publisher/lap-completed-detector';
import { createSessionState } from '../session-state';
import { makeFrame } from './frame-fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CTX = { publisherCode: 'rig-01', raceSessionId: 'session-abc' };

function makeState() {
  return createSessionState('session-abc', 1);
}

// Typed helper so we get the payload type properly
function detect(
  prev: ReturnType<typeof makeFrame> | null,
  curr: ReturnType<typeof makeFrame>,
) {
  return detectLapCompleted(prev, curr, makeState(), CTX);
}

// ---------------------------------------------------------------------------
// Basic detection
// ---------------------------------------------------------------------------

describe('LAP_COMPLETED basic detection', () => {
  it('returns empty array when prev is null', () => {
    const curr = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 5 }] });
    expect(detect(null, curr)).toHaveLength(0);
  });

  it('returns empty when no car incremented laps', () => {
    const prev = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 5 }] });
    const curr = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 5 }] });
    expect(detect(prev, curr)).toHaveLength(0);
  });

  it('fires for a single car increment', () => {
    const prev = makeFrame({ cars: [{ carIdx: 3, lapsCompleted: 5 }] });
    const curr = makeFrame({ cars: [{ carIdx: 3, lapsCompleted: 6 }] });
    const events = detect(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('LAP_COMPLETED');
  });

  it('does not fire when lapsCompleted is the same', () => {
    const prev = makeFrame({ cars: [{ carIdx: 1, lapsCompleted: 3 }] });
    const curr = makeFrame({ cars: [{ carIdx: 1, lapsCompleted: 3 }] });
    const events = detect(prev, curr);
    expect(events.filter(e => e.type === 'LAP_COMPLETED')).toHaveLength(0);
  });

  it('does not fire when lapsCompleted decreases (guard against bad data)', () => {
    const prev = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 5 }] });
    const curr = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 4 }] });
    expect(detect(prev, curr)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Multi-car
// ---------------------------------------------------------------------------

describe('LAP_COMPLETED multi-car', () => {
  it('fires for multiple cars incrementing in the same frame', () => {
    const prev = makeFrame({
      cars: [
        { carIdx: 0, lapsCompleted: 3 },
        { carIdx: 1, lapsCompleted: 3 },
        { carIdx: 5, lapsCompleted: 2 },
      ],
    });
    const curr = makeFrame({
      cars: [
        { carIdx: 0, lapsCompleted: 4 },
        { carIdx: 1, lapsCompleted: 4 },
        { carIdx: 5, lapsCompleted: 3 },
      ],
    });
    const events = detect(prev, curr);
    expect(events.filter(e => e.type === 'LAP_COMPLETED')).toHaveLength(3);
  });

  it('fires only for cars that actually incremented', () => {
    const prev = makeFrame({
      cars: [
        { carIdx: 0, lapsCompleted: 3 },
        { carIdx: 1, lapsCompleted: 3 },
      ],
    });
    const curr = makeFrame({
      cars: [
        { carIdx: 0, lapsCompleted: 4 }, // incremented
        { carIdx: 1, lapsCompleted: 3 }, // unchanged
      ],
    });
    const events = detect(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].car.carIdx).toBe(0);
  });

  it('works for all 64 car slots', () => {
    const cars = Array.from({ length: 64 }, (_, i) => ({ carIdx: i, lapsCompleted: 1 }));
    const prev = makeFrame({ cars });
    const carsNext = Array.from({ length: 64 }, (_, i) => ({ carIdx: i, lapsCompleted: 2 }));
    const curr = makeFrame({ cars: carsNext });
    const events = detect(prev, curr);
    expect(events.filter(e => e.type === 'LAP_COMPLETED')).toHaveLength(64);
  });
});

// ---------------------------------------------------------------------------
// Payload correctness
// ---------------------------------------------------------------------------

describe('LAP_COMPLETED payload', () => {
  it('lapNumber is the new lapsCompleted value', () => {
    const prev = makeFrame({ cars: [{ carIdx: 2, lapsCompleted: 7 }] });
    const curr = makeFrame({ cars: [{ carIdx: 2, lapsCompleted: 8 }] });
    const [ev] = detect(prev, curr);
    expect((ev.payload as any).lapNumber).toBe(8);
  });

  it('lapTime comes from carIdxLastLapTime', () => {
    const prev = makeFrame({ cars: [{ carIdx: 5, lapsCompleted: 2 }] });
    const curr = makeFrame({ cars: [{ carIdx: 5, lapsCompleted: 3, lastLapTime: 95.75 }] });
    const [ev] = detect(prev, curr);
    expect((ev.payload as any).lapTime).toBeCloseTo(95.75, 1);
  });

  it('position comes from carIdxPosition', () => {
    const prev = makeFrame({ cars: [{ carIdx: 10, lapsCompleted: 1 }] });
    const curr = makeFrame({ cars: [{ carIdx: 10, lapsCompleted: 2, position: 4 }] });
    const [ev] = detect(prev, curr);
    expect((ev.payload as any).position).toBe(4);
  });

  it('classPosition comes from carIdxClassPosition', () => {
    const prev = makeFrame({ cars: [{ carIdx: 10, lapsCompleted: 1 }] });
    const curr = makeFrame({ cars: [{ carIdx: 10, lapsCompleted: 2, classPosition: 2 }] });
    const [ev] = detect(prev, curr);
    expect((ev.payload as any).classPosition).toBe(2);
  });

  it('gapToLeaderSec comes from carIdxF2Time', () => {
    const prev = makeFrame({ cars: [{ carIdx: 7, lapsCompleted: 5 }] });
    const curr = makeFrame({ cars: [{ carIdx: 7, lapsCompleted: 6, f2Time: 8.3 }] });
    const [ev] = detect(prev, curr);
    expect((ev.payload as any).gapToLeaderSec).toBeCloseTo(8.3, 1);
  });
});

// ---------------------------------------------------------------------------
// Car ref
// ---------------------------------------------------------------------------

describe('LAP_COMPLETED car ref', () => {
  it('event car.carIdx matches the car that crossed the line', () => {
    const prev = makeFrame({ cars: [{ carIdx: 15, lapsCompleted: 10 }] });
    const curr = makeFrame({ cars: [{ carIdx: 15, lapsCompleted: 11 }] });
    const [ev] = detect(prev, curr);
    expect(ev.car.carIdx).toBe(15);
  });

  it('each event has a unique UUID id', () => {
    const cars = Array.from({ length: 3 }, (_, i) => ({ carIdx: i, lapsCompleted: 1 }));
    const prev = makeFrame({ cars });
    const carsNext = Array.from({ length: 3 }, (_, i) => ({ carIdx: i, lapsCompleted: 2 }));
    const curr = makeFrame({ cars: carsNext });
    const events = detect(prev, curr);
    const ids = events.map(e => e.id);
    expect(new Set(ids).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

describe('LAP_COMPLETED envelope', () => {
  it('all events carry the correct raceSessionId', () => {
    const prev = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 1 }] });
    const curr = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 2 }] });
    const [ev] = detect(prev, curr);
    expect(ev.raceSessionId).toBe('session-abc');
  });

  it('all events carry the correct publisherCode', () => {
    const prev = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 1 }] });
    const curr = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 2 }] });
    const [ev] = detect(prev, curr);
    expect(ev.publisherCode).toBe('rig-01');
  });

  it('sessionTick and sessionTime are taken from the current frame', () => {
    const prev = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 1 }] });
    const curr = makeFrame({ sessionTick: 5000, sessionTime: 600, cars: [{ carIdx: 0, lapsCompleted: 2 }] });
    const [ev] = detect(prev, curr);
    expect(ev.sessionTick).toBe(5000);
    expect(ev.sessionTime).toBe(600);
  });
});
