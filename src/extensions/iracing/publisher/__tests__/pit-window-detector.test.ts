/**
 * pit-window-detector.test.ts — Issue #155
 */
import { describe, it, expect } from 'vitest';
import { detectPitWindow } from '../driver-publisher/pit-window-detector';
import { aggregateRaceState } from '../shared/race-state-aggregator';
import { createSessionState, getOrCreateCarState } from '../session-state';
import { createDriverState } from '../driver-state';
import { makeFrame, seedRoster } from './frame-fixtures';

const PLAYER = 0;
const ctx = { rigId: 'r1', raceSessionId: 's1', playerCarIdx: PLAYER };

describe('detectPitWindow (#155)', () => {
  it('emits IN_PIT_WINDOW once when within last 5 laps of the stint', () => {
    const state = createSessionState('s1', 1);
    const driverState = createDriverState(PLAYER);
    seedRoster(state, [PLAYER]);
    state.estimatedStintLaps = 30;
    // Simulate 26 laps in the stint — within the 5-lap window.
    const cs = getOrCreateCarState(state, PLAYER);
    cs.stintStartLap = 0;
    cs.lapsSinceLastPit = 26;
    cs.inPitWindow = true;

    const frame = makeFrame({ cars: [{ carIdx: PLAYER, lapsCompleted: 26 }] });
    const ev1 = detectPitWindow(frame, frame, state, driverState, ctx);
    const ev2 = detectPitWindow(frame, frame, state, driverState, ctx);
    expect(ev1.filter((e) => e.type === 'IN_PIT_WINDOW').length).toBe(1);
    expect(ev2.filter((e) => e.type === 'IN_PIT_WINDOW').length).toBe(0);
  });

  it('emits FUEL_PROJECTION at most once per lap when projection ≤ threshold', () => {
    const state = createSessionState('s1', 1);
    const driverState = createDriverState(PLAYER);
    seedRoster(state, [PLAYER]);
    state.estimatedStintLaps = 30;
    driverState.fuelPerLap = 2.5;
    const cs = getOrCreateCarState(state, PLAYER);
    cs.estimatedFuelLapsRemaining = 5; // ≤ 30

    const frameLap10 = makeFrame({ fuelLevel: 12.5, cars: [{ carIdx: PLAYER, lapsCompleted: 10 }] });
    const ev1 = detectPitWindow(frameLap10, frameLap10, state, driverState, ctx);
    const ev2 = detectPitWindow(frameLap10, frameLap10, state, driverState, ctx);
    expect(ev1.filter((e) => e.type === 'FUEL_PROJECTION').length).toBe(1);
    expect(ev2.filter((e) => e.type === 'FUEL_PROJECTION').length).toBe(0);

    // New lap → can fire again.
    const frameLap11 = makeFrame({ fuelLevel: 10.0, cars: [{ carIdx: PLAYER, lapsCompleted: 11 }] });
    const ev3 = detectPitWindow(frameLap11, frameLap11, state, driverState, ctx);
    expect(ev3.filter((e) => e.type === 'FUEL_PROJECTION').length).toBe(1);
  });
});
