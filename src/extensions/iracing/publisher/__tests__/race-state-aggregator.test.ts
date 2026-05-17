/**
 * race-state-aggregator.test.ts — #151 / #152
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateRaceState,
  GAP_WINDOW_SIZE,
  CLASS_POSITION_HISTORY_SIZE,
} from '../shared/race-state-aggregator';
import { createSessionState, getOrCreateCarState } from '../session-state';
import { makeFrame, seedRoster } from './frame-fixtures';

describe('RaceStateAggregator (#151 / #152)', () => {
  it('rolls a 5-sample CarIdxF2Time window and computes a closing rate', () => {
    const state = createSessionState('s1', 1);
    seedRoster(state, [0, 1, 2]);
    let prev = makeFrame({ cars: [{ carIdx: 0, f2Time: 2.5, position: 2 }] });
    aggregateRaceState(null, prev, state, { playerCarIdx: 0 });
    for (const gap of [2.4, 2.3, 2.1, 1.8, 1.4]) {
      const next = makeFrame({ sessionTime: 1, cars: [{ carIdx: 0, f2Time: gap, position: 2 }] });
      aggregateRaceState(prev, next, state, { playerCarIdx: 0 });
      prev = next;
    }
    const cs = getOrCreateCarState(state, 0);
    expect(cs.recentGapToAhead.length).toBeLessThanOrEqual(GAP_WINDOW_SIZE);
    expect(cs.recentGapToAhead[cs.recentGapToAhead.length - 1]).toBeCloseTo(1.4, 5);
    // Window slope: oldest is 2.4 (fell out 2.5), newest is 1.4 → closing
    expect(cs.closingRateToAhead).toBeGreaterThan(0);
  });

  it('caps classPositionHistory to CLASS_POSITION_HISTORY_SIZE', () => {
    const state = createSessionState('s1', 1);
    seedRoster(state, [0]);
    let prev = makeFrame({ cars: [{ carIdx: 0, classPosition: 5 }] });
    aggregateRaceState(null, prev, state, { playerCarIdx: 0 });
    for (const cp of [4, 3, 2, 1]) {
      const next = makeFrame({ cars: [{ carIdx: 0, classPosition: cp }] });
      aggregateRaceState(prev, next, state, { playerCarIdx: 0 });
      prev = next;
    }
    const cs = getOrCreateCarState(state, 0);
    expect(cs.classPositionHistory.length).toBe(CLASS_POSITION_HISTORY_SIZE);
  });

  it('derives racePhase from sessionLapsTotal/Remain', () => {
    const state = createSessionState('s1', 1);
    aggregateRaceState(null, makeFrame({ sessionLapsTotal: 50, sessionLapsRemain: 45 }), state, { playerCarIdx: 0 });
    expect(state.racePhase).toBe('opening');
    aggregateRaceState(null, makeFrame({ sessionLapsTotal: 50, sessionLapsRemain: 25 }), state, { playerCarIdx: 0 });
    expect(state.racePhase).toBe('midrace');
    aggregateRaceState(null, makeFrame({ sessionLapsTotal: 50, sessionLapsRemain: 10 }), state, { playerCarIdx: 0 });
    expect(state.racePhase).toBe('endgame');
    aggregateRaceState(null, makeFrame({ sessionLapsTotal: 50, sessionLapsRemain: 3 }), state, { playerCarIdx: 0 });
    expect(state.racePhase).toBe('final-laps');
  });

  it('forms classGroups for same-class cars within 1.0s', () => {
    const state = createSessionState('s1', 1);
    // Three GT3 cars. Cars 0 and 1 are ~0.6s apart (in group), car 2 is ~4s
    // behind car 1 (out of group). Gaps are expressed as lapDistPct differences
    // since computeClassGroups now uses estimateSameClassGap (lapDistPct-based)
    // instead of CarIdxF2Time to avoid cross-class prototype pollution.
    // With lastLapTime=90s: 0.6s → Δpct≈0.00667; 4.0s → Δpct≈0.0444.
    seedRoster(state, [0, 1, 2], { carClassId: 100, carClassShortName: 'GT3' });
    const frame = makeFrame({
      cars: [
        { carIdx: 0, position: 1, classPosition: 1, lapsCompleted: 5, lapDistPct: 0.5,     lastLapTime: 90 },
        { carIdx: 1, position: 2, classPosition: 2, lapsCompleted: 5, lapDistPct: 0.4933,  lastLapTime: 90 },
        { carIdx: 2, position: 3, classPosition: 3, lapsCompleted: 5, lapDistPct: 0.4489 },
      ],
    });
    aggregateRaceState(null, frame, state, { playerCarIdx: 0 });
    const groups = state.classGroups.get(100) ?? [];
    expect(groups.length).toBe(1);
    expect(groups[0]).toEqual([0, 1]);
  });
});
