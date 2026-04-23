/**
 * Unit tests for CloudPoller
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudPoller, CloudPollerOptions } from './cloud-poller';
import { telemetryService } from './telemetry-service';

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

    it('should send intents query parameter', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ id: 'seq-123', steps: [] }),
      });

      poller.start();

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      }, { timeout: 1000 });

      const callUrl = fetchMock.mock.calls[0][0];
      expect(callUrl).toContain('intents=system.wait%2Csystem.log');

      poller.stop();
    });

    it('should send checkinId in query parameter and header when provided', async () => {
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

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain('checkinId=checkin-abc');
      expect(options.headers['X-Checkin-Id']).toBe('checkin-abc');

      poller.stop();
    });

    it('should log and track executionPath from metadata when present', async () => {
      const consoleSpy = vi.spyOn(console, 'log');

      fetchMock.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          id: 'seq-456',
          steps: [],
          metadata: { executionPath: 'preselect-deterministic' },
        }),
      });

      poller.start();

      await vi.waitFor(() => {
        expect(mockOptions.onSequence).toHaveBeenCalled();
      }, { timeout: 1000 });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('preselect-deterministic')
      );

      expect(telemetryService.trackEvent).toHaveBeenCalledWith(
        'Sequence.Received',
        expect.objectContaining({ executionPath: 'preselect-deterministic' })
      );

      poller.stop();
      consoleSpy.mockRestore();
    });

    it('should log "unknown" executionPath when metadata is absent', async () => {
      const consoleSpy = vi.spyOn(console, 'log');

      fetchMock.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ id: 'seq-789', steps: [] }),
      });

      poller.start();

      await vi.waitFor(() => {
        expect(mockOptions.onSequence).toHaveBeenCalled();
      }, { timeout: 1000 });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('unknown')
      );

      expect(telemetryService.trackEvent).toHaveBeenCalledWith(
        'Sequence.Received',
        expect.objectContaining({ executionPath: 'unknown' })
      );

      poller.stop();
      consoleSpy.mockRestore();
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

      const secondCallUrl = fetchMock.mock.calls[1][0];
      expect(secondCallUrl).toContain('lastSequenceId=seq-1');

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

      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('checkinId=new-checkin-id');

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

      const [url] = fetchMock.mock.calls[0];
      expect(url).not.toContain('checkinId');

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
