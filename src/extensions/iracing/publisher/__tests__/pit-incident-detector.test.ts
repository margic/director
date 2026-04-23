import { describe, it, expect } from 'vitest';
import { detectPitAndIncidents } from '../pit-incident-detector';
import { createSessionState } from '../session-state';
import {
  makeFrame,
  makeFrameSequence,
  cloneFrame,
  TrackSurface,
  withPitEntry,
  withPitExit,
  withOffTrack,
  withBackOnTrack,
  withIncidentPoint,
  scenarioB,
} from './frame-fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CTX = { publisherCode: 'rig-01', raceSessionId: 'session-abc' };

function makeState() {
  return createSessionState('session-abc', 1);
}

function detect(
  prev: ReturnType<typeof makeFrame> | null,
  curr: ReturnType<typeof makeFrame>,
  state = makeState(),
  ctx = CTX,
) {
  return detectPitAndIncidents(prev, curr, state, ctx);
}

// ---------------------------------------------------------------------------
// PIT_ENTRY
// ---------------------------------------------------------------------------

describe('PIT_ENTRY', () => {
  it('fires when onPitRoad goes false→true', () => {
    const state = makeState();
    const prev  = makeFrame({ cars: [{ carIdx: 2, position: 3 }] });
    const curr  = cloneFrame(prev);
    curr.carIdxOnPitRoad[2] = 1;
    const events = detectPitAndIncidents(prev, curr, state, CTX);
    expect(events.find(e => e.type === 'PIT_ENTRY')).toBeDefined();
  });

  it('does NOT fire when car is already on pit road in both frames', () => {
    const state = makeState();
    // prime state: car 2 already on pit road
    const prime = makeFrame({ cars: [{ carIdx: 2, onPitRoad: true }] });
    detectPitAndIncidents(null, prime, state, CTX);

    const prev = cloneFrame(prime);
    const curr = cloneFrame(prime);
    const events = detectPitAndIncidents(prev, curr, state, CTX);
    expect(events.find(e => e.type === 'PIT_ENTRY')).toBeUndefined();
  });

  it('PIT_ENTRY payload has entryLap and position', () => {
    const state = makeState();
    const prev  = makeFrame({ cars: [{ carIdx: 1, position: 4, lapsCompleted: 7 }] });
    const curr  = cloneFrame(prev);
    curr.carIdxOnPitRoad[1] = 1;
    const events = detectPitAndIncidents(prev, curr, state, CTX);
    const ev = events.find(e => e.type === 'PIT_ENTRY')!;
    expect((ev.payload as any).entryLap).toBe(7);
    expect((ev.payload as any).position).toBe(4);
  });

  it('fires for multiple cars entering pits in the same frame', () => {
    const state = makeState();
    const prev  = makeFrame({ cars: [{ carIdx: 0 }, { carIdx: 3 }] });
    const curr  = cloneFrame(prev);
    curr.carIdxOnPitRoad[0] = 1;
    curr.carIdxOnPitRoad[3] = 1;
    const events = detectPitAndIncidents(prev, curr, state, CTX);
    expect(events.filter(e => e.type === 'PIT_ENTRY')).toHaveLength(2);
  });

  it('uses withPitEntry transition helper', () => {
    const state = makeState();
    const [base, pitFrame] = makeFrameSequence(
      makeFrame({ cars: [{ carIdx: 5, position: 2 }] }),
      [withPitEntry(5)],
    );
    const events = detectPitAndIncidents(base, pitFrame, state, CTX);
    expect(events.find(e => e.type === 'PIT_ENTRY')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// PIT_EXIT
// ---------------------------------------------------------------------------

describe('PIT_EXIT', () => {
  it('fires when onPitRoad goes true→false', () => {
    const state = makeState();
    // Prime state so car 3 is known to be on pit road
    const prime = makeFrame({ cars: [{ carIdx: 3, onPitRoad: true, position: 4 }] });
    detectPitAndIncidents(null, prime, state, CTX);

    const prev = cloneFrame(prime);
    const curr = cloneFrame(prime);
    curr.carIdxOnPitRoad[3] = 0;
    const events = detectPitAndIncidents(prev, curr, state, CTX);
    expect(events.find(e => e.type === 'PIT_EXIT')).toBeDefined();
  });

  it('PIT_EXIT positionsLost reflects position degradation', () => {
    const state = makeState();
    // Car was P2 entering, exits at P5
    const prime = makeFrame({ cars: [{ carIdx: 1, onPitRoad: true, position: 2 }] });
    detectPitAndIncidents(null, prime, state, CTX);

    const prev = cloneFrame(prime);
    const curr = cloneFrame(prime);
    curr.carIdxOnPitRoad[1] = 0;
    curr.carIdxPosition[1]  = 5;
    const events = detectPitAndIncidents(prev, curr, state, CTX);
    const ev = events.find(e => e.type === 'PIT_EXIT')!;
    expect((ev.payload as any).positionsLost).toBe(3);
    expect((ev.payload as any).newPosition).toBe(5);
  });

  it('positionsLost is 0 when car exits at same or better position', () => {
    const state = makeState();
    const prime = makeFrame({ cars: [{ carIdx: 0, onPitRoad: true, position: 3 }] });
    detectPitAndIncidents(null, prime, state, CTX);

    const prev = cloneFrame(prime);
    const curr = cloneFrame(prime);
    curr.carIdxOnPitRoad[0] = 0;
    curr.carIdxPosition[0]  = 3; // same position
    const events = detectPitAndIncidents(prev, curr, state, CTX);
    const ev = events.find(e => e.type === 'PIT_EXIT')!;
    expect((ev.payload as any).positionsLost).toBe(0);
  });

  it('uses withPitExit transition helper', () => {
    const state = makeState();
    // Simulate full pit cycle
    const frames = makeFrameSequence(
      makeFrame({ cars: [{ carIdx: 4, position: 3 }] }),
      [withPitEntry(4), withPitExit(4, 5)],
    );
    // First transition: PIT_ENTRY
    detectPitAndIncidents(frames[0], frames[1], state, CTX);
    // Second transition: PIT_EXIT
    const events = detectPitAndIncidents(frames[1], frames[2], state, CTX);
    expect(events.find(e => e.type === 'PIT_EXIT')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// OFF_TRACK
// ---------------------------------------------------------------------------

describe('OFF_TRACK', () => {
  it('does NOT fire on the first off-track frame', () => {
    const state = makeState();
    const prev  = makeFrame({ cars: [{ carIdx: 7 }] });
    const curr  = cloneFrame(prev);
    curr.carIdxTrackSurface[7] = TrackSurface.OffTrack;
    const events = detectPitAndIncidents(prev, curr, state, CTX);
    expect(events.find(e => e.type === 'OFF_TRACK')).toBeUndefined();
  });

  it('fires on the second consecutive off-track frame', () => {
    const state = makeState();
    const frame0 = makeFrame({ cars: [{ carIdx: 7 }] });
    // frame1: first off-track
    const frame1 = cloneFrame(frame0);
    frame1.carIdxTrackSurface[7] = TrackSurface.OffTrack;
    detectPitAndIncidents(frame0, frame1, state, CTX);
    // frame2: second off-track
    const frame2 = cloneFrame(frame1);
    const events = detectPitAndIncidents(frame1, frame2, state, CTX);
    expect(events.find(e => e.type === 'OFF_TRACK')).toBeDefined();
  });

  it('fires exactly once (not on frame 3+)', () => {
    const state = makeState();
    const frame0 = makeFrame({ cars: [{ carIdx: 7 }] });
    const frame1 = cloneFrame(frame0);
    frame1.carIdxTrackSurface[7] = TrackSurface.OffTrack;
    const frame2 = cloneFrame(frame1);
    const frame3 = cloneFrame(frame1);

    detectPitAndIncidents(frame0, frame1, state, CTX);
    detectPitAndIncidents(frame1, frame2, state, CTX); // fires here
    const events = detectPitAndIncidents(frame2, frame3, state, CTX); // must NOT re-fire
    expect(events.find(e => e.type === 'OFF_TRACK')).toBeUndefined();
  });

  it('uses withOffTrack transition helper (two frames)', () => {
    const state  = makeState();
    const frames = makeFrameSequence(
      makeFrame({ cars: [{ carIdx: 2 }] }),
      [withOffTrack(2), withOffTrack(2)],
    );
    detectPitAndIncidents(frames[0], frames[1], state, CTX);
    const events = detectPitAndIncidents(frames[1], frames[2], state, CTX);
    expect(events.find(e => e.type === 'OFF_TRACK')).toBeDefined();
  });

  it('OFF_TRACK payload has lapDistPct', () => {
    const state  = makeState();
    const frame0 = makeFrame({ cars: [{ carIdx: 3, lapDistPct: 0.75 }] });
    const frame1 = cloneFrame(frame0);
    frame1.carIdxTrackSurface[3] = TrackSurface.OffTrack;
    const frame2 = cloneFrame(frame1);
    frame2.carIdxLapDistPct[3] = 0.76;
    detectPitAndIncidents(frame0, frame1, state, CTX);
    const events = detectPitAndIncidents(frame1, frame2, state, CTX);
    const ev = events.find(e => e.type === 'OFF_TRACK')!;
    expect((ev.payload as any).lapDistPct).toBeCloseTo(0.76, 2);
  });
});

// ---------------------------------------------------------------------------
// BACK_ON_TRACK
// ---------------------------------------------------------------------------

describe('BACK_ON_TRACK', () => {
  it('fires when car returns to track after an OFF_TRACK', () => {
    const state  = makeState();
    const frame0 = makeFrame({ cars: [{ carIdx: 6 }] });
    const frame1 = cloneFrame(frame0);
    frame1.carIdxTrackSurface[6] = TrackSurface.OffTrack;
    const frame2 = cloneFrame(frame1);
    const frame3 = cloneFrame(frame0); // back on track

    detectPitAndIncidents(frame0, frame1, state, CTX);
    detectPitAndIncidents(frame1, frame2, state, CTX);
    const events = detectPitAndIncidents(frame2, frame3, state, CTX);
    expect(events.find(e => e.type === 'BACK_ON_TRACK')).toBeDefined();
  });

  it('does NOT fire BACK_ON_TRACK if car was never off-track (only 1 frame)', () => {
    const state  = makeState();
    const frame0 = makeFrame({ cars: [{ carIdx: 6 }] });
    const frame1 = cloneFrame(frame0);
    frame1.carIdxTrackSurface[6] = TrackSurface.OffTrack;
    const frame2 = cloneFrame(frame0); // returned after only 1 frame → no OFF_TRACK was fired
    const events = detectPitAndIncidents(frame1, frame2, state, CTX);
    expect(events.find(e => e.type === 'BACK_ON_TRACK')).toBeUndefined();
  });

  it('uses withBackOnTrack transition helper', () => {
    const state  = makeState();
    const frames = makeFrameSequence(
      makeFrame({ cars: [{ carIdx: 2 }] }),
      [withOffTrack(2), withOffTrack(2), withBackOnTrack(2)],
    );
    detectPitAndIncidents(frames[0], frames[1], state, CTX);
    detectPitAndIncidents(frames[1], frames[2], state, CTX);
    const events = detectPitAndIncidents(frames[2], frames[3], state, CTX);
    expect(events.find(e => e.type === 'BACK_ON_TRACK')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// INCIDENT_POINT
// ---------------------------------------------------------------------------

describe('INCIDENT_POINT', () => {
  it('fires when playerIncidentCount increments', () => {
    const state  = makeState();
    const frames = makeFrameSequence(
      makeFrame({ playerIncidentCount: 0 }),
      [withIncidentPoint()],
    );
    const events = detect(frames[0], frames[1], state);
    expect(events.find(e => e.type === 'INCIDENT_POINT')).toBeDefined();
  });

  it('INCIDENT_POINT payload has delta and total', () => {
    const state = makeState();
    const prev  = makeFrame({ playerIncidentCount: 3 });
    const curr  = cloneFrame(prev);
    curr.playerIncidentCount = 5; // +2 in one frame
    const events = detect(prev, curr, state);
    const ev = events.find(e => e.type === 'INCIDENT_POINT')!;
    expect((ev.payload as any).incidentPoints).toBe(2);
    expect((ev.payload as any).totalIncidentPoints).toBe(5);
  });

  it('does NOT fire when count is unchanged', () => {
    const state = makeState();
    const prev  = makeFrame({ playerIncidentCount: 3 });
    const curr  = cloneFrame(prev);
    expect(detect(prev, curr, state).find(e => e.type === 'INCIDENT_POINT')).toBeUndefined();
  });

  it('does NOT fire when prev is null', () => {
    const curr = makeFrame({ playerIncidentCount: 3 });
    expect(detect(null, curr).find(e => e.type === 'INCIDENT_POINT')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// IDENTITY_RESOLVED
// ---------------------------------------------------------------------------

describe('IDENTITY_RESOLVED', () => {
  it('fires once when iracingUserName and playerDisplayName are set', () => {
    const state = makeState();
    const ctx = { ...CTX, iracingUserName: 'driver123', playerDisplayName: 'Pat Driver' };
    const prev = makeFrame();
    const curr = cloneFrame(prev);
    const events = detectPitAndIncidents(prev, curr, state, ctx);
    expect(events.find(e => e.type === 'IDENTITY_RESOLVED')).toBeDefined();
  });

  it('fires exactly once per session (identityResolved guard)', () => {
    const state = makeState();
    const ctx = { ...CTX, iracingUserName: 'driver123', playerDisplayName: 'Pat Driver' };
    const prev = makeFrame();
    const curr = cloneFrame(prev);
    detectPitAndIncidents(prev, curr, state, ctx);
    const second = detectPitAndIncidents(prev, curr, state, ctx);
    expect(second.find(e => e.type === 'IDENTITY_RESOLVED')).toBeUndefined();
  });

  it('does NOT fire when iracingUserName is missing', () => {
    const state = makeState();
    const ctx = { ...CTX, playerDisplayName: 'Pat Driver' }; // no iracingUserName
    const events = detectPitAndIncidents(makeFrame(), cloneFrame(makeFrame()), state, ctx);
    expect(events.find(e => e.type === 'IDENTITY_RESOLVED')).toBeUndefined();
  });

  it('IDENTITY_RESOLVED payload carries displayName', () => {
    const state = makeState();
    const ctx = { ...CTX, iracingUserName: 'driver123', playerDisplayName: 'Pat Driver' };
    const events = detectPitAndIncidents(makeFrame(), cloneFrame(makeFrame()), state, ctx);
    const ev = events.find(e => e.type === 'IDENTITY_RESOLVED')!;
    expect((ev.payload as any).displayName).toBe('Pat Driver');
    expect((ev.payload as any).iracingUserName).toBe('driver123');
  });
});

// ---------------------------------------------------------------------------
// Scenario B integration
// ---------------------------------------------------------------------------

describe('scenario B integration', () => {
  it('detects PIT_EXIT when car exits stall in scenario B', () => {
    const state = makeState();
    const base  = scenarioB(); // car 1 is in pit stall
    // Prime state with car 1 on pit road
    detectPitAndIncidents(null, base, state, CTX);

    const exitFrame = cloneFrame(base);
    exitFrame.carIdxOnPitRoad[1]    = 0;
    exitFrame.carIdxTrackSurface[1] = TrackSurface.OnTrack;
    exitFrame.carIdxPosition[1]     = 3;

    const events = detectPitAndIncidents(base, exitFrame, state, CTX);
    expect(events.find(e => e.type === 'PIT_EXIT')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

describe('event envelope', () => {
  it('events carry raceSessionId and publisherCode', () => {
    const state = makeState();
    const frames = makeFrameSequence(
      makeFrame({ cars: [{ carIdx: 0 }] }),
      [withPitEntry(0)],
    );
    const events = detectPitAndIncidents(frames[0], frames[1], state, CTX);
    expect(events[0].raceSessionId).toBe('session-abc');
    expect(events[0].publisherCode).toBe('rig-01');
  });

  it('each event has a unique UUID', () => {
    const state = makeState();
    const prev  = makeFrame({ cars: [{ carIdx: 0 }, { carIdx: 1 }] });
    const curr  = cloneFrame(prev);
    curr.carIdxOnPitRoad[0] = 1;
    curr.carIdxOnPitRoad[1] = 1;
    const events = detectPitAndIncidents(prev, curr, state, CTX);
    const ids = events.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
