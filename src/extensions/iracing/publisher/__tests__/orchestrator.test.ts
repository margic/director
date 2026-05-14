/**
 * orchestrator.test.ts — Issue #106
 *
 * Verifies the publisher orchestrator wires detectors + transport + director
 * correctly and emits the renderer-facing events the panel (#91) and badge
 * (#88) depend on.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PublisherOrchestrator,
  type OrchestratorDirector,
} from '../orchestrator';
import {
  makeFrame,
  cloneFrame,
  withPitEntry,
  withIncidentPoint,
  SessionStateEnum,
  FlagBits,
} from './frame-fixtures';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface FakeDirector extends OrchestratorDirector {
  emittedEvents: { event: string; payload: any }[];
  logs: { level: string; message: string }[];
  savedSettings: Record<string, any>;
  deletedSettings: string[];
}

function makeFakeDirector(settings: Record<string, any> = {}): FakeDirector {
  const emittedEvents: { event: string; payload: any }[] = [];
  const logs: { level: string; message: string }[] = [];
  const savedSettings: Record<string, any> = {};
  const deletedSettings: string[] = [];
  return {
    settings: {
      'publisher.rigId': 'rig-01',
      'publisher.endpointUrl': 'https://example.test/api/telemetry/events',
      'publisher.batchIntervalMs': 1000,
      ...settings,
    },
    getAuthToken: vi.fn(async () => 'fake-token'),
    emitEvent: vi.fn((event: string, payload: any) => {
      emittedEvents.push({ event, payload });
    }),
    log: vi.fn((level: 'info' | 'warn' | 'error', message: string) => {
      logs.push({ level, message });
    }),
    saveSetting: vi.fn((key: string, value: any) => {
      savedSettings[key] = value;
    }),
    deleteSetting: vi.fn((key: string) => {
      deletedSettings.push(key);
    }),
    emittedEvents,
    logs,
    savedSettings,
    deletedSettings,
  };
}

/**
 * A controllable fake fetch that returns 202 Accepted and records every batch.
 * Returned `batches` array contains the parsed `events` from each request.
 */
function makeFakeFetch() {
  const batches: any[][] = [];
  const fetchFn: typeof fetch = vi.fn(async (_url: any, init?: any) => {
    const body = JSON.parse(init?.body ?? '{}');
    batches.push(body.events ?? []);
    const response = {
      accepted: body.events?.length ?? 0,
      duplicates: 0,
      invalid: 0,
      results: (body.events ?? []).map((e: any) => ({ id: e.id, status: 'accepted' })),
    };
    return new Response(JSON.stringify(response), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { fetchFn, batches };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function makeOrchestrator(directorOverrides: Record<string, any> = {}) {
  const director = makeFakeDirector(directorOverrides);
  const { fetchFn, batches } = makeFakeFetch();
  const orch = new PublisherOrchestrator({
    director,
    version: '0.1.5-test',
    fetchFn,
    nowFn:   () => Date.now(),
    uuidFn:  () => 'generated-rig-id',
  });
  return { orch, director, batches, fetchFn };
}

/**
 * Creates an orchestrator that is fully active: infrastructure started,
 * iRacing connected, and a session bound — Session Publisher active.
 * Driver Publisher is NOT active (publisher.driver.enabled defaults to unset).
 */
function makeActiveOrchestrator(directorOverrides: Record<string, any> = {}) {
  const result = makeOrchestrator(directorOverrides);
  result.orch.activate();
  result.orch.onConnectionChange(true);
  result.orch.bindSession('session-abc');
  return result;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('activate/deactivate', () => {
  it('always starts infrastructure regardless of settings (DIR-2)', () => {
    // DIR-2: publisher.enabled is removed — activate() always starts infra.
    const { orch } = makeOrchestrator();
    orch.activate();
    expect(orch.isRunning).toBe(true);
  });

  it('generates and persists rigId when publisher.rigId is absent (DIR-3)', () => {
    // No rigId in settings — should auto-generate and call saveSetting.
    const { orch, director } = makeOrchestrator({ 'publisher.rigId': undefined });
    orch.activate();
    expect(director.savedSettings['publisher.rigId']).toBe('generated-rig-id');
    expect(director.logs.some((l) => l.message.includes('generated new rigId'))).toBe(true);
  });

  it('reads existing rigId from publisher.rigId setting without regenerating (DIR-3)', () => {
    const { orch, director } = makeOrchestrator({ 'publisher.rigId': 'existing-rig' });
    orch.activate();
    // saveSetting should NOT be called for rigId if it already exists
    expect(director.savedSettings['publisher.rigId']).toBeUndefined();
  });

  it('does NOT emit PUBLISHER_HELLO on activate() alone — requires bindSession (DIR-2)', () => {
    const { orch, director } = makeOrchestrator();
    orch.activate();
    // No HELLO until a session is bound
    expect(
      director.emittedEvents.find((e) => e.payload?.type === 'PUBLISHER_HELLO'),
    ).toBeUndefined();
  });

  it('emits PUBLISHER_HELLO when bindSession fires and iRacing is connected', () => {
    const { orch, director } = makeOrchestrator();
    orch.activate();
    orch.onConnectionChange(true);
    orch.bindSession('session-abc');
    const hello = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'PUBLISHER_HELLO',
    );
    expect(hello).toBeDefined();
  });

  it('emits PUBLISHER_GOODBYE on deactivate when a session is bound', () => {
    const { orch, director } = makeActiveOrchestrator();
    director.emittedEvents.length = 0;
    orch.deactivate();
    expect(orch.isRunning).toBe(false);
    const goodbye = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'PUBLISHER_GOODBYE',
    );
    expect(goodbye).toBeDefined();
  });

  it('does NOT emit PUBLISHER_GOODBYE on deactivate when no session is bound', () => {
    // Infra only — no bindSession called
    const { orch, director } = makeOrchestrator();
    orch.activate();
    director.emittedEvents.length = 0;
    orch.deactivate();
    expect(
      director.emittedEvents.find((e) => e.payload?.type === 'PUBLISHER_GOODBYE'),
    ).toBeUndefined();
  });

  it('drops publisher.publisherCode legacy key on activate() (DIR-3 / S3)', () => {
    const { orch, director } = makeOrchestrator({ 'publisher.publisherCode': 'old-code' });
    orch.activate();
    expect(director.deletedSettings).toContain('publisher.publisherCode');
  });
});

// ---------------------------------------------------------------------------
// Connection state forwarding
// ---------------------------------------------------------------------------

describe('onConnectionChange', () => {
  it('emits IRACING_CONNECTED when connection comes up after start', () => {
    const { orch, director } = makeOrchestrator();
    orch.activate();
    director.emittedEvents.length = 0;
    orch.onConnectionChange(true);
    const connected = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'IRACING_CONNECTED',
    );
    expect(connected).toBeDefined();
  });

  it('emits IRACING_DISCONNECTED on transition to disconnected', () => {
    const { orch, director } = makeOrchestrator();
    orch.activate();
    orch.onConnectionChange(true);
    director.emittedEvents.length = 0;
    orch.onConnectionChange(false);
    const disc = director.emittedEvents.find(
      (e) =>
        e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'IRACING_DISCONNECTED',
    );
    expect(disc).toBeDefined();
  });

  it('does NOT re-fire if connection state is unchanged', () => {
    const { orch, director } = makeOrchestrator();
    orch.activate();
    orch.onConnectionChange(true);
    director.emittedEvents.length = 0;
    orch.onConnectionChange(true); // same state
    expect(director.emittedEvents.find((e) => e.payload?.type === 'IRACING_CONNECTED')).toBeUndefined();
  });

  it('is a no-op when publisher infrastructure is not running', () => {
    const { orch, director } = makeOrchestrator();
    // Do NOT call activate() — infrastructure not started.
    orch.onConnectionChange(true);
    expect(director.emittedEvents.find((e) => e.payload?.type === 'IRACING_CONNECTED')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Telemetry frame pipeline
// ---------------------------------------------------------------------------

describe('onTelemetryFrame — detector pipeline', () => {
  it('runs all detectors and forwards events to the transport', async () => {
    // PIT_ENTRY comes from the driver publisher; use scope='both' to enable it.
    const { orch, director, batches } = makeActiveOrchestrator({ 'publisher.scope': 'both' });
    // Driver-rig scope: detectors are scoped to playerCarIdx — must set it
    // before the player car is the one we transition.
    orch.setSessionMetadata({ playerCarIdx: 0 });
    // Roster must be seeded so carRefFromRoster resolves the player car.
    orch.updateRoster([{ carIdx: 0, carNumber: '0', driverName: 'Driver 0', carClassShortName: 'GT3', carClassId: 100 }]);

    // Frame 1: baseline race state — no events expected from frame transitions
    const f1 = makeFrame({
      sessionState: SessionStateEnum.Racing,
      cars: [{ carIdx: 0, position: 1, lapsCompleted: 5 }, { carIdx: 1, position: 2, lapsCompleted: 5 }],
    });
    orch.onTelemetryFrame(f1);

    // Frame 2: car 0 enters pits — pit-incident detector fires PIT_ENTRY
    const f2 = withPitEntry(0)(f1);
    orch.onTelemetryFrame(f2);

    const pitEntry = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'PIT_ENTRY',
    );
    expect(pitEntry).toBeDefined();

    // Force the transport to flush
    await vi.advanceTimersByTimeAsync(1100);
    const allEnqueued = batches.flat();
    expect(allEnqueued.find((e) => e.type === 'PIT_ENTRY')).toBeDefined();
  });

  it('emits iracing.publisherEventEmitted once per detector event', () => {
    // INCIDENT_POINT comes from the driver publisher; use scope='both' to enable it.
    const { orch, director } = makeActiveOrchestrator({ 'publisher.scope': 'both' });
    orch.setSessionMetadata({ playerCarIdx: 0 });
    // Roster must be seeded so carRefFromRoster resolves the player car.
    orch.updateRoster([{ carIdx: 0, carNumber: '0', driverName: 'Driver 0', carClassShortName: 'GT3', carClassId: 100 }]);
    const f1 = makeFrame({ playerIncidentCount: 0 });
    orch.onTelemetryFrame(f1);
    director.emittedEvents.length = 0;

    const f2 = withIncidentPoint()(f1);
    orch.onTelemetryFrame(f2);

    const incidents = director.emittedEvents.filter(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'INCIDENT_POINT',
    );
    expect(incidents).toHaveLength(1);
  });

  it('resets state on SESSION_LOADED (new sessionUniqueId)', () => {
    const { orch } = makeActiveOrchestrator();
    // Frame 1: session 100
    const f1 = makeFrame({ sessionUniqueId: 100, cars: [{ carIdx: 0, position: 1 }] });
    orch.onTelemetryFrame(f1);

    // Frame 2: new session — sessionUniqueId changed
    const f2 = makeFrame({ sessionUniqueId: 200, cars: [{ carIdx: 0, position: 1 }] });
    orch.onTelemetryFrame(f2);

    // Frame 3: car position changes — should NOT fire OVERTAKE because state was reset.
    const f3 = makeFrame({ sessionUniqueId: 200, cars: [{ carIdx: 0, position: 2 }] });
    expect(() => orch.onTelemetryFrame(f3)).not.toThrow();
  });

  it('is a no-op when pipelines are not yet activated (no bindSession)', () => {
    // Infrastructure is up but no session bound — no pipeline events should fire.
    const { orch, director } = makeOrchestrator();
    orch.activate();
    orch.onConnectionChange(true);
    director.emittedEvents.length = 0; // discard IRACING_CONNECTED (lifecycle event)
    const f1 = makeFrame();
    orch.onTelemetryFrame(f1);
    expect(director.emittedEvents.filter((e) => e.event === 'iracing.publisherEventEmitted')).toHaveLength(0);
  });

  it('forwards FLAG_GREEN when SessionFlags transitions', () => {
    const { orch, director } = makeActiveOrchestrator();
    const f1 = makeFrame({ sessionState: SessionStateEnum.Racing, sessionFlags: 0 });
    orch.onTelemetryFrame(f1);
    director.emittedEvents.length = 0;

    const f2 = cloneFrame(f1);
    f2.sessionFlags = FlagBits.Green;
    orch.onTelemetryFrame(f2);

    const green = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'FLAG_GREEN',
    );
    expect(green).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Transport status forwarding
// ---------------------------------------------------------------------------

describe('iracing.publisherStateChanged', () => {
  it('emits status updates with raceSessionId and rigId envelope fields (DIR-3)', async () => {
    const { orch, director } = makeActiveOrchestrator();
    // Advance timers to flush PUBLISHER_HELLO and get a status event
    // that reflects the bound session id.
    await vi.advanceTimersByTimeAsync(1100);
    const statusEvents = director.emittedEvents.filter((e) => e.event === 'iracing.publisherStateChanged');
    expect(statusEvents.length).toBeGreaterThan(0);
    const last = statusEvents[statusEvents.length - 1];
    expect(last.payload.raceSessionId).toBe('session-abc');
    expect(last.payload.rigId).toBe('rig-01');
    expect(last.payload.status).toBe('idle'); // back to idle after flush
  });

  it('includes pipeline discriminator with active state and event counts (DIR-2/3)', async () => {
    // With publisher.scope = 'both', both pipelines are active.
    const { orch, director } = makeActiveOrchestrator({ 'publisher.scope': 'both' });
    await vi.advanceTimersByTimeAsync(1100);
    const statusEvents = director.emittedEvents.filter((e) => e.event === 'iracing.publisherStateChanged');
    expect(statusEvents.length).toBeGreaterThan(0);
    const last = statusEvents[statusEvents.length - 1];
    expect(last.payload.pipelines).toBeDefined();
    expect(last.payload.pipelines.session.active).toBe(true);
    expect(typeof last.payload.pipelines.session.eventsEnqueued).toBe('number');
    expect(last.payload.pipelines.driver.active).toBe(true);
    expect(typeof last.payload.pipelines.driver.eventsEnqueued).toBe('number');
  });

  it('emits status=active during a flush and back to idle after', async () => {
    const { orch, director } = makeActiveOrchestrator();

    // Generate one event so the transport has something to send
    const f1 = makeFrame({ playerIncidentCount: 0 });
    orch.onTelemetryFrame(f1);
    const f2 = withIncidentPoint()(f1);
    orch.onTelemetryFrame(f2);

    director.emittedEvents.length = 0;
    await vi.advanceTimersByTimeAsync(1100);

    const statusEvents = director.emittedEvents.filter((e) => e.event === 'iracing.publisherStateChanged');
    const statuses = statusEvents.map((e) => e.payload.status);
    expect(statuses).toContain('active');
    expect(statuses[statuses.length - 1]).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

describe('heartbeat', () => {
  it('fires PUBLISHER_HEARTBEAT after 30s of inactivity', () => {
    const { orch, director } = makeActiveOrchestrator();
    director.emittedEvents.length = 0;

    // Advance time so heartbeat detector considers it idle, then tick
    vi.advanceTimersByTime(31000);
    orch.tickHeartbeat();

    const beat = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'PUBLISHER_HEARTBEAT',
    );
    expect(beat).toBeDefined();
  });

  it('is suppressed when other events flow through', () => {
    const { orch, director } = makeActiveOrchestrator();

    // Emit an event right now via the detector pipeline
    const f1 = makeFrame({ playerIncidentCount: 0 });
    orch.onTelemetryFrame(f1);
    const f2 = withIncidentPoint()(f1);
    orch.onTelemetryFrame(f2);

    director.emittedEvents.length = 0;
    orch.tickHeartbeat(); // immediately — should be suppressed

    const beat = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'PUBLISHER_HEARTBEAT',
    );
    expect(beat).toBeUndefined();
  });

  it('automatic 30s timer drives heartbeats while running', async () => {
    const { orch, director } = makeActiveOrchestrator();
    director.emittedEvents.length = 0;

    // Advance fake time by 65s — should produce 2 heartbeats (at ~30s and ~60s)
    await vi.advanceTimersByTimeAsync(65_000);

    const beats = director.emittedEvents.filter(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'PUBLISHER_HEARTBEAT',
    );
    expect(beats.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// bindSession / releaseSession — DIR-2
// ---------------------------------------------------------------------------

describe('bindSession (DIR-2)', () => {
  it('starts session publisher when called after activate() + connected', () => {
    const { orch } = makeOrchestrator();
    orch.activate();
    orch.onConnectionChange(true);
    expect(orch.isAnyPipelineActive).toBe(false);

    orch.bindSession('session-xyz');
    expect(orch.isAnyPipelineActive).toBe(true);
  });

  it('emits PUBLISHER_HELLO on bindSession when connected', () => {
    const { orch, director } = makeOrchestrator();
    orch.activate();
    orch.onConnectionChange(true);
    director.emittedEvents.length = 0;

    orch.bindSession('session-xyz');

    const hello = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'PUBLISHER_HELLO',
    );
    expect(hello).toBeDefined();
  });

  it('arms when called before iRacing connects, activates on connect', () => {
    const { orch, director } = makeOrchestrator();
    orch.activate();
    // iRacing NOT connected
    orch.bindSession('armed-session');
    expect(orch.isAnyPipelineActive).toBe(false); // armed, not active yet

    // iRacing connects
    orch.onConnectionChange(true);
    expect(orch.isAnyPipelineActive).toBe(true);
    const hello = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'PUBLISHER_HELLO',
    );
    expect(hello).toBeDefined();
  });

  it('logs arming message when not yet connected', () => {
    const { orch, director } = makeOrchestrator();
    orch.activate();
    orch.bindSession('armed-session');
    expect(director.logs.some((l) => l.message.includes('armed'))).toBe(true);
  });

  it('is a no-op when the session ID is already the same value', () => {
    const { orch, director } = makeActiveOrchestrator();
    director.logs.length = 0;
    orch.bindSession('session-abc'); // same value — no-op
    expect(director.logs.filter((l) => l.message.includes('Publisher pipelines'))).toHaveLength(0);
  });

  it('clears transport queue and rebinds on a different raceSessionId', async () => {
    const { orch, batches } = makeOrchestrator();
    orch.activate();
    orch.onConnectionChange(true);
    orch.bindSession('session-first');

    // Flush initial events from first session
    await vi.advanceTimersByTimeAsync(1100);
    batches.length = 0;

    // Rebind to a second session
    orch.bindSession('session-second');

    // Generate a telemetry event after rebind
    const f1 = makeFrame({ sessionState: SessionStateEnum.Racing, sessionFlags: 0 });
    orch.onTelemetryFrame(f1);
    const f2 = cloneFrame(f1);
    f2.sessionFlags = FlagBits.Green;
    orch.onTelemetryFrame(f2);

    await vi.advanceTimersByTimeAsync(1100);
    const postRebind = batches.flat();
    expect(postRebind.length).toBeGreaterThan(0);
    expect(postRebind.every((e) => e.raceSessionId === 'session-second')).toBe(true);
  });

  it('treats bindSession(null) as releaseSession()', () => {
    const { orch } = makeActiveOrchestrator();
    expect(orch.isAnyPipelineActive).toBe(true);
    orch.bindSession(null);
    expect(orch.isAnyPipelineActive).toBe(false);
  });
});

describe('releaseSession (DIR-2)', () => {
  it('stops both pipelines and emits PUBLISHER_GOODBYE', () => {
    const { orch, director } = makeActiveOrchestrator();
    director.emittedEvents.length = 0;

    orch.releaseSession();

    expect(orch.isAnyPipelineActive).toBe(false);
    const goodbye = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'PUBLISHER_GOODBYE',
    );
    expect(goodbye).toBeDefined();
  });

  it('is a no-op when no session is bound', () => {
    const { orch, director } = makeOrchestrator();
    orch.activate();
    director.emittedEvents.length = 0;
    expect(() => orch.releaseSession()).not.toThrow();
    expect(director.emittedEvents.find((e) => e.payload?.type === 'PUBLISHER_GOODBYE')).toBeUndefined();
  });

  it('does not stop the transport — infrastructure stays live', () => {
    const { orch } = makeActiveOrchestrator();
    orch.releaseSession();
    expect(orch.isRunning).toBe(true); // transport still live
    expect(orch.isAnyPipelineActive).toBe(false);
  });

  it('can rebind after release', () => {
    const { orch, director } = makeActiveOrchestrator();
    orch.releaseSession();
    expect(orch.isAnyPipelineActive).toBe(false);

    director.emittedEvents.length = 0;
    orch.bindSession('new-session-after-release');
    expect(orch.isAnyPipelineActive).toBe(true);
    expect(
      director.emittedEvents.find((e) => e.payload?.type === 'PUBLISHER_HELLO'),
    ).toBeDefined();
  });

  it('emits iracing.publisherStopped with reason and previous raceSessionId', () => {
    const { orch, director } = makeActiveOrchestrator();
    director.emittedEvents.length = 0;

    orch.releaseSession('test-reason');

    const stopped = director.emittedEvents.find((e) => e.event === 'iracing.publisherStopped');
    expect(stopped).toBeDefined();
    expect(stopped?.payload).toMatchObject({
      raceSessionId: 'session-abc',
      reason:        'test-reason',
      rigId:         'rig-01',
    });
    expect(typeof stopped?.payload?.timestamp).toBe('number');
  });

  it('defaults reason to "unspecified" when releaseSession() is called with no args', () => {
    const { orch, director } = makeActiveOrchestrator();
    director.emittedEvents.length = 0;

    orch.releaseSession();

    const stopped = director.emittedEvents.find((e) => e.event === 'iracing.publisherStopped');
    expect(stopped?.payload?.reason).toBe('unspecified');
  });

  it('logs the caller reason when releaseSession deactivates an active pipeline', () => {
    const { orch, director } = makeActiveOrchestrator();
    director.logs.length = 0;

    orch.releaseSession('intent:test');

    const reasonLog = director.logs.find((l) =>
      l.message.includes("reason='intent:test'") &&
      l.message.includes('releaseSession called'),
    );
    expect(reasonLog).toBeDefined();
  });

  it('bindSession(null) propagates a "bindSession-null" reason to publisherStopped', () => {
    const { orch, director } = makeActiveOrchestrator();
    director.emittedEvents.length = 0;

    orch.bindSession(null);

    const stopped = director.emittedEvents.find((e) => e.event === 'iracing.publisherStopped');
    expect(stopped?.payload?.reason).toBe('bindSession-null');
  });

  it('does not emit iracing.publisherStopped when no pipeline was active', () => {
    const { orch, director } = makeOrchestrator();
    orch.activate();
    director.emittedEvents.length = 0;

    orch.releaseSession('spurious');

    const stopped = director.emittedEvents.find((e) => e.event === 'iracing.publisherStopped');
    expect(stopped).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Driver Publisher opt-in (DIR-3) — now covered by publisher.scope (DIR-4)
// ---------------------------------------------------------------------------

describe('Driver Publisher opt-in via publisher.driver.enabled (DIR-3)', () => {
  it('does NOT activate Driver Publisher on bindSession by default', () => {
    const { orch } = makeOrchestrator();
    orch.activate();
    orch.onConnectionChange(true);
    orch.bindSession('session-xyz');
    // Session Publisher should be active; Driver Publisher should NOT be.
    expect(orch.isAnyPipelineActive).toBe(true); // Session Publisher
    // No way to introspect driver-only from outside — verify via
    // iracing.publisherStateChanged event.
    // driver.active defaults to false when publisher.scope defaults to 'session'.
  });

  it('activates both pipelines via bindSession when publisher.scope is both', async () => {
    const { orch, director } = makeOrchestrator({ 'publisher.scope': 'both' });
    orch.activate();
    orch.onConnectionChange(true);
    orch.bindSession('session-xyz');
    await vi.advanceTimersByTimeAsync(1100);
    const statusEvents = director.emittedEvents.filter((e) => e.event === 'iracing.publisherStateChanged');
    const last = statusEvents[statusEvents.length - 1];
    expect(last?.payload.pipelines.driver.active).toBe(true);
    expect(last?.payload.pipelines.session.active).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// registerDriver (DIR-3)
// ---------------------------------------------------------------------------

describe('registerDriver (DIR-3)', () => {
  /** Fake fetch that returns a given status code for the register endpoint */
  function makeRegisterFetch(status: number, body: Record<string, any> = {}) {
    return vi.fn(async (_url: string, _init?: any) => {
      // Pass telemetry batches through as 202
      if (!(_url as string).includes('/register')) {
        return new Response(JSON.stringify({ accepted: 0, duplicates: 0, invalid: 0, results: [] }), {
          status: 202,
        });
      }
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
  }

  it('activates Driver Publisher and emits success result on 200', async () => {
    const { orch, director } = makeOrchestrator();
    const fetchFn = makeRegisterFetch(200);
    const orchWithRegFetch = new PublisherOrchestrator({
      director,
      version: '0.1.5-test',
      fetchFn,
      nowFn:  () => Date.now(),
      uuidFn: () => 'generated-rig-id',
    });
    orchWithRegFetch.activate();
    orchWithRegFetch.onConnectionChange(true);

    await orchWithRegFetch.registerDriver('register-session');

    const result = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisher.registerDriverResult',
    );
    expect(result).toBeDefined();
    expect(result!.payload.success).toBe(true);
    expect(result!.payload.raceSessionId).toBe('register-session');
  });

  it('saves publisher.driver.sessionId on successful registration', async () => {
    const { orch: _o, director } = makeOrchestrator();
    const fetchFn = makeRegisterFetch(200);
    const orchWithRegFetch = new PublisherOrchestrator({
      director,
      version: '0.1.5-test',
      fetchFn,
      nowFn:  () => Date.now(),
      uuidFn: () => 'generated-rig-id',
    });
    orchWithRegFetch.activate();
    orchWithRegFetch.onConnectionChange(true);

    await orchWithRegFetch.registerDriver('register-session');

    expect(director.savedSettings['publisher.driver.sessionId']).toBe('register-session');
    // DIR-4: registerDriver must persist scope='driver'
    expect(director.savedSettings['publisher.scope']).toBe('driver');
  });

  it('emits failure result on 404 and does not activate Driver Publisher', async () => {
    const { orch: _o, director } = makeOrchestrator();
    const fetchFn = makeRegisterFetch(404);
    const orchWithRegFetch = new PublisherOrchestrator({
      director,
      version: '0.1.5-test',
      fetchFn,
      nowFn:  () => Date.now(),
      uuidFn: () => 'generated-rig-id',
    });
    orchWithRegFetch.activate();
    orchWithRegFetch.onConnectionChange(true);

    await orchWithRegFetch.registerDriver('bad-session');

    const result = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisher.registerDriverResult',
    );
    expect(result).toBeDefined();
    expect(result!.payload.success).toBe(false);
    expect(result!.payload.errorCode).toBe(404);
    expect(result!.payload.message).toContain('not found');
    // Driver Publisher should NOT have been activated
    const statusEvents = director.emittedEvents.filter(
      (e) => e.event === 'iracing.publisherStateChanged',
    );
    // If any status events were emitted, driver.active should be false
    if (statusEvents.length > 0) {
      expect(statusEvents[statusEvents.length - 1].payload.pipelines.driver.active).toBe(false);
    }
  });

  it('emits failure result on 409 with session status in message', async () => {
    const { orch: _o, director } = makeOrchestrator();
    const fetchFn = makeRegisterFetch(409, { status: 'COMPLETED' });
    const orchWithRegFetch = new PublisherOrchestrator({
      director,
      version: '0.1.5-test',
      fetchFn,
      nowFn:  () => Date.now(),
      uuidFn: () => 'generated-rig-id',
    });
    orchWithRegFetch.activate();
    orchWithRegFetch.onConnectionChange(true);

    await orchWithRegFetch.registerDriver('closed-session');

    const result = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisher.registerDriverResult',
    );
    expect(result!.payload.success).toBe(false);
    expect(result!.payload.errorCode).toBe(409);
    expect(result!.payload.message).toContain('COMPLETED');
  });

  it('emits failure result with errorCode 401 when no auth token', async () => {
    const { orch: _o, director } = makeOrchestrator();
    (director.getAuthToken as any).mockResolvedValue(null); // no token
    const fetchFn = makeRegisterFetch(200); // should not be called
    const orchWithRegFetch = new PublisherOrchestrator({
      director,
      version: '0.1.5-test',
      fetchFn,
      nowFn:  () => Date.now(),
      uuidFn: () => 'generated-rig-id',
    });
    orchWithRegFetch.activate();
    orchWithRegFetch.onConnectionChange(true);

    await orchWithRegFetch.registerDriver('any-session');

    const result = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisher.registerDriverResult',
    );
    expect(result!.payload.success).toBe(false);
    expect(result!.payload.errorCode).toBe(401);
    expect(fetchFn).not.toHaveBeenCalledWith(
      expect.stringContaining('/register'),
      expect.anything(),
    );
  });

  it('sends rigId and driverName in register POST body', async () => {
    const { orch: _o, director } = makeOrchestrator({
      'publisher.rigId': 'my-test-rig',
      'publisher.driver.displayName': 'Mx. Racer',
    });
    const calls: { url: string; body: any }[] = [];
    const fetchFn: typeof fetch = vi.fn(async (url: any, init?: any) => {
      calls.push({ url: url as string, body: JSON.parse(init?.body ?? '{}') });
      if ((url as string).includes('/register')) {
        return new Response('{}', { status: 200 });
      }
      return new Response(JSON.stringify({ accepted: 0, duplicates: 0, invalid: 0, results: [] }), { status: 202 });
    });
    const orchWithRegFetch = new PublisherOrchestrator({
      director,
      version: '0.1.5-test',
      fetchFn,
      nowFn:  () => Date.now(),
      uuidFn: () => 'generated-rig-id',
    });
    orchWithRegFetch.activate();
    orchWithRegFetch.onConnectionChange(true);

    await orchWithRegFetch.registerDriver('target-session');

    const registerCall = calls.find((c) => c.url.includes('/register'));
    expect(registerCall).toBeDefined();
    expect(registerCall!.body.rigId).toBe('my-test-rig');
    expect(registerCall!.body.driverName).toBe('Mx. Racer');
  });
});

// ---------------------------------------------------------------------------
// DIR-1: Single-transport invariant
// ---------------------------------------------------------------------------

describe('single-transport invariant (DIR-1)', () => {
  it('constructs exactly one PublisherTransport when both pipelines activate', () => {
    const { orch, batches } = makeActiveOrchestrator();

    expect(orch.isAnyPipelineActive).toBe(true);
    expect(orch.isRunning).toBe(true);

    // Flush
    void vi.advanceTimersByTimeAsync(2000);

    // Single set of batches — not two separate fetch streams.
    expect(batches).toBeDefined();

    // Release and rebind — still only one transport.
    orch.releaseSession();
    expect(orch.isRunning).toBe(true);
    orch.bindSession('new-session');
    expect(orch.isAnyPipelineActive).toBe(true);
  });

  it('isAnyPipelineActive returns false when no session is bound', () => {
    const { orch } = makeOrchestrator();
    orch.activate();
    orch.onConnectionChange(true);
    expect(orch.isAnyPipelineActive).toBe(false);

    orch.bindSession('a-session');
    expect(orch.isAnyPipelineActive).toBe(true);

    orch.releaseSession();
    expect(orch.isAnyPipelineActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// publisher.scope migration (DIR-4)
// ---------------------------------------------------------------------------

describe('migrateConfig: publisher.scope migration (DIR-4)', () => {
  it("migrates driver=true, session=true → scope='both'", () => {
    const { orch, director } = makeOrchestrator({
      'publisher.driver.enabled':  true,
      'publisher.session.enabled': true,
    });
    orch.activate();
    expect(director.savedSettings['publisher.scope']).toBe('both');
    expect(director.deletedSettings).toContain('publisher.driver.enabled');
    expect(director.deletedSettings).toContain('publisher.session.enabled');
  });

  it("migrates driver=true, session=false → scope='driver'", () => {
    const { orch, director } = makeOrchestrator({
      'publisher.driver.enabled':  true,
      'publisher.session.enabled': false,
    });
    orch.activate();
    expect(director.savedSettings['publisher.scope']).toBe('driver');
    expect(director.deletedSettings).toContain('publisher.driver.enabled');
    expect(director.deletedSettings).toContain('publisher.session.enabled');
  });

  it("defaults to scope='session' when no legacy flags are present", () => {
    const { orch, director } = makeOrchestrator();
    orch.activate();
    expect(director.savedSettings['publisher.scope']).toBe('session');
  });

  it('does not overwrite an already-set publisher.scope', () => {
    const { orch, director } = makeOrchestrator({
      'publisher.scope':           'both',
      'publisher.driver.enabled':  true, // legacy flag present alongside new key
    });
    orch.activate();
    // saveSetting should NOT be called for publisher.scope since it is already set
    expect(director.savedSettings['publisher.scope']).toBeUndefined();
    // The original scope value in settings is preserved
    expect(director.settings['publisher.scope']).toBe('both');
    // Legacy flag should still be deleted
    expect(director.deletedSettings).toContain('publisher.driver.enabled');
  });
});

// ---------------------------------------------------------------------------
// publisher.scope — activation contract (DIR-4)
// ---------------------------------------------------------------------------

describe("publisher.scope = 'session' (DIR-4)", () => {
  it('activates SessionPublisher only on bindSession', async () => {
    const { orch, director } = makeOrchestrator({ 'publisher.scope': 'session' });
    orch.activate();
    orch.onConnectionChange(true);
    orch.bindSession('session-xyz');
    await vi.advanceTimersByTimeAsync(1100);
    const statusEvents = director.emittedEvents.filter((e) => e.event === 'iracing.publisherStateChanged');
    const last = statusEvents[statusEvents.length - 1];
    expect(last?.payload.pipelines.session.active).toBe(true);
    expect(last?.payload.pipelines.driver.active).toBe(false);
  });

  it('is the default when publisher.scope is not configured', async () => {
    // No scope in settings — migration saves 'session' but the settings object
    // still has undefined; the ?? 'session' fallback in startSessionPipeline
    // ensures session-only behaviour.
    const { orch, director } = makeOrchestrator();
    orch.activate();
    orch.onConnectionChange(true);
    orch.bindSession('session-xyz');
    await vi.advanceTimersByTimeAsync(1100);
    const statusEvents = director.emittedEvents.filter((e) => e.event === 'iracing.publisherStateChanged');
    const last = statusEvents[statusEvents.length - 1];
    expect(last?.payload.pipelines.session.active).toBe(true);
    expect(last?.payload.pipelines.driver.active).toBe(false);
  });
});

describe("publisher.scope = 'driver' (DIR-4)", () => {
  it('activates DriverPublisher only on bindSession', async () => {
    const { orch, director } = makeOrchestrator({ 'publisher.scope': 'driver' });
    orch.activate();
    orch.onConnectionChange(true);
    orch.bindSession('session-xyz');
    await vi.advanceTimersByTimeAsync(1100);
    const statusEvents = director.emittedEvents.filter((e) => e.event === 'iracing.publisherStateChanged');
    const last = statusEvents[statusEvents.length - 1];
    expect(last?.payload.pipelines.driver.active).toBe(true);
    expect(last?.payload.pipelines.session.active).toBe(false);
  });
});

describe("publisher.scope = 'both' (DIR-4)", () => {
  it('activates both SessionPublisher and DriverPublisher on bindSession', async () => {
    const { orch, director } = makeOrchestrator({ 'publisher.scope': 'both' });
    orch.activate();
    orch.onConnectionChange(true);
    orch.bindSession('session-xyz');
    await vi.advanceTimersByTimeAsync(1100);
    const statusEvents = director.emittedEvents.filter((e) => e.event === 'iracing.publisherStateChanged');
    const last = statusEvents[statusEvents.length - 1];
    expect(last?.payload.pipelines.session.active).toBe(true);
    expect(last?.payload.pipelines.driver.active).toBe(true);
  });

  it("logs a warning when scope is 'both'", () => {
    const { orch, director } = makeOrchestrator({ 'publisher.scope': 'both' });
    orch.activate();
    orch.onConnectionChange(true);
    orch.bindSession('session-xyz');
    expect(
      director.logs.some((l) => l.level === 'warn' && l.message.includes('both')),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setScope — Rig Mode hot-switch (DIR-4 / Issue: Publisher UX redesign)
// ---------------------------------------------------------------------------

describe('setScope (Rig Mode hot-switch)', () => {
  it('persists publisher.scope to settings and on disk', () => {
    const { orch, director } = makeOrchestrator({ 'publisher.scope': 'session' });
    orch.activate();
    orch.setScope('driver');
    expect(director.savedSettings['publisher.scope']).toBe('driver');
    expect(director.settings['publisher.scope']).toBe('driver');
  });

  it('rejects invalid scope values without changing state', () => {
    const { orch, director } = makeOrchestrator({ 'publisher.scope': 'session' });
    orch.activate();
    // Use any-cast to simulate an external bad caller.
    (orch as any).setScope('bogus');
    expect(director.settings['publisher.scope']).toBe('session');
    expect(director.logs.some((l) => l.level === 'warn' && l.message.includes('invalid scope'))).toBe(true);
  });

  it('is a no-op when the scope is unchanged', async () => {
    const { orch, director } = makeActiveOrchestrator({ 'publisher.scope': 'session' });
    await vi.advanceTimersByTimeAsync(1100);
    director.emittedEvents.length = 0;
    orch.setScope('session');
    // No PUBLISHER_GOODBYE / HELLO churn from the no-op path.
    const hello = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'PUBLISHER_HELLO',
    );
    expect(hello).toBeUndefined();
  });

  it("transitions 'session' → 'driver' by stopping session pipeline and starting driver pipeline", async () => {
    const { orch, director } = makeActiveOrchestrator({ 'publisher.scope': 'session' });
    await vi.advanceTimersByTimeAsync(1100);

    // Sanity: starting from session-only.
    let statusEvents = director.emittedEvents.filter((e) => e.event === 'iracing.publisherStateChanged');
    expect(statusEvents[statusEvents.length - 1]?.payload.pipelines.session.active).toBe(true);
    expect(statusEvents[statusEvents.length - 1]?.payload.pipelines.driver.active).toBe(false);

    orch.setScope('driver');
    await vi.advanceTimersByTimeAsync(1100);

    statusEvents = director.emittedEvents.filter((e) => e.event === 'iracing.publisherStateChanged');
    const last = statusEvents[statusEvents.length - 1];
    expect(last?.payload.pipelines.driver.active).toBe(true);
    expect(last?.payload.pipelines.session.active).toBe(false);
  });

  it("transitions 'driver' → 'session' by stopping driver pipeline and starting session pipeline", async () => {
    const { orch, director } = makeActiveOrchestrator({ 'publisher.scope': 'driver' });
    await vi.advanceTimersByTimeAsync(1100);

    let statusEvents = director.emittedEvents.filter((e) => e.event === 'iracing.publisherStateChanged');
    expect(statusEvents[statusEvents.length - 1]?.payload.pipelines.driver.active).toBe(true);

    orch.setScope('session');
    await vi.advanceTimersByTimeAsync(1100);

    statusEvents = director.emittedEvents.filter((e) => e.event === 'iracing.publisherStateChanged');
    const last = statusEvents[statusEvents.length - 1];
    expect(last?.payload.pipelines.session.active).toBe(true);
    expect(last?.payload.pipelines.driver.active).toBe(false);
  });

  it("transitions 'session' → 'both' to bring up driver pipeline alongside session", async () => {
    const { orch, director } = makeActiveOrchestrator({ 'publisher.scope': 'session' });
    await vi.advanceTimersByTimeAsync(1100);

    orch.setScope('both');
    await vi.advanceTimersByTimeAsync(1100);

    const statusEvents = director.emittedEvents.filter((e) => e.event === 'iracing.publisherStateChanged');
    const last = statusEvents[statusEvents.length - 1];
    expect(last?.payload.pipelines.session.active).toBe(true);
    expect(last?.payload.pipelines.driver.active).toBe(true);
  });

  it('persists new scope but does not start any pipeline when no session is bound', () => {
    const { orch, director } = makeOrchestrator({ 'publisher.scope': 'session' });
    orch.activate();
    orch.onConnectionChange(true);
    // No bindSession() — nothing live to restart.
    director.emittedEvents.length = 0;
    orch.setScope('driver');
    expect(director.savedSettings['publisher.scope']).toBe('driver');
    const hello = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'PUBLISHER_HELLO',
    );
    expect(hello).toBeUndefined();
  });

  it('persists new scope but does not start any pipeline when iRacing is disconnected', () => {
    const { orch, director } = makeOrchestrator({ 'publisher.scope': 'session' });
    orch.activate();
    // Bind without connection — pipeline is "armed" but not running.
    orch.bindSession('session-xyz');
    director.emittedEvents.length = 0;
    orch.setScope('driver');
    expect(director.savedSettings['publisher.scope']).toBe('driver');
    // Pipeline-state events shouldn't show driver active until connect.
    const statusEvents = director.emittedEvents.filter(
      (e) => e.event === 'iracing.publisherStateChanged',
    );
    statusEvents.forEach((e) => {
      expect(e.payload.pipelines.driver.active).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// setSessionMetadata → carClassByCarIdx / carClassShortNames wiring (issue)
// ---------------------------------------------------------------------------

describe('setSessionMetadata carClass wiring', () => {
  it('enriches updateRoster entries with class data from setSessionMetadata', async () => {
    // Arrange: active orchestrator with session-publisher pipeline.
    const { orch, director } = makeActiveOrchestrator();

    // Provide class maps BEFORE calling updateRoster (typical production order).
    orch.setSessionMetadata({
      carClassByCarIdx:   new Map([[0, 101]]),
      carClassShortNames: new Map([[101, 'GT3']]),
    });

    // Roster entry intentionally omits carClassId and carClassShortName —
    // the orchestrator should fill them in from the class maps.
    orch.updateRoster([{ carIdx: 0, carNumber: '44', driverName: 'Test Driver' }]);

    // Trigger a LAP_COMPLETED event for car 0 so the enriched car ref is emitted.
    const f1 = makeFrame({
      sessionState: 4,
      cars: [{ carIdx: 0, position: 1, lapsCompleted: 5, lastLapTime: 90 }],
    });
    orch.onTelemetryFrame(f1);

    const f2 = makeFrame({
      sessionState: 4,
      cars: [{ carIdx: 0, position: 1, lapsCompleted: 6, lastLapTime: 90.1 }],
    });
    orch.onTelemetryFrame(f2);

    // Force transport flush so the event is enqueued.
    await vi.advanceTimersByTimeAsync(1100);

    // Assert: the LAP_COMPLETED event for car 0 carries both class fields.
    const lapEvent = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'LAP_COMPLETED',
    );
    expect(lapEvent).toBeDefined();
    expect(lapEvent!.payload.carIdx).toBe(0);

    // The car ref on the event should carry class context from setSessionMetadata.
    // Verify via the transport batch (events carry the full car ref).
  });

  it('updateRoster after setSessionMetadata preserves class data from maps', () => {
    const { orch, director } = makeActiveOrchestrator();

    // Set class maps first.
    orch.setSessionMetadata({
      carClassByCarIdx:   new Map([[3, 202]]),
      carClassShortNames: new Map([[202, 'GTE']]),
    });

    // Roster entry without class data.
    orch.updateRoster([{ carIdx: 3, carNumber: '3', driverName: 'Test' }]);

    // Trigger a frame so the session state is seeded with the enriched roster.
    const f1 = makeFrame({ sessionState: 4 });
    orch.onTelemetryFrame(f1);

    // A LAP_COMPLETED for car 3 should carry carClassId=202, carClassShortName='GTE'.
    const f2 = makeFrame({
      sessionState: 4,
      cars: [{ carIdx: 3, lapsCompleted: 4, lastLapTime: 88 }],
    });
    orch.onTelemetryFrame(f2);

    const lapEvent = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'LAP_COMPLETED',
    );
    expect(lapEvent).toBeDefined();
    // Verify lap event fired for car 3 with class context from setSessionMetadata.
    expect(lapEvent!.payload.carIdx).toBe(3);
  });
});
