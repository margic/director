/**
 * Tests for issue #203: per-host scene curation.
 *
 * Covers reconciliation behavior, per-host isolation, IPC-style mutators,
 * and the capability filter exposed to the check-in payload.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub electron BEFORE importing ObsService — config-service touches `app`.
vi.mock('electron', () => ({
  app: { getPath: () => process.cwd() },
}));

// Mock telemetry to keep the service quiet.
vi.mock('../../telemetry-service', () => ({
  telemetryService: {
    trackEvent: vi.fn(),
    trackException: vi.fn(),
    trackDependency: vi.fn(),
  },
}));

// In-memory config store used by both the service and the test assertions.
const store: Record<string, any> = {};
vi.mock('../../config-service', async () => {
  return {
    configService: {
      get: vi.fn((key: string) => store[key]),
      set: vi.fn((key: string, value: any) => { store[key] = value; }),
    },
  };
});

import { ObsService } from './obs-service';

type Svc = ObsService & {
  availableScenes: string[];
  currentHost?: string;
  reconcileSceneCurations: () => void;
};

const newService = (host: string, scenes: string[]): Svc => {
  const svc = new ObsService() as Svc;
  svc.currentHost = host;
  svc.availableScenes = scenes;
  return svc;
};

describe('ObsService scene curation (issue #203)', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    store.obs = {};
  });

  it('reconcile adds new scenes as excluded by default', () => {
    const svc = newService('ws://host-a:4455', ['Race', 'Replay']);
    svc.reconcileSceneCurations();
    const list = svc.getSceneCurations();
    expect(list).toEqual([
      { name: 'Race', included: false, description: '' },
      { name: 'Replay', included: false, description: '' },
    ]);
  });

  it('reconcile preserves existing inclusion + description', () => {
    store.obs = {
      sceneCurations: {
        'ws://host-a:4455': [
          { name: 'Race', included: true, description: 'main shot' },
        ],
      },
    };
    const svc = newService('ws://host-a:4455', ['Race', 'Replay']);
    svc.reconcileSceneCurations();
    const list = svc.getSceneCurations();
    expect(list).toEqual([
      { name: 'Race', included: true, description: 'main shot' },
      { name: 'Replay', included: false, description: '' },
    ]);
  });

  it('reconcile removes stale scenes immediately', () => {
    store.obs = {
      sceneCurations: {
        'ws://host-a:4455': [
          { name: 'Race', included: true, description: 'main shot' },
          { name: 'Gone', included: true, description: 'will be removed' },
        ],
      },
    };
    const svc = newService('ws://host-a:4455', ['Race']);
    svc.reconcileSceneCurations();
    expect(svc.getSceneCurations()).toEqual([
      { name: 'Race', included: true, description: 'main shot' },
    ]);
  });

  it('curations are isolated per host', () => {
    const a = newService('ws://host-a:4455', ['Race']);
    const b = newService('ws://host-b:4455', ['Garage']);
    a.reconcileSceneCurations();
    b.reconcileSceneCurations();
    a.setSceneCuration({ name: 'Race', included: true, description: 'A only' });
    expect(a.getSceneCurations()).toEqual([
      { name: 'Race', included: true, description: 'A only' },
    ]);
    expect(b.getSceneCurations()).toEqual([
      { name: 'Garage', included: false, description: '' },
    ]);
  });

  it('setSceneCuration ignores names not in availableScenes', () => {
    const svc = newService('ws://host-a:4455', ['Race']);
    svc.reconcileSceneCurations();
    svc.setSceneCuration({ name: 'Phantom', included: true, description: 'nope' });
    expect(svc.getSceneCurations().find(c => c.name === 'Phantom')).toBeUndefined();
  });

  it('bulkSetIncluded toggles all live scenes', () => {
    const svc = newService('ws://host-a:4455', ['Race', 'Replay']);
    svc.reconcileSceneCurations();
    svc.setSceneCuration({ name: 'Race', included: true, description: 'desc' });
    svc.bulkSetIncluded(false);
    expect(svc.getSceneCurations().every(c => !c.included)).toBe(true);
    // Description preserved through bulk toggle.
    expect(svc.getSceneCurations().find(c => c.name === 'Race')?.description).toBe('desc');
    svc.bulkSetIncluded(true);
    expect(svc.getSceneCurations().every(c => c.included)).toBe(true);
  });

  it('getIncludedSceneCapabilities returns only included scenes with descriptions', () => {
    const svc = newService('ws://host-a:4455', ['Race', 'Replay', 'Garage']);
    svc.reconcileSceneCurations();
    svc.setSceneCuration({ name: 'Race', included: true, description: 'main shot' });
    svc.setSceneCuration({ name: 'Replay', included: true, description: '' });
    svc.setSceneCuration({ name: 'Garage', included: false, description: 'unused' });
    expect(svc.getIncludedSceneCapabilities()).toEqual([
      { name: 'Race', description: 'main shot' },
      { name: 'Replay', description: '' },
    ]);
  });

  it('getSceneCurations returns empty when no host is set', () => {
    const svc = new ObsService() as Svc;
    expect(svc.getSceneCurations()).toEqual([]);
  });
});
