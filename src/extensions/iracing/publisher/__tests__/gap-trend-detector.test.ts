/**
 * gap-trend-detector.test.ts — Issue #153
 */
import { describe, it, expect } from 'vitest';
import { detectGapTrend } from '../driver-publisher/gap-trend-detector';
import { aggregateRaceState } from '../shared/race-state-aggregator';
import { createSessionState } from '../session-state';
import { makeFrame, seedRoster } from './frame-fixtures';
import type { TelemetryFrame } from '../session-state';

const PLAYER = 0;
const AHEAD = 1;
const ctx = { rigId: 'r1', raceSessionId: 's1', playerCarIdx: PLAYER };

describe('detectGapTrend (#153)', () => {
  it('emits GAP_CLOSING when gap shrinks 2.8 → 1.4 within 3.0s', () => {
    const state = createSessionState('s1', 1);
    seedRoster(state, [PLAYER, AHEAD]);
    let prev: TelemetryFrame | null = null;
    let allEvents: any[] = [];
    for (const [t, gap] of [[0, 2.8], [1, 2.4], [2, 2.0], [3, 1.5]] as Array<[number, number]>) {
      const frame = makeFrame({
        sessionTime: t,
        cars: [
          { carIdx: PLAYER, position: 2, f2Time: gap },
          { carIdx: AHEAD,  position: 1, f2Time: 0 },
        ],
      });
      aggregateRaceState(prev, frame, state, { playerCarIdx: PLAYER });
      const events = detectGapTrend(prev, frame, state, ctx);
      allEvents = allEvents.concat(events);
      prev = frame;
    }
    const closing = allEvents.filter((e) => e.type === 'GAP_CLOSING');
    expect(closing.length).toBeGreaterThanOrEqual(1);
    expect(closing[0].payload.direction).toBe('ahead');
    expect(closing[0].payload.closingRateSecPerLap).toBeGreaterThan(0);
  });

  it('does not emit when the gap is already > 3.0s', () => {
    const state = createSessionState('s1', 1);
    seedRoster(state, [PLAYER, AHEAD]);
    let prev: TelemetryFrame | null = null;
    let allEvents: any[] = [];
    for (const [t, gap] of [[0, 5.0], [1, 4.5], [2, 4.0], [3, 3.5]] as Array<[number, number]>) {
      const frame = makeFrame({
        sessionTime: t,
        cars: [
          { carIdx: PLAYER, position: 2, f2Time: gap },
          { carIdx: AHEAD,  position: 1, f2Time: 0 },
        ],
      });
      aggregateRaceState(prev, frame, state, { playerCarIdx: PLAYER });
      allEvents = allEvents.concat(detectGapTrend(prev, frame, state, ctx));
      prev = frame;
    }
    expect(allEvents.filter((e) => e.type === 'GAP_CLOSING')).toHaveLength(0);
  });

  it('emits GAP_OPENING when gap grows', () => {
    const state = createSessionState('s1', 1);
    seedRoster(state, [PLAYER, AHEAD]);
    let prev: TelemetryFrame | null = null;
    let allEvents: any[] = [];
    for (const [t, gap] of [[0, 1.0], [1, 1.4], [2, 1.8], [3, 2.4]] as Array<[number, number]>) {
      const frame = makeFrame({
        sessionTime: t,
        cars: [
          { carIdx: PLAYER, position: 2, f2Time: gap },
          { carIdx: AHEAD,  position: 1, f2Time: 0 },
        ],
      });
      aggregateRaceState(prev, frame, state, { playerCarIdx: PLAYER });
      allEvents = allEvents.concat(detectGapTrend(prev, frame, state, ctx));
      prev = frame;
    }
    expect(allEvents.some((e) => e.type === 'GAP_OPENING')).toBe(true);
  });
});
