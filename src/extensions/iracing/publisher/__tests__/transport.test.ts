import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PublisherTransport, fetchPublisherConfig } from '../transport';
import type { PublisherEventBatchResponse } from '../transport';
import type { PublisherEvent } from '../event-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(type = 'PUBLISHER_HEARTBEAT', id = 'evt-1'): PublisherEvent {
  return {
    id,
    raceSessionId: 'session-1',
    publisherCode: 'rig-01',
    type: type as PublisherEvent['type'],
    timestamp: 1000,
    sessionTime: 120,
    sessionTick: 1000,
    car: { carIdx: 0, carNumber: '1', driverName: 'Test Driver' },
    payload: {} as never,
  };
}

function make202Response(overrides: Partial<PublisherEventBatchResponse> = {}): Response {
  const body: PublisherEventBatchResponse = {
    accepted: 1,
    duplicates: 0,
    invalid: 0,
    results: [{ id: 'evt-1', status: 'accepted' }],
    ...overrides,
  };
  return new Response(JSON.stringify(body), { status: 202, headers: { 'Content-Type': 'application/json' } });
}

function makeTransport(
  fetchFn: typeof fetch,
  opts: { batchIntervalMs?: number; onStatusChange?: ReturnType<typeof vi.fn> } = {},
) {
  return new PublisherTransport({
    endpointUrl: 'https://example.com/api/telemetry/events',
    batchIntervalMs: opts.batchIntervalMs ?? 60_000,
    getAuthToken: async () => 'test-token',
    onStatusChange: opts.onStatusChange,
    fetchFn,
  });
}

// ---------------------------------------------------------------------------
// flush() — 202 success
// ---------------------------------------------------------------------------

describe('flush — 202 success', () => {
  it('removes events from the queue after a successful flush', async () => {
    const fetchFn = vi.fn().mockResolvedValue(make202Response());
    const t = makeTransport(fetchFn);
    t.enqueue(makeEvent());
    expect(t.queueLength).toBe(1);
    await t.flush();
    expect(t.queueLength).toBe(0);
  });

  it('posts events wrapped in { events: [...] }', async () => {
    const fetchFn = vi.fn().mockResolvedValue(make202Response());
    const t = makeTransport(fetchFn);
    const event = makeEvent('LAP_COMPLETED', 'evt-abc');
    t.enqueue(event);
    await t.flush();
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].id).toBe('evt-abc');
  });

  it('sets the Authorization header', async () => {
    const fetchFn = vi.fn().mockResolvedValue(make202Response());
    const t = makeTransport(fetchFn);
    t.enqueue(makeEvent());
    await t.flush();
    const headers = (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-token');
  });

  it('resets retryBackoffMs to 0 on success', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(make202Response());
    const t = makeTransport(fetchFn);
    t.enqueue(makeEvent('PUBLISHER_HEARTBEAT', 'e1'));
    await t.flush(); // 500 — backoff set

    // Advance past backoff by manipulating Date.now
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    t.enqueue(makeEvent('PUBLISHER_HEARTBEAT', 'e2'));
    await t.flush(); // 202 — backoff reset
    expect(t.queueLength).toBe(0);
    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// flush() — 400 Bad Request (drop batch)
// ---------------------------------------------------------------------------

describe('flush — 400 drop batch', () => {
  it('does NOT re-queue events after a 400', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('bad schema', { status: 400 }));
    const t = makeTransport(fetchFn);
    t.enqueue(makeEvent());
    await t.flush();
    expect(t.queueLength).toBe(0);
  });

  it('emits error status after 400', async () => {
    const onStatusChange = vi.fn();
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 400 }));
    const t = makeTransport(fetchFn, { onStatusChange });
    t.enqueue(makeEvent());
    await t.flush();
    const statuses: string[] = onStatusChange.mock.calls.map((c) => c[0].status);
    expect(statuses).toContain('error');
  });
});

// ---------------------------------------------------------------------------
// flush() — 401 Unauthorized (re-queue)
// ---------------------------------------------------------------------------

describe('flush — 401 re-queue', () => {
  it('re-queues events after a 401', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    const t = makeTransport(fetchFn);
    t.enqueue(makeEvent());
    await t.flush();
    expect(t.queueLength).toBe(1);
  });

  it('does not apply backoff on 401', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(make202Response());
    const t = makeTransport(fetchFn);
    t.enqueue(makeEvent('PUBLISHER_HEARTBEAT', 'e1'));
    await t.flush(); // 401

    // Should be able to flush again immediately (no backoff)
    t.enqueue(makeEvent('PUBLISHER_HEARTBEAT', 'e2'));
    await t.flush(); // 202
    expect(t.queueLength).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// flush() — 429 Rate Limited (re-queue + backoff)
// ---------------------------------------------------------------------------

describe('flush — 429 backoff', () => {
  afterEach(() => vi.restoreAllMocks());

  it('re-queues events after a 429', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    const t = makeTransport(fetchFn);
    t.enqueue(makeEvent());
    await t.flush();
    expect(t.queueLength).toBe(1);
  });

  it('does not call fetch again while in backoff', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    const t = makeTransport(fetchFn);
    t.enqueue(makeEvent());
    await t.flush(); // 429 — sets backoff
    await t.flush(); // Should be blocked by backoff
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('doubles retryBackoffMs on consecutive failures', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    const t = makeTransport(fetchFn);
    t.enqueue(makeEvent('PUBLISHER_HEARTBEAT', 'e1'));
    await t.flush(); // backoff = 2000

    // Advance time past first backoff
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 5_000);
    t.enqueue(makeEvent('PUBLISHER_HEARTBEAT', 'e2'));
    await t.flush(); // backoff = 4000
    await t.flush(); // Still in 4000ms backoff — no extra call
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('caps backoff at MAX_RETRY_BACKOFF_MS (30s)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    const t = makeTransport(fetchFn);
    // Simulate many failures to push backoff to ceiling
    let now = Date.now();
    for (let i = 0; i < 10; i++) {
      vi.spyOn(Date, 'now').mockReturnValue(now);
      t.enqueue(makeEvent('PUBLISHER_HEARTBEAT', `e${i}`));
      await t.flush();
      now += 35_000; // always past backoff
    }
    // The last successful fetch call should exist — queue will still have events
    // but backoff never exceeds 30s; verify fetch was called each iteration
    expect(fetchFn.mock.calls.length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// flush() — 5xx (re-queue + backoff)
// ---------------------------------------------------------------------------

describe('flush — 5xx backoff', () => {
  it('re-queues events after a 500', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    const t = makeTransport(fetchFn);
    t.enqueue(makeEvent());
    await t.flush();
    expect(t.queueLength).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// flush() — network error
// ---------------------------------------------------------------------------

describe('flush — network error', () => {
  it('re-queues events on fetch rejection', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const t = makeTransport(fetchFn);
    t.enqueue(makeEvent());
    await t.flush();
    expect(t.queueLength).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// flush() — no auth token
// ---------------------------------------------------------------------------

describe('flush — no auth token', () => {
  it('re-queues events when getAuthToken returns null', async () => {
    const fetchFn = vi.fn();
    const t = new PublisherTransport({
      endpointUrl: 'https://example.com/api/telemetry/events',
      batchIntervalMs: 60_000,
      getAuthToken: async () => null,
      fetchFn,
    });
    t.enqueue(makeEvent());
    await t.flush();
    expect(t.queueLength).toBe(1);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Batch size cap (MAX_BATCH_SIZE = 20)
// ---------------------------------------------------------------------------

describe('batch size', () => {
  it('sends at most 20 events per flush', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      make202Response({ accepted: 20, results: Array.from({ length: 20 }, (_, i) => ({ id: `e${i}`, status: 'accepted' as const })) }),
    );
    const t = makeTransport(fetchFn);
    for (let i = 0; i < 25; i++) {
      t.enqueue(makeEvent('PUBLISHER_HEARTBEAT', `e${i}`));
    }
    await t.flush();
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.events).toHaveLength(20);
    expect(t.queueLength).toBe(5); // remaining events
  });
});

// ---------------------------------------------------------------------------
// High-priority events trigger immediate flush
// ---------------------------------------------------------------------------

describe('high-priority flush', () => {
  it('calls flush immediately for OVERTAKE_FOR_LEAD', async () => {
    const fetchFn = vi.fn().mockResolvedValue(make202Response());
    const t = makeTransport(fetchFn);
    // Start transport so timer is managed, but with long interval
    t.start();
    t.enqueue(makeEvent('OVERTAKE_FOR_LEAD', 'hp-1'));
    // flush is async but void — wait a tick
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    t.stop();
  });

  it('does not trigger immediate flush for normal events', async () => {
    const fetchFn = vi.fn().mockResolvedValue(make202Response());
    const t = makeTransport(fetchFn, { batchIntervalMs: 60_000 });
    t.enqueue(makeEvent('LAP_COMPLETED', 'n-1'));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// stop() flushes remaining events
// ---------------------------------------------------------------------------

describe('stop()', () => {
  it('flushes remaining queued events on stop', async () => {
    const fetchFn = vi.fn().mockResolvedValue(make202Response());
    const t = makeTransport(fetchFn);
    t.enqueue(makeEvent('PUBLISHER_GOODBYE', 'goodbye-1'));
    await t.stop();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(t.queueLength).toBe(0);
  });

  it('does nothing if queue is empty on stop', async () => {
    const fetchFn = vi.fn();
    const t = makeTransport(fetchFn);
    await t.stop();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// fetchPublisherConfig
// ---------------------------------------------------------------------------

describe('fetchPublisherConfig', () => {
  const mockConfig = {
    gatewayUrl: 'https://simracecenter.com/api/telemetry/events',
    raceSessionId: 'session-abc-123',
    id: 'doc-1',
    driverId: 'driver-uuid',
    displayName: 'Johnny D',
    nickname: 'JD',
    iracingName: 'JohnDoe',
    publisherCode: 'rig-01',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('returns parsed config on 200', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockConfig), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const result = await fetchPublisherConfig('rig-01', async () => 'token', 'https://simracecenter.com', fetchFn);
    expect(result.raceSessionId).toBe('session-abc-123');
    expect(result.displayName).toBe('Johnny D');
  });

  it('encodes the publisherCode in the URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockConfig), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    await fetchPublisherConfig('rig 01', async () => 'token', 'https://simracecenter.com', fetchFn);
    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).toContain('rig%2001');
  });

  it('sets Authorization header', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockConfig), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    await fetchPublisherConfig('rig-01', async () => 'my-token', 'https://simracecenter.com', fetchFn);
    const headers = (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-token');
  });

  it('throws on 404', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
    await expect(fetchPublisherConfig('bad-code', async () => 'token', 'https://simracecenter.com', fetchFn))
      .rejects.toThrow('HTTP 404');
  });

  it('throws when no token available', async () => {
    const fetchFn = vi.fn();
    await expect(fetchPublisherConfig('rig-01', async () => null, 'https://simracecenter.com', fetchFn))
      .rejects.toThrow('no auth token');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
