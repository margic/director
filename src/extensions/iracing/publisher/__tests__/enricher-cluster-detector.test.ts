/**
 * enricher-cluster-detector.test.ts — Issue #183
 */
import { describe, it, expect } from 'vitest';
import {
  ClusterDetector,
  INCIDENT_WINDOW_SEC,
  INCIDENT_MIN_COUNT,
  BATTLE_MIN_SEC,
  BATTLE_FOCUS_THRESHOLD,
} from '../enricher/cluster-detector';
import type { PublisherEvent, PublisherEventType } from '../event-types';

let nextId = 0;
function fakeEvent(type: PublisherEventType, sessionTime: number): PublisherEvent {
  return {
    id: `evt-${++nextId}`,
    raceSessionId: 's1',
    type,
    timestamp: 1_000_000 + sessionTime * 1000,
    sessionTime,
    sessionTick: Math.floor(sessionTime * 60),
    car: { carIdx: 0, carNumber: '7', driverName: 'Test' },
    payload: {} as any,
  };
}

describe('ClusterDetector — incident clustering', () => {
  it('does not emit until min count is reached', () => {
    const d = new ClusterDetector();
    const r1 = d.ingest(fakeEvent('OFF_TRACK', 100));
    const r2 = d.ingest(fakeEvent('OFF_TRACK', 101));
    expect(r1).toEqual([]);
    expect(r2).toEqual([]);
  });

  it('emits one cluster when 3 incidents land within the window', () => {
    const d = new ClusterDetector();
    d.ingest(fakeEvent('OFF_TRACK', 100));
    d.ingest(fakeEvent('CONTACT_DETECTED', 102));
    const out = d.ingest(fakeEvent('PLAYER_STOPPED', 105));
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('incident');
    expect(out[0].events).toHaveLength(INCIDENT_MIN_COUNT);
    expect(out[0].startTime).toBe(100);
    expect(out[0].endTime).toBe(105);
  });

  it('does NOT cluster when events span longer than the window', () => {
    const d = new ClusterDetector();
    d.ingest(fakeEvent('OFF_TRACK', 100));
    d.ingest(fakeEvent('CONTACT_DETECTED', 105));
    // 100 → 100+11 (= window+1): first event aged out, only 2 in window
    const out = d.ingest(fakeEvent('PLAYER_STOPPED', 100 + INCIDENT_WINDOW_SEC + 1));
    expect(out).toEqual([]);
  });

  it('ignores non-incident events', () => {
    const d = new ClusterDetector();
    d.ingest(fakeEvent('LAP_COMPLETED', 100));
    d.ingest(fakeEvent('LAP_COMPLETED', 102));
    const out = d.ingest(fakeEvent('LAP_COMPLETED', 105));
    expect(out).toEqual([]);
  });

  it('honours cooldown — a 2nd burst right after one already emitted does not refire', () => {
    const d = new ClusterDetector();
    d.ingest(fakeEvent('OFF_TRACK', 100));
    d.ingest(fakeEvent('OFF_TRACK', 101));
    d.ingest(fakeEvent('OFF_TRACK', 102)); // emits
    // Three more incidents within the cooldown window — must NOT re-emit.
    d.ingest(fakeEvent('OFF_TRACK', 103));
    d.ingest(fakeEvent('OFF_TRACK', 104));
    const out = d.ingest(fakeEvent('OFF_TRACK', 105));
    expect(out).toEqual([]);
  });

  it('re-fires after cooldown elapses', () => {
    const d = new ClusterDetector();
    d.ingest(fakeEvent('OFF_TRACK', 100));
    d.ingest(fakeEvent('OFF_TRACK', 101));
    d.ingest(fakeEvent('OFF_TRACK', 102)); // emits at 102
    // Wait long enough that the prior burst ages out of the window AND the
    // cooldown has elapsed.
    d.ingest(fakeEvent('OFF_TRACK', 200));
    d.ingest(fakeEvent('OFF_TRACK', 201));
    const out = d.ingest(fakeEvent('OFF_TRACK', 202));
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('incident');
  });
});

describe('ClusterDetector — battle clustering', () => {
  it('emits when sustained focus drops AFTER min duration', () => {
    const d = new ClusterDetector();
    d.ingest(fakeEvent('LAP_COMPLETED', 100), { competitiveFocus: 0.9 });
    d.ingest(fakeEvent('LAP_COMPLETED', 110), { competitiveFocus: 0.9 });
    d.ingest(fakeEvent('LAP_COMPLETED', 130), { competitiveFocus: 0.9 });
    const out = d.ingest(fakeEvent('LAP_COMPLETED', 132), { competitiveFocus: 0.2 });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('battle');
    expect(out[0].endTime - out[0].startTime).toBeGreaterThanOrEqual(BATTLE_MIN_SEC);
  });

  it('does NOT emit when battle window is too short', () => {
    const d = new ClusterDetector();
    d.ingest(fakeEvent('LAP_COMPLETED', 100), { competitiveFocus: 0.9 });
    const out = d.ingest(fakeEvent('LAP_COMPLETED', 110), { competitiveFocus: 0.2 });
    expect(out).toEqual([]);
  });

  it('does not start a window below the threshold', () => {
    const d = new ClusterDetector();
    d.ingest(fakeEvent('LAP_COMPLETED', 100), { competitiveFocus: BATTLE_FOCUS_THRESHOLD - 0.01 });
    const out = d.ingest(fakeEvent('LAP_COMPLETED', 200), { competitiveFocus: 0.1 });
    expect(out).toEqual([]);
  });
});

describe('ClusterDetector — stint clustering', () => {
  it('emits one stint cluster on PIT_ENTRY containing all events of the stint', () => {
    const d = new ClusterDetector();
    d.ingest(fakeEvent('LAP_COMPLETED', 10));
    d.ingest(fakeEvent('LAP_COMPLETED', 100));
    d.ingest(fakeEvent('LAP_COMPLETED', 200));
    const out = d.ingest(fakeEvent('PIT_ENTRY', 250));
    const stints = out.filter((c) => c.kind === 'stint');
    expect(stints).toHaveLength(1);
    expect(stints[0].events.length).toBe(4);
    expect(stints[0].endTime).toBe(250);
  });

  it('starts a fresh stint after PIT_ENTRY', () => {
    const d = new ClusterDetector();
    d.ingest(fakeEvent('LAP_COMPLETED', 10));
    d.ingest(fakeEvent('PIT_ENTRY', 50));
    d.ingest(fakeEvent('LAP_COMPLETED', 60));
    const out = d.ingest(fakeEvent('PIT_ENTRY', 100));
    const stint = out.find((c) => c.kind === 'stint')!;
    // Second stint contains LAP_COMPLETED@60 + PIT_ENTRY@100, not the earlier ones.
    expect(stint.events.length).toBe(2);
    expect(stint.startTime).toBe(50);
  });
});
