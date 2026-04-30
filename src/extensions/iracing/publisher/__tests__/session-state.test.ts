import { describe, it, expect } from 'vitest';
import {
  createSessionState,
  getOrCreateCarState,
  battleKey,
  buildEvent,
  type TelemetryFrame,
} from '../session-state';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFrame(overrides: Partial<TelemetryFrame> = {}): TelemetryFrame {
  return {
    sessionTick: 1000,
    sessionTime: 120.5,
    sessionState: 4, // Racing
    sessionFlags: 0,
    sessionUniqueId: 42,
    carIdxPosition: new Int32Array(64),
    carIdxClassPosition: new Int32Array(64),
    carIdxOnPitRoad: new Uint8Array(64),
    carIdxTrackSurface: new Int32Array(64).fill(1),
    carIdxLastLapTime: new Float32Array(64),
    carIdxBestLapTime: new Float32Array(64),
    carIdxLapCompleted: new Int32Array(64),
    carIdxLapDistPct: new Float32Array(64),
    carIdxF2Time: new Float32Array(64),
    carIdxSessionFlags: new Int32Array(64),
    fuelLevel: 30.0,
    fuelLevelPct: 0.75,
    playerIncidentCount: 0,
    teamIncidentCount: 0,
    incidentLimit: 25,
    skies: 0,
    trackTemp: 32.0,
    windDir: 0,
    windVel: 2.1,
    relativeHumidity: 0.55,
    fogLevel: 0,
    speed: 40,
    steeringWheelAngle: 0,
    steeringWheelPctTorque: 0,
    solarAltitude: 0.3,
    carIdxSpeed: new Float32Array(64).fill(40),
    ...overrides,
  };
}

const TEST_SESSION_ID = 'test-session-abc';
const TEST_PUBLISHER_CODE = 'rig-01';

// ---------------------------------------------------------------------------
// createSessionState
// ---------------------------------------------------------------------------

describe('createSessionState', () => {
  it('creates a state with the given raceSessionId and sessionUniqueId', () => {
    const state = createSessionState(TEST_SESSION_ID, 42);
    expect(state.raceSessionId).toBe(TEST_SESSION_ID);
    expect(state.sessionUniqueId).toBe(42);
  });

  it('initialises with no previous frame', () => {
    const state = createSessionState(TEST_SESSION_ID, 42);
    expect(state.previousFrame).toBeNull();
  });

  it('initialises with empty car states and battles', () => {
    const state = createSessionState(TEST_SESSION_ID, 42);
    expect(state.carStates.size).toBe(0);
    expect(state.activeBattles.size).toBe(0);
  });

  it('initialises identity resolved as false', () => {
    const state = createSessionState(TEST_SESSION_ID, 42);
    expect(state.identityResolved).toBe(false);
  });

  it('initialises session-best lap time as 0', () => {
    const state = createSessionState(TEST_SESSION_ID, 42);
    expect(state.sessionBestLapTime).toBe(0);
  });

  it('initialises with empty fired incident warnings', () => {
    const state = createSessionState(TEST_SESSION_ID, 42);
    expect(state.firedIncidentWarnings.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getOrCreateCarState
// ---------------------------------------------------------------------------

describe('getOrCreateCarState', () => {
  it('creates a default entry when carIdx is new', () => {
    const state = createSessionState(TEST_SESSION_ID, 42);
    const car = getOrCreateCarState(state, 5);
    expect(car).toBeDefined();
    expect(car.position).toBe(0);
    expect(car.onPitRoad).toBe(false);
    expect(state.carStates.size).toBe(1);
  });

  it('returns the same object on repeated calls for the same carIdx', () => {
    const state = createSessionState(TEST_SESSION_ID, 42);
    const first = getOrCreateCarState(state, 3);
    first.position = 7;
    const second = getOrCreateCarState(state, 3);
    expect(second.position).toBe(7);
    expect(state.carStates.size).toBe(1);
  });

  it('stores separate state objects for different carIdxs', () => {
    const state = createSessionState(TEST_SESSION_ID, 42);
    getOrCreateCarState(state, 0).position = 1;
    getOrCreateCarState(state, 1).position = 2;
    expect(state.carStates.size).toBe(2);
    expect(state.carStates.get(0)!.position).toBe(1);
    expect(state.carStates.get(1)!.position).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// battleKey
// ---------------------------------------------------------------------------

describe('battleKey', () => {
  it('produces the same key regardless of argument order', () => {
    expect(battleKey(3, 7)).toBe(battleKey(7, 3));
  });

  it('always puts the lower carIdx first', () => {
    expect(battleKey(5, 2)).toBe('2-5');
    expect(battleKey(2, 5)).toBe('2-5');
  });

  it('handles equal carIdxs (degenerate case)', () => {
    expect(battleKey(4, 4)).toBe('4-4');
  });
});

// ---------------------------------------------------------------------------
// buildEvent
// ---------------------------------------------------------------------------

describe('buildEvent', () => {
  const frame = makeFrame();
  const car = { carIdx: 1, carNumber: '44', driverName: 'Lewis Hamilton' };
  const opts = { raceSessionId: TEST_SESSION_ID, rigId: TEST_PUBLISHER_CODE, frame, leaderLap: 5 };

  it('assigns a UUID id', () => {
    const event = buildEvent('OVERTAKE', car, { overtakingCarIdx: 1, overtakenCarIdx: 2, newPosition: 3, lap: 5, lapDistPct: 0.45 }, opts);
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets type, raceSessionId, rigId correctly', () => {
    const event = buildEvent('LAP_COMPLETED', car, { lapNumber: 3, lapTime: 89.4, position: 2, classPosition: 2, gapToLeaderSec: 1.2 }, opts);
    expect(event.type).toBe('LAP_COMPLETED');
    expect(event.raceSessionId).toBe(TEST_SESSION_ID);
    expect(event.rigId).toBe(TEST_PUBLISHER_CODE);
  });

  it('copies sessionTick and sessionTime from the frame', () => {
    const event = buildEvent('FLAG_GREEN', car, {}, opts);
    expect(event.sessionTick).toBe(frame.sessionTick);
    expect(event.sessionTime).toBe(frame.sessionTime);
  });

  it('populates context from frame and options', () => {
    const event = buildEvent('PIT_ENTRY', car, { entryLap: 5, position: 3, gapToLeaderSec: 4.5 }, opts);
    expect(event.context?.leaderLap).toBe(5);
    expect(event.context?.sessionFlags).toBe(frame.sessionFlags);
    expect(event.context?.trackTemp).toBe(frame.trackTemp);
  });

  it('produces a unique id on every call', () => {
    const e1 = buildEvent('FLAG_GREEN', car, {}, opts);
    const e2 = buildEvent('FLAG_GREEN', car, {}, opts);
    expect(e1.id).not.toBe(e2.id);
  });

  it('sets a timestamp close to Date.now()', () => {
    const before = Date.now();
    const event = buildEvent('FLAG_GREEN', car, {}, opts);
    const after = Date.now();
    expect(event.timestamp).toBeGreaterThanOrEqual(before);
    expect(event.timestamp).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// Session reset pattern (used by session lifecycle detector)
// ---------------------------------------------------------------------------

describe('session state reset', () => {
  it('a new createSessionState call produces an independent state', () => {
    const stateA = createSessionState('session-1', 1);
    getOrCreateCarState(stateA, 0).position = 5;
    stateA.sessionBestLapTime = 88.1;

    const stateB = createSessionState('session-1', 2);
    expect(stateB.carStates.size).toBe(0);
    expect(stateB.sessionBestLapTime).toBe(0);
  });
});
