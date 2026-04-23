import { describe, it, expect } from 'vitest';
import { LifecycleEventDetector } from '../lifecycle-event-detector';
import type { LifecycleDetectorContext } from '../lifecycle-event-detector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CTX: LifecycleDetectorContext = {
  publisherCode: 'rig-01',
  raceSessionId: 'session-abc',
  version: '1.2.3',
};

// ---------------------------------------------------------------------------
// onActivate
// ---------------------------------------------------------------------------

describe('onActivate', () => {
  it('returns exactly one PUBLISHER_HELLO event', () => {
    const detector = new LifecycleEventDetector();
    const events = detector.onActivate(CTX);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('PUBLISHER_HELLO');
  });

  it('PUBLISHER_HELLO payload carries version and capabilities', () => {
    const detector = new LifecycleEventDetector();
    const [ev] = detector.onActivate(CTX);
    expect((ev.payload as any).version).toBe('1.2.3');
    expect((ev.payload as any).capabilities).toContain('telemetry-v1');
  });

  it('event carries correct publisherCode and raceSessionId', () => {
    const detector = new LifecycleEventDetector();
    const [ev] = detector.onActivate(CTX);
    expect(ev.publisherCode).toBe('rig-01');
    expect(ev.raceSessionId).toBe('session-abc');
  });

  it('event has a non-empty UUID id', () => {
    const detector = new LifecycleEventDetector();
    const [ev] = detector.onActivate(CTX);
    expect(ev.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets sessionTime and sessionTick to 0 (no frame context)', () => {
    const detector = new LifecycleEventDetector();
    const [ev] = detector.onActivate(CTX);
    expect(ev.sessionTime).toBe(0);
    expect(ev.sessionTick).toBe(0);
  });

  it('updates lastEventAt so heartbeat is suppressed immediately after', () => {
    let now = 0;
    const detector = new LifecycleEventDetector(() => now);
    detector.onActivate(CTX);
    now = 500;
    const hb = detector.checkHeartbeat(CTX);
    expect(hb).toHaveLength(0); // only 500ms since HELLO
  });
});

// ---------------------------------------------------------------------------
// onDeactivate
// ---------------------------------------------------------------------------

describe('onDeactivate', () => {
  it('returns exactly one PUBLISHER_GOODBYE event', () => {
    const detector = new LifecycleEventDetector();
    const events = detector.onDeactivate(CTX);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('PUBLISHER_GOODBYE');
  });

  it('event carries correct publisherCode', () => {
    const detector = new LifecycleEventDetector();
    const [ev] = detector.onDeactivate(CTX);
    expect(ev.publisherCode).toBe('rig-01');
  });
});

// ---------------------------------------------------------------------------
// onConnectionChange
// ---------------------------------------------------------------------------

describe('onConnectionChange', () => {
  it('returns IRACING_CONNECTED when connected=true', () => {
    const detector = new LifecycleEventDetector();
    const events = detector.onConnectionChange(true, CTX);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('IRACING_CONNECTED');
  });

  it('returns IRACING_DISCONNECTED when connected=false', () => {
    const detector = new LifecycleEventDetector();
    const events = detector.onConnectionChange(false, CTX);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('IRACING_DISCONNECTED');
  });

  it('event carries publisherCode and raceSessionId', () => {
    const detector = new LifecycleEventDetector();
    const [ev] = detector.onConnectionChange(true, CTX);
    expect(ev.publisherCode).toBe('rig-01');
    expect(ev.raceSessionId).toBe('session-abc');
  });

  it('updates lastEventAt so heartbeat is suppressed', () => {
    let now = 0;
    const detector = new LifecycleEventDetector(() => now);
    detector.onConnectionChange(true, CTX);
    now = 800;
    expect(detector.checkHeartbeat(CTX)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// checkHeartbeat
// ---------------------------------------------------------------------------

describe('checkHeartbeat', () => {
  it('fires PUBLISHER_HEARTBEAT when no event has been emitted (starts at time 0, check at 1001)', () => {
    let now = 0;
    const detector = new LifecycleEventDetector(() => now);
    now = 1001;
    const events = detector.checkHeartbeat(CTX);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('PUBLISHER_HEARTBEAT');
  });

  it('fires exactly at the 1000ms boundary', () => {
    let now = 0;
    const detector = new LifecycleEventDetector(() => now);
    now = 999;
    expect(detector.checkHeartbeat(CTX)).toHaveLength(0);
    now = 1000;
    expect(detector.checkHeartbeat(CTX)).toHaveLength(1);
  });

  it('returns empty array when another event was emitted less than 1s ago', () => {
    let now = 500;
    const detector = new LifecycleEventDetector(() => now);
    detector.notifyEventEmitted(); // last event at 500ms
    now = 1000; // only 500ms since last event
    expect(detector.checkHeartbeat(CTX)).toHaveLength(0);
  });

  it('notifyEventEmitted from external detector suppresses heartbeat', () => {
    let now = 0;
    const detector = new LifecycleEventDetector(() => now);
    now = 1500;
    detector.notifyEventEmitted(); // some other event fired at 1500ms
    now = 2000; // only 500ms since last
    expect(detector.checkHeartbeat(CTX)).toHaveLength(0);
  });

  it('heartbeat fires again after a second interval has elapsed', () => {
    let now = 0;
    const detector = new LifecycleEventDetector(() => now);
    now = 1001;
    detector.checkHeartbeat(CTX); // fires; updates lastEventAt to 1001
    now = 2002;
    const events = detector.checkHeartbeat(CTX); // 1001ms since last
    expect(events).toHaveLength(1);
  });

  it('heartbeat does NOT fire twice in rapid succession', () => {
    let now = 0;
    const detector = new LifecycleEventDetector(() => now);
    now = 1001;
    detector.checkHeartbeat(CTX); // fires
    const second = detector.checkHeartbeat(CTX); // same ms → no fire
    expect(second).toHaveLength(0);
  });

  it('heartbeat carries publisherCode and raceSessionId', () => {
    let now = 0;
    const detector = new LifecycleEventDetector(() => now);
    now = 2000;
    const [ev] = detector.checkHeartbeat(CTX);
    expect(ev.publisherCode).toBe('rig-01');
    expect(ev.raceSessionId).toBe('session-abc');
  });
});

// ---------------------------------------------------------------------------
// notifyEventEmitted
// ---------------------------------------------------------------------------

describe('notifyEventEmitted', () => {
  it('resets the heartbeat suppression window', () => {
    let now = 0;
    const detector = new LifecycleEventDetector(() => now);
    now = 5000;
    detector.notifyEventEmitted();
    now = 5500;
    expect(detector.checkHeartbeat(CTX)).toHaveLength(0); // still within window
    now = 6001;
    expect(detector.checkHeartbeat(CTX)).toHaveLength(1); // now past 1s
  });
});

// ---------------------------------------------------------------------------
// Event uniqueness
// ---------------------------------------------------------------------------

describe('event id uniqueness', () => {
  it('each call to onActivate produces a unique event id', () => {
    const detector = new LifecycleEventDetector();
    const id1 = detector.onActivate(CTX)[0].id;
    const id2 = detector.onActivate(CTX)[0].id;
    expect(id1).not.toBe(id2);
  });
});
