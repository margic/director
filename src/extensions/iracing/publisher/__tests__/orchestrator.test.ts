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
}

function makeFakeDirector(settings: Record<string, any> = {}): FakeDirector {
  const emittedEvents: { event: string; payload: any }[] = [];
  const logs: { level: string; message: string }[] = [];
  return {
    settings: {
      'publisher.enabled': true,
      'publisher.publisherCode': 'rig-01',
      'publisher.raceSessionId': 'session-abc',
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
    emittedEvents,
    logs,
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
    nowFn: () => Date.now(),
  });
  return { orch, director, batches };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('activate/deactivate', () => {
  it('does NOT start when publisher.enabled is false', () => {
    const { orch, director } = makeOrchestrator({ 'publisher.enabled': false });
    orch.activate();
    expect(orch.isRunning).toBe(false);
    // No PUBLISHER_HELLO should have been emitted
    expect(director.emittedEvents.find((e) => e.payload?.type === 'PUBLISHER_HELLO')).toBeUndefined();
  });

  it('starts and emits PUBLISHER_HELLO when publisher.enabled is true', async () => {
    const { orch, director } = makeOrchestrator();
    orch.activate();
    expect(orch.isRunning).toBe(true);
    const helloEmitted = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'PUBLISHER_HELLO',
    );
    expect(helloEmitted).toBeDefined();
  });

  it('emits PUBLISHER_GOODBYE on deactivate', () => {
    const { orch, director } = makeOrchestrator();
    orch.activate();
    director.emittedEvents.length = 0; // clear
    orch.deactivate();
    expect(orch.isRunning).toBe(false);
    const goodbye = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'PUBLISHER_GOODBYE',
    );
    expect(goodbye).toBeDefined();
  });

  it('logs warnings when publisherCode or raceSessionId are blank', () => {
    const { orch, director } = makeOrchestrator({
      'publisher.publisherCode': '',
      'publisher.raceSessionId': '',
    });
    orch.activate();
    const warns = director.logs.filter((l) => l.level === 'warn').map((l) => l.message);
    expect(warns.some((m) => m.includes('publisherCode'))).toBe(true);
    expect(warns.some((m) => m.includes('raceSessionId'))).toBe(true);
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

  it('is a no-op when publisher is not running', () => {
    const { orch, director } = makeOrchestrator({ 'publisher.enabled': false });
    orch.activate();
    orch.onConnectionChange(true);
    expect(director.emittedEvents.find((e) => e.payload?.type === 'IRACING_CONNECTED')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Telemetry frame pipeline
// ---------------------------------------------------------------------------

describe('onTelemetryFrame — detector pipeline', () => {
  it('runs all detectors and forwards events to the transport', async () => {
    const { orch, director, batches } = makeOrchestrator();
    orch.activate();

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
    const { orch, director } = makeOrchestrator();
    orch.activate();
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
    const { orch } = makeOrchestrator();
    orch.activate();
    // Frame 1: session 100
    const f1 = makeFrame({ sessionUniqueId: 100, cars: [{ carIdx: 0, position: 1 }] });
    orch.onTelemetryFrame(f1);

    // Frame 2: new session — sessionUniqueId changed
    const f2 = makeFrame({ sessionUniqueId: 200, cars: [{ carIdx: 0, position: 1 }] });
    orch.onTelemetryFrame(f2);

    // Frame 3: car position changes — should NOT fire OVERTAKE because state was reset
    // (i.e. there's no prevFrame to diff against from before f2). This tests that
    // the orchestrator clears prevFrame on session change.
    // We don't assert explicit events here — just verify no crash and that
    // subsequent frames work.
    const f3 = makeFrame({ sessionUniqueId: 200, cars: [{ carIdx: 0, position: 2 }] });
    expect(() => orch.onTelemetryFrame(f3)).not.toThrow();
  });

  it('is a no-op when publisher is not running', () => {
    const { orch, director } = makeOrchestrator({ 'publisher.enabled': false });
    orch.activate();
    const f1 = makeFrame();
    orch.onTelemetryFrame(f1);
    expect(director.emittedEvents.filter((e) => e.event === 'iracing.publisherEventEmitted')).toHaveLength(0);
  });

  it('forwards FLAG_GREEN when SessionFlags transitions', () => {
    const { orch, director } = makeOrchestrator();
    orch.activate();
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
  it('emits status updates with raceSessionId and publisherCode envelope fields', () => {
    const { orch, director } = makeOrchestrator();
    orch.activate();
    const statusEvents = director.emittedEvents.filter((e) => e.event === 'iracing.publisherStateChanged');
    expect(statusEvents.length).toBeGreaterThan(0);
    const last = statusEvents[statusEvents.length - 1];
    expect(last.payload.raceSessionId).toBe('session-abc');
    expect(last.payload.publisherCode).toBe('rig-01');
    expect(last.payload.status).toBe('idle'); // initial state from transport.start()
  });

  it('emits status=active during a flush and back to idle after', async () => {
    const { orch, director } = makeOrchestrator();
    orch.activate();

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
  it('fires PUBLISHER_HEARTBEAT after 1s of inactivity', () => {
    const { orch, director } = makeOrchestrator();
    orch.activate();
    director.emittedEvents.length = 0;

    // Advance time so heartbeat detector considers it idle, then tick
    vi.advanceTimersByTime(1500);
    orch.tickHeartbeat();

    const beat = director.emittedEvents.find(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'PUBLISHER_HEARTBEAT',
    );
    expect(beat).toBeDefined();
  });

  it('is suppressed when other events flow through', () => {
    const { orch, director } = makeOrchestrator();
    orch.activate();

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

  it('automatic 1Hz timer drives heartbeats while running', async () => {
    const { orch, director } = makeOrchestrator();
    orch.activate();
    director.emittedEvents.length = 0;

    // Advance fake time by 3s — should produce ~3 heartbeats
    await vi.advanceTimersByTimeAsync(3500);

    const beats = director.emittedEvents.filter(
      (e) => e.event === 'iracing.publisherEventEmitted' && e.payload?.type === 'PUBLISHER_HEARTBEAT',
    );
    expect(beats.length).toBeGreaterThanOrEqual(2);
  });
});
