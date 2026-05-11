/**
 * class-position-detector.test.ts — Issue #154
 */
import { describe, it, expect } from 'vitest';
import { detectClassPositionChange } from '../driver-publisher/class-position-detector';
import { aggregateRaceState } from '../shared/race-state-aggregator';
import { createSessionState } from '../session-state';
import { makeFrame, seedRoster } from './frame-fixtures';
import type { TelemetryFrame } from '../session-state';

const PLAYER = 0;
const ctx = { rigId: 'r1', raceSessionId: 's1', playerCarIdx: PLAYER };

describe('detectClassPositionChange (#154)', () => {
  it('emits CLASS_POSITION_GAIN after 2-frame hysteresis', () => {
    const state = createSessionState('s1', 1);
    seedRoster(state, [PLAYER]);
    let prev: TelemetryFrame | null = null;
    let allEvents: any[] = [];
    // Sequence: cp=3, cp=3, cp=2, cp=2, cp=2 (must see cp=2 twice in history before emit)
    for (const cp of [3, 3, 2, 2, 2]) {
      const frame = makeFrame({ cars: [{ carIdx: PLAYER, classPosition: cp }] });
      aggregateRaceState(prev, frame, state, { playerCarIdx: PLAYER });
      allEvents = allEvents.concat(detectClassPositionChange(prev, frame, state, ctx));
      prev = frame;
    }
    const gains = allEvents.filter((e) => e.type === 'CLASS_POSITION_GAIN');
    expect(gains.length).toBe(1);
    expect(gains[0].payload.previousClassPos).toBe(3);
    expect(gains[0].payload.newClassPos).toBe(2);
  });

  it('emits CLASS_POSITION_LOSS when classPosition increases', () => {
    const state = createSessionState('s1', 1);
    seedRoster(state, [PLAYER]);
    let prev: TelemetryFrame | null = null;
    let allEvents: any[] = [];
    for (const cp of [2, 2, 3, 3, 3]) {
      const frame = makeFrame({ cars: [{ carIdx: PLAYER, classPosition: cp }] });
      aggregateRaceState(prev, frame, state, { playerCarIdx: PLAYER });
      allEvents = allEvents.concat(detectClassPositionChange(prev, frame, state, ctx));
      prev = frame;
    }
    const losses = allEvents.filter((e) => e.type === 'CLASS_POSITION_LOSS');
    expect(losses.length).toBe(1);
  });
});
