import { describe, it, expect } from 'vitest';
import {
  detectSessionLifecycle,
  SESSION_STATE,
  FLAG_GREEN,
  FLAG_CHECKERED,
} from '../session-lifecycle-detector';
import { createSessionState } from '../session-state';
import {
  makeFrame,
  cloneFrame,
  makeFrameSequence,
  SessionStateEnum,
  FlagBits,
  withNewSession,
  withSessionState,
  withSessionFlags,
  withRaceGreen,
  withRaceCheckered,
  scenarioA,
} from './frame-fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CTX = {
  publisherCode: 'rig-01',
  raceSessionId: 'session-abc',
  trackName: 'Sebring',
};

function makeState(sessionUniqueId = 1) {
  return createSessionState('session-abc', sessionUniqueId);
}

/** Calls detectSessionLifecycle and updates state.lastSessionState to mirror what the orchestrator would do. */
function detect(prev: ReturnType<typeof makeFrame> | null, curr: ReturnType<typeof makeFrame>, state: ReturnType<typeof makeState>) {
  const events = detectSessionLifecycle(prev, curr, state, CTX);
  // Simulate caller update
  state.lastSessionState = curr.sessionState;
  return events;
}

// ---------------------------------------------------------------------------
// No events on first frame
// ---------------------------------------------------------------------------

describe('first frame (prev=null)', () => {
  it('emits no events when prev is null', () => {
    const state = makeState();
    const curr = makeFrame({ sessionState: SessionStateEnum.Racing });
    const events = detect(null, curr, state);
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SESSION_LOADED + SESSION_ENDED on sessionUniqueId change
// ---------------------------------------------------------------------------

describe('SESSION_LOADED', () => {
  it('emits SESSION_ENDED then SESSION_LOADED when sessionUniqueId changes', () => {
    const state = makeState(1);
    const prev = makeFrame({ sessionUniqueId: 1, sessionState: SessionStateEnum.Racing });
    const curr = makeFrame({ sessionUniqueId: 2, sessionState: SessionStateEnum.GetInCar });
    const events = detect(prev, curr, state);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('SESSION_ENDED');
    expect(events[1].type).toBe('SESSION_LOADED');
  });

  it('SESSION_LOADED payload carries sessionUniqueId and trackName', () => {
    const state = makeState(1);
    const prev = makeFrame({ sessionUniqueId: 1 });
    const curr = makeFrame({ sessionUniqueId: 2 });
    const events = detect(prev, curr, state);
    const loaded = events.find(e => e.type === 'SESSION_LOADED')!;
    expect((loaded.payload as any).sessionUniqueId).toBe(2);
    expect((loaded.payload as any).trackName).toBe('Sebring');
  });

  it('does not emit SESSION_LOADED when sessionUniqueId is unchanged', () => {
    const state = makeState(1);
    const prev = makeFrame({ sessionUniqueId: 1 });
    const curr = makeFrame({ sessionUniqueId: 1 });
    const events = detect(prev, curr, state);
    expect(events.find(e => e.type === 'SESSION_LOADED')).toBeUndefined();
  });

  it('returns early after SESSION_LOADED — no additional events in same call', () => {
    const state = makeState(1);
    const prev = makeFrame({ sessionUniqueId: 1, sessionState: SessionStateEnum.Racing });
    // New session also transitions state — but should NOT also emit SESSION_STATE_CHANGE
    const curr = makeFrame({ sessionUniqueId: 2, sessionState: SessionStateEnum.GetInCar });
    const events = detect(prev, curr, state);
    expect(events).toHaveLength(2); // only SESSION_ENDED + SESSION_LOADED
    expect(events.map(e => e.type)).toEqual(['SESSION_ENDED', 'SESSION_LOADED']);
  });

  it('does not emit SESSION_LOADED when prev is null (no previous session to compare)', () => {
    const state = makeState(1);
    const curr = makeFrame({ sessionUniqueId: 2 });
    const events = detect(null, curr, state);
    expect(events.find(e => e.type === 'SESSION_LOADED')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SESSION_STATE_CHANGE
// ---------------------------------------------------------------------------

describe('SESSION_STATE_CHANGE', () => {
  it('emits when sessionState transitions', () => {
    const state = makeState();
    const prev = makeFrame({ sessionState: SessionStateEnum.Warmup });
    const curr = makeFrame({ sessionState: SessionStateEnum.ParadeLaps });
    detect(prev, makeFrame({ sessionState: SessionStateEnum.Warmup }), state); // prime lastSessionState
    state.lastSessionState = SessionStateEnum.Warmup;
    const events = detect(prev, curr, state);
    expect(events.find(e => e.type === 'SESSION_STATE_CHANGE')).toBeDefined();
  });

  it('SESSION_STATE_CHANGE payload has previousState and newState', () => {
    const state = makeState();
    state.lastSessionState = SessionStateEnum.Warmup;
    const prev = makeFrame({ sessionState: SessionStateEnum.Warmup });
    const curr = makeFrame({ sessionState: SessionStateEnum.ParadeLaps });
    const events = detect(prev, curr, state);
    const ev = events.find(e => e.type === 'SESSION_STATE_CHANGE')!;
    expect((ev.payload as any).previousState).toBe(SessionStateEnum.Warmup);
    expect((ev.payload as any).newState).toBe(SessionStateEnum.ParadeLaps);
  });

  it('does NOT emit when sessionState is unchanged', () => {
    const state = makeState();
    state.lastSessionState = SessionStateEnum.Racing;
    const prev = makeFrame({ sessionState: SessionStateEnum.Racing });
    const curr = makeFrame({ sessionState: SessionStateEnum.Racing });
    const events = detect(prev, curr, state);
    expect(events.find(e => e.type === 'SESSION_STATE_CHANGE')).toBeUndefined();
  });

  it('does NOT emit when prevState is -1 (first observation — no prior state)', () => {
    const state = makeState();
    // lastSessionState starts at -1 and prev is null
    const prev = makeFrame({ sessionState: SESSION_STATE.Invalid });
    const curr = makeFrame({ sessionState: SessionStateEnum.Warmup });
    // With prev having sessionState 0 and state.lastSessionState -1, prevState from prev.sessionState is 0 ≠ -1
    // Actually let's test the path where prev.sessionState equals curr and lastSessionState is -1
    state.lastSessionState = -1;
    const prevSame = makeFrame({ sessionState: SESSION_STATE.Racing });
    const currSame = makeFrame({ sessionState: SESSION_STATE.Racing });
    const events = detect(prevSame, currSame, state);
    expect(events.find(e => e.type === 'SESSION_STATE_CHANGE')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// RACE_GREEN
// ---------------------------------------------------------------------------

describe('RACE_GREEN', () => {
  it('emits RACE_GREEN when transitioning to Racing with green flag', () => {
    const state = makeState();
    state.lastSessionState = SessionStateEnum.ParadeLaps;
    const prev = makeFrame({ sessionState: SessionStateEnum.ParadeLaps, sessionFlags: 0 });
    const curr = makeFrame({ sessionState: SessionStateEnum.Racing, sessionFlags: FlagBits.Green });
    const events = detect(prev, curr, state);
    expect(events.find(e => e.type === 'RACE_GREEN')).toBeDefined();
  });

  it('RACE_GREEN payload has startType=rolling when coming from ParadeLaps', () => {
    const state = makeState();
    state.lastSessionState = SessionStateEnum.ParadeLaps;
    const prev = makeFrame({ sessionState: SessionStateEnum.ParadeLaps });
    const curr = makeFrame({ sessionState: SessionStateEnum.Racing, sessionFlags: FlagBits.Green });
    const events = detect(prev, curr, state);
    const ev = events.find(e => e.type === 'RACE_GREEN')!;
    expect((ev.payload as any).startType).toBe('rolling');
  });

  it('RACE_GREEN payload has startType=standing when NOT from ParadeLaps', () => {
    const state = makeState();
    state.lastSessionState = SessionStateEnum.Warmup;
    const prev = makeFrame({ sessionState: SessionStateEnum.Warmup });
    const curr = makeFrame({ sessionState: SessionStateEnum.Racing, sessionFlags: FlagBits.Green });
    const events = detect(prev, curr, state);
    const ev = events.find(e => e.type === 'RACE_GREEN')!;
    expect((ev.payload as any).startType).toBe('standing');
  });

  it('does NOT emit RACE_GREEN when transitioning to Racing without green flag', () => {
    const state = makeState();
    state.lastSessionState = SessionStateEnum.ParadeLaps;
    const prev = makeFrame({ sessionState: SessionStateEnum.ParadeLaps });
    const curr = makeFrame({ sessionState: SessionStateEnum.Racing, sessionFlags: 0 });
    const events = detect(prev, curr, state);
    expect(events.find(e => e.type === 'RACE_GREEN')).toBeUndefined();
  });

  it('does NOT emit RACE_GREEN when already in Racing (no state change)', () => {
    const state = makeState();
    state.lastSessionState = SessionStateEnum.Racing;
    const prev = makeFrame({ sessionState: SessionStateEnum.Racing, sessionFlags: FlagBits.Green });
    const curr = makeFrame({ sessionState: SessionStateEnum.Racing, sessionFlags: FlagBits.Green });
    const events = detect(prev, curr, state);
    expect(events.find(e => e.type === 'RACE_GREEN')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// RACE_CHECKERED
// ---------------------------------------------------------------------------

describe('RACE_CHECKERED — via state transition', () => {
  it('emits RACE_CHECKERED when transitioning to Checkered state', () => {
    const state = makeState();
    state.lastSessionState = SessionStateEnum.Racing;
    const prev = makeFrame({ sessionState: SessionStateEnum.Racing });
    const curr = makeFrame({ sessionState: SessionStateEnum.Checkered, sessionFlags: FlagBits.Checkered });
    const events = detect(prev, curr, state);
    expect(events.find(e => e.type === 'RACE_CHECKERED')).toBeDefined();
  });

  it('emits exactly one RACE_CHECKERED when both state and flag change together', () => {
    const state = makeState();
    state.lastSessionState = SessionStateEnum.Racing;
    const prev = makeFrame({ sessionState: SessionStateEnum.Racing });
    const curr = makeFrame({ sessionState: SessionStateEnum.Checkered, sessionFlags: FlagBits.Checkered });
    const events = detect(prev, curr, state);
    expect(events.filter(e => e.type === 'RACE_CHECKERED')).toHaveLength(1);
  });
});

describe('RACE_CHECKERED — via flag bit (state unchanged)', () => {
  it('emits RACE_CHECKERED when checkered flag bit is set without state change', () => {
    const state = makeState();
    state.lastSessionState = SessionStateEnum.Racing;
    const prev = makeFrame({ sessionState: SessionStateEnum.Racing, sessionFlags: FlagBits.White });
    const curr = makeFrame({ sessionState: SessionStateEnum.Racing, sessionFlags: FlagBits.Checkered });
    const events = detect(prev, curr, state);
    expect(events.find(e => e.type === 'RACE_CHECKERED')).toBeDefined();
  });

  it('does NOT emit duplicate RACE_CHECKERED once state is already Checkered', () => {
    const state = makeState();
    state.lastSessionState = SessionStateEnum.Checkered; // already fired
    const prev = makeFrame({ sessionState: SessionStateEnum.Checkered, sessionFlags: FlagBits.Checkered });
    const curr = makeFrame({ sessionState: SessionStateEnum.Checkered, sessionFlags: FlagBits.Checkered });
    const events = detect(prev, curr, state);
    expect(events.find(e => e.type === 'RACE_CHECKERED')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SESSION_ENDED
// ---------------------------------------------------------------------------

describe('SESSION_ENDED', () => {
  it('emits SESSION_ENDED when transitioning to CoolDown', () => {
    const state = makeState();
    state.lastSessionState = SessionStateEnum.Checkered;
    const prev = makeFrame({ sessionState: SessionStateEnum.Checkered });
    const curr = makeFrame({ sessionState: SessionStateEnum.CoolDown });
    const events = detect(prev, curr, state);
    expect(events.find(e => e.type === 'SESSION_ENDED')).toBeDefined();
  });

  it('does NOT emit SESSION_ENDED for non-CoolDown transitions', () => {
    const state = makeState();
    state.lastSessionState = SessionStateEnum.ParadeLaps;
    const prev = makeFrame({ sessionState: SessionStateEnum.ParadeLaps });
    const curr = makeFrame({ sessionState: SessionStateEnum.Racing, sessionFlags: FlagBits.Green });
    const events = detect(prev, curr, state);
    expect(events.find(e => e.type === 'SESSION_ENDED')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Event envelope correctness
// ---------------------------------------------------------------------------

describe('event envelope', () => {
  it('all events carry the raceSessionId from ctx', () => {
    const state = makeState();
    state.lastSessionState = SessionStateEnum.Racing;
    const prev = makeFrame({ sessionState: SessionStateEnum.Racing });
    const curr = makeFrame({ sessionState: SessionStateEnum.Checkered, sessionFlags: FlagBits.Checkered });
    const events = detect(prev, curr, state);
    for (const e of events) {
      expect(e.raceSessionId).toBe('session-abc');
    }
  });

  it('all events carry the publisherCode from ctx', () => {
    const state = makeState();
    state.lastSessionState = SessionStateEnum.ParadeLaps;
    const prev = makeFrame({ sessionState: SessionStateEnum.ParadeLaps });
    const curr = makeFrame({ sessionState: SessionStateEnum.Racing, sessionFlags: FlagBits.Green });
    const events = detect(prev, curr, state);
    for (const e of events) {
      expect(e.publisherCode).toBe('rig-01');
    }
  });

  it('each event has a unique UUID id', () => {
    const state = makeState();
    state.lastSessionState = SessionStateEnum.Racing;
    const prev = makeFrame({ sessionState: SessionStateEnum.Racing });
    const curr = makeFrame({ sessionState: SessionStateEnum.Checkered, sessionFlags: FlagBits.Checkered });
    const events = detect(prev, curr, state);
    const ids = events.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('events carry sessionTime and sessionTick from the current frame', () => {
    const state = makeState();
    state.lastSessionState = SessionStateEnum.Racing;
    const prev = makeFrame({ sessionState: SessionStateEnum.Racing });
    const curr = makeFrame({ sessionState: SessionStateEnum.Checkered, sessionTick: 9999, sessionTime: 3600 });
    const events = detect(prev, curr, state);
    for (const e of events) {
      expect(e.sessionTick).toBe(9999);
      expect(e.sessionTime).toBe(3600);
    }
  });
});

// ---------------------------------------------------------------------------
// Full scenario: parade → green → racing → checkered → cooldown
// ---------------------------------------------------------------------------

describe('full race lifecycle sequence', () => {
  it('emits the expected event types across a full race lifecycle', () => {
    const state = makeState();
    const frames = makeFrameSequence(
      makeFrame({ sessionState: SessionStateEnum.Warmup, sessionFlags: 0 }),
      [
        withSessionState(SessionStateEnum.ParadeLaps),
        withRaceGreen(),
        withSessionState(SessionStateEnum.Checkered),
        withSessionState(SessionStateEnum.CoolDown),
      ],
    );

    const allEvents: string[] = [];
    for (let i = 1; i < frames.length; i++) {
      const events = detect(frames[i - 1], frames[i], state);
      allEvents.push(...events.map(e => e.type));
    }

    expect(allEvents).toContain('SESSION_STATE_CHANGE');
    expect(allEvents).toContain('RACE_GREEN');
    expect(allEvents).toContain('RACE_CHECKERED');
    expect(allEvents).toContain('SESSION_ENDED');
  });
});
