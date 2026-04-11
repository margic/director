/**
 * Unit tests for SequenceLibraryService — Cloud Tier
 *
 * Tests the cloud sequence fetching, caching, and graceful offline degradation.
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
import { PortableSequence } from './director-types';

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

describe('SequenceLibraryService — Cloud Tier', () => {
  let service: SequenceLibraryService;
  let mockAuth: MockAuthService;
  let mockCatalog: MockCapabilityCatalog;
  let fetchSpy: ReturnType<typeof vi.fn>;

  const cloudSequences: PortableSequence[] = [
    {
      id: 'cloud-seq-1',
      name: 'Battle Cam',
      steps: [
        { id: 's1', intent: 'broadcast.showLiveCam', payload: { carNum: '1', camGroup: 1 } },
      ],
    },
    {
      id: 'cloud-seq-2',
      name: 'Quick Replay',
      steps: [
        { id: 's1', intent: 'system.wait', payload: { durationMs: 3000 } },
      ],
    },
  ];

  beforeEach(() => {
    mockAuth = new MockAuthService();
    mockCatalog = new MockCapabilityCatalog();
    service = new SequenceLibraryService(mockCatalog as any, mockAuth as any);

    // Mock global fetch
    fetchSpy = vi.fn().mockReturnValue(mockFetchResponse(cloudSequences));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('loadCloud', () => {
    it('should fetch cloud sequences with bearer token', async () => {
      await service.loadCloud();

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/director/v1/sequences'),
        expect.objectContaining({
          headers: { Authorization: 'Bearer mock-token-123' },
        })
      );
    });

    it('should tag fetched sequences with category cloud', async () => {
      await service.loadCloud();
      const all = await service.listSequences();

      const cloud = all.filter(s => s.category === 'cloud');
      expect(cloud).toHaveLength(2);
      expect(cloud[0].id).toBe('cloud-seq-1');
      expect(cloud[1].id).toBe('cloud-seq-2');
    });

    it('should skip when no AuthService is provided', async () => {
      const noAuthService = new SequenceLibraryService(mockCatalog as any);
      await noAuthService.loadCloud();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should skip when no access token is available', async () => {
      mockAuth.getAccessToken.mockResolvedValue(null);
      await service.loadCloud();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should gracefully handle HTTP errors', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      fetchSpy.mockReturnValue(mockFetchResponse(null, false, 500));

      await service.loadCloud();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cloud fetch failed'),
        expect.anything()
      );
      // Should not throw
    });

    it('should gracefully handle network errors', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      fetchSpy.mockRejectedValue(new Error('Network unreachable'));

      await service.loadCloud();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cloud fetch error'),
        expect.any(Error)
      );
    });
  });

  describe('Cache TTL', () => {
    it('should not re-fetch cloud within TTL', async () => {
      await service.loadCloud();
      fetchSpy.mockClear();

      // listSequences should not trigger another fetch
      await service.listSequences();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should re-fetch cloud when TTL expires', async () => {
      await service.loadCloud();
      fetchSpy.mockClear();

      // Simulate time passing beyond TTL by manipulating the timestamp
      // Access private field via bracket notation for testing
      (service as any).cloudCacheTimestamp = Date.now() - 6 * 60 * 1000;

      await service.listSequences();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSequence', () => {
    it('should find cloud sequences by ID', async () => {
      await service.loadCloud();

      const seq = await service.getSequence('cloud-seq-1');

      expect(seq).not.toBeNull();
      expect(seq!.id).toBe('cloud-seq-1');
      expect(seq!.category).toBe('cloud');
    });

    it('should return null for unknown IDs', async () => {
      await service.loadCloud();

      const seq = await service.getSequence('nonexistent');

      expect(seq).toBeNull();
    });
  });

  describe('listSequences with filters', () => {
    it('should filter cloud sequences by category', async () => {
      await service.loadCloud();

      const cloudOnly = await service.listSequences({ category: 'cloud' });

      expect(cloudOnly).toHaveLength(2);
      cloudOnly.forEach(s => expect(s.category).toBe('cloud'));
    });

    it('should filter by search text across cloud sequences', async () => {
      await service.loadCloud();

      const results = await service.listSequences({ search: 'Battle' });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('cloud-seq-1');
    });
  });
});
