/**
 * overall-position-detector.test.ts
 */
import { describe, it, expect } from 'vitest';
import { detectOverallPositionChange } from '../driver-publisher/overall-position-detector';
import { aggregateRaceState } from '../shared/race-state-aggregator';
import { createSessionState } from '../session-state';
import { makeFrame, seedRoster } from './frame-fixtures';
import type { TelemetryFrame } from '../session-state';

const PLAYER = 0;
const OTHER  = 1;
const ctx = { rigId: 'r1', raceSessionId: 's1', playerCarIdx: PLAYER };

function runFrames(
  positionSequence: number[],
  otherPosition = 99,
): { events: any[]; state: ReturnType<typeof createSessionState> } {
  const state = createSessionState('s1', 1);
  seedRoster(state, [PLAYER, OTHER]);
  let prev: TelemetryFrame | null = null;
  const allEvents: any[] = [];

  for (const pos of positionSequence) {
    const frame = makeFrame({
      cars: [
        { carIdx: PLAYER, position: pos },
        { carIdx: OTHER,  position: otherPosition },
      ],
    });
    aggregateRaceState(prev, frame, state, { playerCarIdx: PLAYER });
    allEvents.push(...detectOverallPositionChange(prev, frame, state, ctx));
    prev = frame;
  }
  return { events: allEvents, state };
}

describe('detectOverallPositionChange', () => {
  it('emits OVERALL_POSITION_LOSS after 2-frame hysteresis when position increases', () => {
    // Player starts at 3, drops to 4 and holds — loses a position
    const { events } = runFrames([3, 3, 4, 4, 4]);
    const losses = events.filter((e) => e.type === 'OVERALL_POSITION_LOSS');
    expect(losses).toHaveLength(1);
    expect(losses[0].payload.previousPosition).toBe(3);
    expect(losses[0].payload.newPosition).toBe(4);
    expect(losses[0].payload.reason).toBe('overtake');
  });

  it('emits OVERALL_POSITION_GAIN after 2-frame hysteresis when position decreases', () => {
    const { events } = runFrames([4, 4, 3, 3, 3]);
    const gains = events.filter((e) => e.type === 'OVERALL_POSITION_GAIN');
    expect(gains).toHaveLength(1);
    expect(gains[0].payload.previousPosition).toBe(4);
    expect(gains[0].payload.newPosition).toBe(3);
  });

  it('does not emit on the first frame where position changes (requires hysteresis)', () => {
    const state = createSessionState('s1', 1);
    seedRoster(state, [PLAYER]);
    let prev: TelemetryFrame | null = null;
    const allEvents: any[] = [];

    // Positions: 3, 4 — only one frame at 4; should not fire yet
    for (const pos of [3, 4]) {
      const frame = makeFrame({ cars: [{ carIdx: PLAYER, position: pos }] });
      aggregateRaceState(prev, frame, state, { playerCarIdx: PLAYER });
      allEvents.push(...detectOverallPositionChange(prev, frame, state, ctx));
      prev = frame;
    }
    expect(allEvents.filter((e) => e.type === 'OVERALL_POSITION_LOSS')).toHaveLength(0);
  });

  it('emits only once for a sustained position change', () => {
    const { events } = runFrames([3, 3, 4, 4, 4, 4, 4]);
    expect(events.filter((e) => e.type === 'OVERALL_POSITION_LOSS')).toHaveLength(1);
  });

  it('identifies the overtaking car on OVERALL_POSITION_LOSS', () => {
    const state = createSessionState('s1', 1);
    seedRoster(state, [PLAYER, OTHER]);
    let prev: TelemetryFrame | null = null;
    const allEvents: any[] = [];

    // Frame 1-2: player at 3, other at 4
    // Frame 3-5: player at 4, other at 3 (OTHER passed PLAYER)
    const sequence = [
      { player: 3, other: 4 },
      { player: 3, other: 4 },
      { player: 4, other: 3 },
      { player: 4, other: 3 },
      { player: 4, other: 3 },
    ];
    for (const { player, other } of sequence) {
      const frame = makeFrame({
        cars: [
          { carIdx: PLAYER, position: player },
          { carIdx: OTHER,  position: other },
        ],
      });
      aggregateRaceState(prev, frame, state, { playerCarIdx: PLAYER });
      allEvents.push(...detectOverallPositionChange(prev, frame, state, ctx));
      prev = frame;
    }

    const loss = allEvents.find((e) => e.type === 'OVERALL_POSITION_LOSS');
    expect(loss).toBeDefined();
    expect(loss.payload.overtakingCar).toBeDefined();
    expect(loss.payload.overtakingCar.carIdx).toBe(OTHER);
  });

  it('labels reason as pit_cycle when player is on pit road', () => {
    const state = createSessionState('s1', 1);
    seedRoster(state, [PLAYER]);
    let prev: TelemetryFrame | null = null;
    const allEvents: any[] = [];

    for (const [pos, onPit] of [[3, false], [3, false], [4, true], [4, true], [4, false]] as [number, boolean][]) {
      const frame = makeFrame({ cars: [{ carIdx: PLAYER, position: pos, onPitRoad: onPit }] });
      aggregateRaceState(prev, frame, state, { playerCarIdx: PLAYER });
      allEvents.push(...detectOverallPositionChange(prev, frame, state, ctx));
      prev = frame;
    }

    const loss = allEvents.find((e) => e.type === 'OVERALL_POSITION_LOSS');
    expect(loss).toBeDefined();
    expect(loss.payload.reason).toBe('pit_cycle');
  });

  it('emits multiple OVERALL_POSITION_LOSS events for consecutive passes while stopped', () => {
    // Simulates being passed repeatedly while stopped on track
    const state = createSessionState('s1', 1);
    seedRoster(state, [PLAYER]);
    let prev: TelemetryFrame | null = null;
    const allEvents: any[] = [];

    // Positions: 3 → 4 → 5 → 6 (passed 3 times)
    const positions = [3, 3, 4, 4, 5, 5, 6, 6, 6];
    for (const pos of positions) {
      const frame = makeFrame({ cars: [{ carIdx: PLAYER, position: pos }] });
      aggregateRaceState(prev, frame, state, { playerCarIdx: PLAYER });
      allEvents.push(...detectOverallPositionChange(prev, frame, state, ctx));
      prev = frame;
    }

    const losses = allEvents.filter((e) => e.type === 'OVERALL_POSITION_LOSS');
    expect(losses).toHaveLength(3);
    expect(losses[0].payload.newPosition).toBe(4);
    expect(losses[1].payload.newPosition).toBe(5);
    expect(losses[2].payload.newPosition).toBe(6);
  });

  it('returns empty when playerCarIdx < 0', () => {
    const state = createSessionState('s1', 1);
    const frame = makeFrame({ cars: [{ carIdx: 0, position: 3 }] });
    const events = detectOverallPositionChange(null, frame, state, {
      rigId: 'r1', raceSessionId: 's1', playerCarIdx: -1,
    });
    expect(events).toHaveLength(0);
  });
});
