/**
 * Unit tests for SequenceLibraryService — Cloud Tier (Session Templates)
 *
 * Tests the session template fetching, template→sequence conversion,
 * caching, and graceful offline degradation.
 * Built-in and custom tiers are filesystem-dependent; cloud tier uses fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron app before importing the service
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-userdata',
  },
}));

// Mock fs/promises to avoid real filesystem access
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue('[]'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

import { SequenceLibraryService } from './sequence-library-service';
import { SequenceTemplate } from './director-types';

// Mock AuthService
class MockAuthService {
  getAccessToken = vi.fn().mockResolvedValue('mock-token-123');
}

// Mock CapabilityCatalog
class MockCapabilityCatalog {
  getAllIntents = vi.fn().mockReturnValue([]);
  getAllEvents = vi.fn().mockReturnValue([]);
}

// Helper to create a mock fetch response
function mockFetchResponse(data: any, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(data ? JSON.stringify(data) : ''),
  });
}

const SESSION_ID = 'test-session-001';

const cloudTemplates: SequenceTemplate[] = [
  {
    id: 'tmpl_battle-cam',
    raceSessionId: SESSION_ID,
    checkinId: 'checkin-test-001',
    name: 'Battle Cam',
    applicability: 'Two cars battling for position',
    priority: 'normal',
    durationRange: { min: 5000, max: 15000 },
    steps: [
      { id: 's1', intent: 'broadcast.showLiveCam', payload: { carNum: '${targetDriver}', camGroup: 1 } },
    ],
    variables: [
      { name: 'targetDriver', label: 'Target Driver', type: 'text', required: true, source: 'context', contextKey: 'iracing.drivers' },
    ],
    source: 'ai-planner',
  },
  {
    id: 'tmpl_quick-replay',
    raceSessionId: SESSION_ID,
    checkinId: 'checkin-test-001',
    name: 'Quick Replay',
    applicability: 'Replay of recent incident',
    priority: 'incident',
    durationRange: { min: 3000, max: 10000 },
    steps: [
      { id: 's1', intent: 'system.wait', payload: { durationMs: 3000 } },
    ],
    variables: [],
    source: 'ai-planner',
  },
];

describe('SequenceLibraryService — Cloud Tier (Session Templates)', () => {
  let service: SequenceLibraryService;
  let mockAuth: MockAuthService;
  let mockCatalog: MockCapabilityCatalog;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockAuth = new MockAuthService();
    mockCatalog = new MockCapabilityCatalog();
    service = new SequenceLibraryService(mockCatalog as any, mockAuth as any);

    // Mock global fetch
    fetchSpy = vi.fn().mockReturnValue(mockFetchResponse(cloudTemplates));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('setSession / clearSession', () => {
    it('should fetch templates for the given session', async () => {
      const result = await service.setSession(SESSION_ID);

      expect(result).toBe('ready');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(`/api/director/v1/sessions/${SESSION_ID}/templates`),
        expect.objectContaining({
          headers: { Authorization: 'Bearer mock-token-123' },
        })
      );
    });

    it('should convert templates to PortableSequence with cloud category', async () => {
      await service.setSession(SESSION_ID);
      const all = await service.listSequences();

      const cloud = all.filter(s => s.category === 'cloud');
      expect(cloud).toHaveLength(2);
      expect(cloud[0].id).toBe('tmpl_battle-cam');
      expect(cloud[0].name).toBe('Battle Cam');
      expect(cloud[0].category).toBe('cloud');
      expect(cloud[0].variables).toHaveLength(1);
    });

    it('should set priority=true for incident templates', async () => {
      await service.setSession(SESSION_ID);
      const all = await service.listSequences({ category: 'cloud' });

      const incident = all.find(s => s.id === 'tmpl_quick-replay');
      expect(incident?.priority).toBe(true);

      const normal = all.find(s => s.id === 'tmpl_battle-cam');
      expect(normal?.priority).toBe(false);
    });

    it('should carry metadata from template', async () => {
      await service.setSession(SESSION_ID);
      const seq = await service.getSequence('tmpl_battle-cam');

      expect(seq?.metadata).toEqual(expect.objectContaining({
        source: 'ai-planner',
        applicability: 'Two cars battling for position',
        priority: 'normal',
        durationRange: { min: 5000, max: 15000 },
        raceSessionId: SESSION_ID,
      }));
    });

    it('should clear cloud cache on clearSession', async () => {
      await service.setSession(SESSION_ID);
      let cloud = await service.listSequences({ category: 'cloud' });
      expect(cloud).toHaveLength(2);

      service.clearSession();
      cloud = await service.listSequences({ category: 'cloud' });
      expect(cloud).toHaveLength(0);
    });
  });

  describe('loadCloud — HTTP 204 (Planner still running)', () => {
    it('should return pending when Planner is still running', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse(null, false, 204).then(r => ({ ...r, ok: false, status: 204 })));
      // Actually 204 is not "ok" in fetch — let's mock it properly
      fetchSpy.mockReturnValue(Promise.resolve({
        ok: false,
        status: 204,
        statusText: 'No Content',
        json: () => Promise.resolve(null),
        text: () => Promise.resolve(''),
      }));

      const result = await service.setSession(SESSION_ID);
      expect(result).toBe('pending');

      const cloud = await service.listSequences({ category: 'cloud' });
      expect(cloud).toHaveLength(0);
    });
  });

  describe('loadCloud — no session / no auth', () => {
    it('should return pending when no session is set', async () => {
      const result = await service.loadCloud();
      expect(result).toBe('pending');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should return pending when no AuthService is provided', async () => {
      const noAuthService = new SequenceLibraryService(mockCatalog as any);
      const result = await noAuthService.setSession(SESSION_ID);
      expect(result).toBe('pending');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should return pending when no access token is available', async () => {
      mockAuth.getAccessToken.mockResolvedValue(null);
      const result = await service.setSession(SESSION_ID);
      expect(result).toBe('pending');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('loadCloud — error handling', () => {
    it('should gracefully handle HTTP errors', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      fetchSpy.mockReturnValue(mockFetchResponse(null, false, 500));

      const result = await service.setSession(SESSION_ID);
      expect(result).toBe('pending');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Template fetch failed'),
        expect.anything()
      );
    });

    it('should gracefully handle network errors', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      fetchSpy.mockRejectedValue(new Error('Network unreachable'));

      const result = await service.setSession(SESSION_ID);
      expect(result).toBe('pending');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Template fetch error'),
        expect.any(Error)
      );
    });
  });

  describe('Cache TTL', () => {
    it('should not re-fetch templates within TTL', async () => {
      await service.setSession(SESSION_ID);
      fetchSpy.mockClear();

      // listSequences should not trigger another fetch
      await service.listSequences();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should re-fetch templates when TTL expires', async () => {
      await service.setSession(SESSION_ID);
      fetchSpy.mockClear();

      // Simulate time passing beyond TTL
      (service as any).cloudCacheTimestamp = Date.now() - 6 * 60 * 1000;

      await service.listSequences();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSequence', () => {
    it('should find cloud sequences by ID', async () => {
      await service.setSession(SESSION_ID);

      const seq = await service.getSequence('tmpl_battle-cam');
      expect(seq).not.toBeNull();
      expect(seq!.id).toBe('tmpl_battle-cam');
      expect(seq!.category).toBe('cloud');
    });

    it('should return null for unknown IDs', async () => {
      await service.setSession(SESSION_ID);

      const seq = await service.getSequence('nonexistent');
      expect(seq).toBeNull();
    });
  });

  describe('listSequences with filters', () => {
    it('should filter cloud sequences by category', async () => {
      await service.setSession(SESSION_ID);

      const cloudOnly = await service.listSequences({ category: 'cloud' });
      expect(cloudOnly).toHaveLength(2);
      cloudOnly.forEach(s => expect(s.category).toBe('cloud'));
    });

    it('should filter by search text across cloud sequences', async () => {
      await service.setSession(SESSION_ID);

      const results = await service.listSequences({ search: 'Battle' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('tmpl_battle-cam');
    });
  });

  describe('checkinId filtering', () => {
    it('should only keep templates matching the active checkinId', async () => {
      const mixedTemplates: SequenceTemplate[] = [
        { ...cloudTemplates[0], checkinId: 'current-checkin' },
        { ...cloudTemplates[1], checkinId: 'old-stale-checkin' },
      ];
      fetchSpy.mockReturnValue(mockFetchResponse(mixedTemplates));

      await service.setSession(SESSION_ID, 'current-checkin');
      const cloud = await service.listSequences({ category: 'cloud' });

      expect(cloud).toHaveLength(1);
      expect(cloud[0].id).toBe('tmpl_battle-cam');
    });

    it('should keep all templates when no checkinId is provided', async () => {
      const mixedTemplates: SequenceTemplate[] = [
        { ...cloudTemplates[0], checkinId: 'checkin-a' },
        { ...cloudTemplates[1], checkinId: 'checkin-b' },
      ];
      fetchSpy.mockReturnValue(mockFetchResponse(mixedTemplates));

      await service.setSession(SESSION_ID);
      const cloud = await service.listSequences({ category: 'cloud' });

      expect(cloud).toHaveLength(2);
    });

    it('should return zero templates when all are stale', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse(cloudTemplates));

      await service.setSession(SESSION_ID, 'brand-new-checkin');
      const cloud = await service.listSequences({ category: 'cloud' });

      expect(cloud).toHaveLength(0);
    });
  });
});
