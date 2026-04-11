/**
 * session-manager.test.ts
 *
 * Unit tests for SessionManager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from './session-manager';
import type { AuthService } from './auth-service';
import type { RaceSession } from './director-types';

// Mock the modules
vi.mock('./auth-config', () => ({
  apiConfig: {
    baseUrl: 'https://test.simracecenter.com',
    endpoints: {
      listSessions: '/api/director/v1/sessions',
    },
  },
}));

vi.mock('./telemetry-service', () => ({
  telemetryService: {
    trackDependency: vi.fn(),
    trackMetric: vi.fn(),
    trackEvent: vi.fn(),
    trackException: vi.fn(),
  },
}));

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let mockAuthService: Partial<AuthService>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock AuthService
    mockAuthService = {
      getAccessToken: vi.fn().mockResolvedValue('test-token'),
      getUserProfile: vi.fn().mockResolvedValue({
        userId: 'test-user',
        displayName: 'Test User',
        centerId: 'test-center',
      }),
    };

    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;

    sessionManager = new SessionManager(mockAuthService as AuthService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getState', () => {
    it('should return initial state', () => {
      const state = sessionManager.getState();
      expect(state).toEqual({
        state: 'none',
        sessions: [],
        selectedSession: null,
        lastError: undefined,
        checkinStatus: 'unchecked',
        checkinId: null,
        sessionConfig: null,
        checkinWarnings: [],
        checkinTtlSeconds: 120,
      });
    });
  });

  describe('discover', () => {
    it('should transition to searching then discovered when sessions found', async () => {
      const mockSessions: RaceSession[] = [
        {
          raceSessionId: 'session-1',
          name: 'Test Session 1',
          centerId: 'test-center',
        },
        {
          raceSessionId: 'session-2',
          name: 'Test Session 2',
          centerId: 'test-center',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSessions,
        headers: new Headers(),
      });

      const stateChangedSpy = vi.fn();
      sessionManager.on('stateChanged', stateChangedSpy);

      await sessionManager.discover();

      // Should have emitted state changes
      expect(stateChangedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'searching',
        })
      );
      expect(stateChangedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'discovered',
          sessions: mockSessions,
        })
      );

      // Final state should be discovered
      const state = sessionManager.getState();
      expect(state.state).toBe('discovered');
      expect(state.sessions).toEqual(mockSessions);
    });

    it('should transition to none when no sessions found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
        headers: new Headers(),
      });

      await sessionManager.discover();

      const state = sessionManager.getState();
      expect(state.state).toBe('none');
      expect(state.sessions).toEqual([]);
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers(),
      });

      await sessionManager.discover();

      const state = sessionManager.getState();
      expect(state.state).toBe('none');
      expect(state.lastError).toContain('Failed to fetch sessions: 500');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await sessionManager.discover();

      const state = sessionManager.getState();
      expect(state.state).toBe('none');
      expect(state.lastError).toBe('Network error');
    });

    it('should handle missing access token', async () => {
      (mockAuthService.getAccessToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      await sessionManager.discover();

      const state = sessionManager.getState();
      expect(state.state).toBe('none');
      expect(state.lastError).toBe('No access token available');
    });
  });

  describe('selectSession', () => {
    beforeEach(async () => {
      // Set up discovered sessions
      const mockSessions: RaceSession[] = [
        {
          raceSessionId: 'session-1',
          name: 'Test Session 1',
          centerId: 'test-center',
        },
        {
          raceSessionId: 'session-2',
          name: 'Test Session 2',
          centerId: 'test-center',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSessions,
        headers: new Headers(),
      });

      await sessionManager.discover();
    });

    it('should transition to selected when valid session ID provided', () => {
      const stateChangedSpy = vi.fn();
      sessionManager.on('stateChanged', stateChangedSpy);

      sessionManager.selectSession('session-1');

      expect(stateChangedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'selected',
          selectedSession: expect.objectContaining({
            raceSessionId: 'session-1',
            name: 'Test Session 1',
          }),
        })
      );

      const state = sessionManager.getState();
      expect(state.state).toBe('selected');
      expect(state.selectedSession?.raceSessionId).toBe('session-1');
    });

    it('should set error when invalid session ID provided', () => {
      sessionManager.selectSession('invalid-session');

      const state = sessionManager.getState();
      expect(state.lastError).toContain('Session not found: invalid-session');
      expect(state.selectedSession).toBeNull();
    });
  });

  describe('clearSession', () => {
    beforeEach(async () => {
      // Set up selected session
      const mockSessions: RaceSession[] = [
        {
          raceSessionId: 'session-1',
          name: 'Test Session 1',
          centerId: 'test-center',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSessions,
        headers: new Headers(),
      });

      await sessionManager.discover();
      sessionManager.selectSession('session-1');
    });

    it('should transition from selected to discovered', async () => {
      const stateChangedSpy = vi.fn();
      sessionManager.on('stateChanged', stateChangedSpy);

      await sessionManager.clearSession();

      expect(stateChangedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'discovered',
          selectedSession: null,
        })
      );

      const state = sessionManager.getState();
      expect(state.state).toBe('discovered');
      expect(state.selectedSession).toBeNull();
    });

    it('should do nothing if no session selected', async () => {
      // Clear first selection
      await sessionManager.clearSession();

      const stateChangedSpy = vi.fn();
      sessionManager.on('stateChanged', stateChangedSpy);

      // Try to clear again
      await sessionManager.clearSession();

      // Should not emit state change
      expect(stateChangedSpy).not.toHaveBeenCalled();
    });
  });

  describe('getSelectedSession', () => {
    it('should return null when no session selected', () => {
      expect(sessionManager.getSelectedSession()).toBeNull();
    });

    it('should return selected session', async () => {
      const mockSessions: RaceSession[] = [
        {
          raceSessionId: 'session-1',
          name: 'Test Session 1',
          centerId: 'test-center',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSessions,
        headers: new Headers(),
      });

      await sessionManager.discover();
      sessionManager.selectSession('session-1');

      const selected = sessionManager.getSelectedSession();
      expect(selected).toEqual(mockSessions[0]);
    });
  });

  describe('getSessions', () => {
    it('should return empty array initially', () => {
      expect(sessionManager.getSessions()).toEqual([]);
    });

    it('should return discovered sessions', async () => {
      const mockSessions: RaceSession[] = [
        {
          raceSessionId: 'session-1',
          name: 'Test Session 1',
          centerId: 'test-center',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSessions,
        headers: new Headers(),
      });

      await sessionManager.discover();

      const sessions = sessionManager.getSessions();
      expect(sessions).toEqual(mockSessions);
    });
  });
});
