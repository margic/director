/**
 * event-enricher.test.ts — Issue #183
 *
 * Integration: ingest a stream of raw events into a fully-wired enricher
 * (mock provider) and assert that meta-events are emitted and counters
 * advance correctly.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEnricher } from '../enricher/event-enricher';
import { MockProvider } from '../enricher/providers/mock';
import { DisabledProvider } from '../enricher/providers/disabled';
import type { PublisherEvent, PublisherEventType } from '../event-types';

let nextId = 0;
function ev(type: PublisherEventType, sessionTime: number): PublisherEvent {
  return {
    id: `e-${++nextId}`,
    raceSessionId: 's',
    type,
    timestamp: 1_000_000 + sessionTime * 1000,
    sessionTime,
    sessionTick: Math.floor(sessionTime * 60),
    car: { carIdx: 0, carNumber: '7', driverName: 'Test' },
    payload: {} as any,
  };
}

describe('EventEnricher — disabled', () => {
  it('does nothing when provider is disabled', () => {
    const emit = vi.fn();
    const en = new EventEnricher({
      provider: new DisabledProvider(),
      emitMetaEvent: emit,
      raceSessionId: 's',
    });
    en.ingest(ev('OFF_TRACK', 1));
    en.ingest(ev('OFF_TRACK', 2));
    en.ingest(ev('OFF_TRACK', 3));
    expect(en.enabled).toBe(false);
    expect(emit).not.toHaveBeenCalled();
    expect(en.counters.clustersDetected).toBe(0);
  });
});

describe('EventEnricher — incident clustering integration', () => {
  it('emits one INCIDENT_SUMMARY for a 3-event burst', async () => {
    const emit = vi.fn();
    const provider = new MockProvider();
    const en = new EventEnricher({
      provider,
      emitMetaEvent: emit,
      raceSessionId: 'race-1',
      rigId: 'rig-1',
    });
    en.ingest(ev('OFF_TRACK', 100));
    en.ingest(ev('CONTACT_DETECTED', 102));
    en.ingest(ev('PLAYER_STOPPED', 105));
    // provider call is async — drain microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(en.counters.clustersDetected).toBe(1);
    expect(en.counters.providerCalls).toBe(1);
    expect(en.counters.emitted).toBe(1);
    expect(emit).toHaveBeenCalledTimes(1);
    const meta = emit.mock.calls[0][0] as PublisherEvent;
    expect(meta.type).toBe('INCIDENT_SUMMARY');
    expect(meta.raceSessionId).toBe('race-1');
    expect(meta.rigId).toBe('rig-1');
    const p = meta.payload as any;
    expect(p.startTime).toBe(100);
    expect(p.endTime).toBe(105);
    expect(p.rawEventTypes).toEqual(['OFF_TRACK', 'CONTACT_DETECTED', 'PLAYER_STOPPED']);
    expect(p.llm.provider).toBe('mock');
    expect(p.llm.tokensIn).toBe(50);
  });
});

describe('EventEnricher — token budget', () => {
  it('skips provider calls once budget is exhausted', async () => {
    const emit = vi.fn();
    const provider = new MockProvider();
    const en = new EventEnricher({
      provider,
      emitMetaEvent: emit,
      raceSessionId: 's',
      tokenBudgetCap: 10, // mock returns 50+25 → exhausts on first call
    });
    en.ingest(ev('OFF_TRACK', 100));
    en.ingest(ev('OFF_TRACK', 101));
    en.ingest(ev('OFF_TRACK', 102)); // cluster #1 → consumes 75 tokens
    await Promise.resolve();
    await Promise.resolve();
    expect(en.counters.emitted).toBe(1);

    en.ingest(ev('OFF_TRACK', 200));
    en.ingest(ev('OFF_TRACK', 201));
    en.ingest(ev('OFF_TRACK', 202)); // cluster #2 → budget exhausted → skip
    await Promise.resolve();
    await Promise.resolve();
    expect(en.counters.budgetSkips).toBe(1);
    expect(en.counters.emitted).toBe(1);
    expect(provider.callCount).toBe(1);
  });
});

describe('EventEnricher — provider errors are isolated', () => {
  it('counts provider errors but does not throw', async () => {
    const emit = vi.fn();
    const provider = {
      name: 'mock' as const,
      enabled: true,
      enrich: async () => {
        throw new Error('provider boom');
      },
    };
    const en = new EventEnricher({
      provider,
      emitMetaEvent: emit,
      raceSessionId: 's',
    });
    en.ingest(ev('OFF_TRACK', 1));
    en.ingest(ev('OFF_TRACK', 2));
    en.ingest(ev('OFF_TRACK', 3));
    await Promise.resolve();
    await Promise.resolve();
    expect(en.counters.providerErrors).toBe(1);
    expect(en.counters.emitted).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it('counts parse errors when provider returns invalid shape', async () => {
    const emit = vi.fn();
    const provider = {
      name: 'mock' as const,
      enabled: true,
      enrich: async () => {
        throw new Error('confidence must be a number in [0, 1]');
      },
    };
    const en = new EventEnricher({
      provider,
      emitMetaEvent: emit,
      raceSessionId: 's',
    });
    en.ingest(ev('OFF_TRACK', 1));
    en.ingest(ev('OFF_TRACK', 2));
    en.ingest(ev('OFF_TRACK', 3));
    await Promise.resolve();
    await Promise.resolve();
    expect(en.counters.parseErrors).toBe(1);
  });
});

describe('EventEnricher — timeout', () => {
  it('aborts provider calls that exceed callTimeoutMs', async () => {
    vi.useFakeTimers();
    try {
      const emit = vi.fn();
      const provider = new MockProvider({ hang: true });
      const en = new EventEnricher({
        provider,
        emitMetaEvent: emit,
        raceSessionId: 's',
        callTimeoutMs: 100,
      });
      en.ingest(ev('OFF_TRACK', 1));
      en.ingest(ev('OFF_TRACK', 2));
      en.ingest(ev('OFF_TRACK', 3));
      // Trigger the timeout.
      vi.advanceTimersByTime(150);
      // Drain microtasks created by the AbortError rejection.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(en.counters.timeouts).toBe(1);
      expect(en.counters.emitted).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('EventEnricher — STINT_SUMMARY on PIT_ENTRY', () => {
  it('emits a stint summary on pit entry', async () => {
    const emit = vi.fn();
    const en = new EventEnricher({
      provider: new MockProvider(),
      emitMetaEvent: emit,
      raceSessionId: 's',
    });
    en.ingest(ev('LAP_COMPLETED', 10));
    en.ingest(ev('LAP_COMPLETED', 100));
    en.ingest(ev('PIT_ENTRY', 200));
    await Promise.resolve();
    await Promise.resolve();
    expect(emit).toHaveBeenCalledTimes(1);
    expect((emit.mock.calls[0][0] as PublisherEvent).type).toBe('STINT_SUMMARY');
  });
});
