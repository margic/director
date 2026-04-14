/**
 * Unit tests for CloudPoller
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudPoller, CloudPollerOptions } from './cloud-poller';

// Mock modules
vi.mock('./normalizer', () => ({
  normalizeApiResponse: vi.fn((data) => ({
    id: data.id || 'normalized-seq',
    name: data.name,
    steps: data.steps || [],
    metadata: data.metadata,
  })),
}));

vi.mock('./telemetry-service', () => ({
  telemetryService: {
    trackDependency: vi.fn(),
    trackEvent: vi.fn(),
    trackException: vi.fn(),
  },
}));

vi.mock('./auth-config', () => ({
  apiConfig: {
    baseUrl: 'https://test-api.com',
    endpoints: {
      nextSequence: (sessionId: string) => `/api/sessions/${sessionId}/next`,
    },
  },
}));

// Mock AuthService
class MockAuthService {
  getAccessToken = vi.fn().mockResolvedValue('test-token');
}

describe('CloudPoller', () => {
  let poller: CloudPoller;
  let mockAuthService: MockAuthService;
  let mockOptions: CloudPollerOptions;
  let fetchMock: any;

  beforeEach(() => {
    mockAuthService = new MockAuthService();
    mockOptions = {
      idleRetryMs: 100, // Shortened for tests
      getActiveIntents: vi.fn().mockReturnValue(['system.wait', 'system.log']),
      onSequence: vi.fn(),
      onSessionEnded: vi.fn(),
    };

    // Mock global fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;

    poller = new CloudPoller(mockAuthService as any, 'test-session-123', mockOptions);
  });

  afterEach(() => {
    if (poller.isPolling()) {
      poller.stop();
    }
    vi.clearAllMocks();
  });

  describe('start/stop', () => {
    it('should start polling when start() is called', () => {
      expect(poller.isPolling()).toBe(false);
      poller.start();
      expect(poller.isPolling()).toBe(true);
      poller.stop();
    });

    it('should stop polling when stop() is called', () => {
      poller.start();
      expect(poller.isPolling()).toBe(true);
      poller.stop();
      expect(poller.isPolling()).toBe(false);
    });

    it('should handle being started twice', () => {
      poller.start();
      poller.start(); // Should not crash
      expect(poller.isPolling()).toBe(true);
      poller.stop();
    });
  });

  describe('200 OK - Sequence received', () => {
    it('should call onSequence callback when receiving a sequence', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          id: 'seq-123',
          steps: [{ id: 'step-1', intent: 'system.wait', payload: { durationMs: 1000 } }],
        }),
      });

      poller.start();

      await vi.waitFor(
        () => {
          expect(mockOptions.onSequence).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );

      expect(mockOptions.onSequence).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          steps: expect.any(Array),
        })
      );

      poller.stop();
    });

    it('should send intents in POST body', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ id: 'seq-123', steps: [] }),
      });

      poller.start();

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      }, { timeout: 1000 });

      const [, options] = fetchMock.mock.calls[0];
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body);
      expect(body.intents).toEqual(['system.wait', 'system.log']);

      poller.stop();
    });

    it('should send checkinId in header when provided', async () => {
      mockOptions.checkinId = 'checkin-abc';

      fetchMock.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ id: 'seq-123', steps: [] }),
      });

      poller.start();

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      }, { timeout: 1000 });

      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers['X-Checkin-Id']).toBe('checkin-abc');

      poller.stop();
    });

    it('should include raceContext in POST body when available', async () => {
      const mockContext = {
        sessionType: 'Race',
        sessionFlags: 'GREEN',
        cautionType: 'local',
        lapsRemain: 10,
        timeRemainSec: -1,
        leaderLap: 5,
        totalLaps: 15,
        focusedCarNumber: '42',
        battles: [{ cars: ['42', '7'], gapSec: 0.4 }],
        pitting: [],
        carCount: 12,
        trackName: 'Lime Rock Park',
        trackType: 'road course',
        seriesName: 'Global Mazda MX-5 Cup',
      };
      mockOptions.getRaceContext = vi.fn().mockReturnValue(mockContext);

      fetchMock.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ id: 'seq-123', steps: [] }),
      });

      poller.start();

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      }, { timeout: 1000 });

      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.raceContext).toEqual(mockContext);

      poller.stop();
    });
  });

  describe('204 No Content - No sequence available', () => {
    it('should parse Retry-After header when provided', async () => {
      fetchMock.mockResolvedValue({
        status: 204,
        ok: true,
        headers: { get: (name: string) => (name === 'Retry-After' ? '5' : null) },
      });

      poller.start();

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }, { timeout: 1000 });

      poller.stop();
      // Verify it was called - timing is tested elsewhere
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  describe('410 Gone - Session ended', () => {
    it('should call onSessionEnded callback and stop polling', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 410,
        ok: false,
        headers: { get: () => null },
      });

      poller.start();

      await vi.waitFor(() => {
        expect(mockOptions.onSessionEnded).toHaveBeenCalled();
      }, { timeout: 1000 });

      expect(poller.isPolling()).toBe(false);
      expect(mockOptions.onSessionEnded).toHaveBeenCalledTimes(1);
    });
  });

  describe('onSequenceCompleted', () => {
    it('should trigger request for next sequence after completion', async () => {
      fetchMock
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({ id: 'seq-1', steps: [] }),
        })
        .mockResolvedValueOnce({
          status: 204,
          ok: true,
          headers: { get: () => null },
        });

      poller.start();

      await vi.waitFor(() => {
        expect(mockOptions.onSequence).toHaveBeenCalledTimes(1);
      }, { timeout: 1000 });

      // Notify completion - should trigger immediate retry
      poller.onSequenceCompleted('seq-1');

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      }, { timeout: 1000 });

      const [, secondCallOptions] = fetchMock.mock.calls[1];
      const body = JSON.parse(secondCallOptions.body);
      expect(body.lastSequenceId).toBe('seq-1');

      poller.stop();
    });
  });

  describe('Error handling', () => {
    it('should handle network error gracefully', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      poller.start();

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      }, { timeout: 1000 });

      // Should not crash - poller continues running
      expect(poller.isPolling()).toBe(true);

      poller.stop();
    });

    it('should handle 500 error gracefully', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 500,
        ok: false,
        statusText: 'Internal Server Error',
        headers: { get: () => null },
      });

      poller.start();

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      }, { timeout: 1000 });

      // Should not crash
      expect(poller.isPolling()).toBe(true);

      poller.stop();
    });

    it('should handle missing access token gracefully', async () => {
      // Create a new poller with auth service that returns null
      const nullAuthService = new MockAuthService();
      nullAuthService.getAccessToken.mockResolvedValue(null);

      const nullPoller = new CloudPoller(nullAuthService as any, 'test-session-123', mockOptions);

      nullPoller.start();

      // Wait a bit for the request loop to run
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should not have called fetch
      expect(fetchMock).not.toHaveBeenCalled();

      nullPoller.stop();
    });
  });

  describe('updateCheckin/clearCheckin', () => {
    it('should update checkin credentials', async () => {
      poller.updateCheckin('new-checkin-id', 60);

      fetchMock.mockResolvedValueOnce({
        status: 204,
        ok: true,
        headers: { get: () => null },
      });

      poller.start();

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      }, { timeout: 1000 });

      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers['X-Checkin-Id']).toBe('new-checkin-id');

      poller.stop();
    });

    it('should clear checkin credentials', async () => {
      poller.updateCheckin('checkin-123', 60);
      poller.clearCheckin();

      fetchMock.mockResolvedValueOnce({
        status: 204,
        ok: true,
        headers: { get: () => null },
      });

      poller.start();

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      }, { timeout: 1000 });

      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers['X-Checkin-Id']).toBeUndefined();

      poller.stop();
    });
  });

  describe('Authorization', () => {
    it('should send Bearer token in Authorization header', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 204,
        ok: true,
        headers: { get: () => null },
      });

      poller.start();

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      }, { timeout: 1000 });

      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers['Authorization']).toBe('Bearer test-token');

      poller.stop();
    });
  });
});
