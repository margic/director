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
      checkin: (id: string) => `/api/director/v1/sessions/${id}/checkin`,
      refreshCheckin: (id: string) => `/api/director/v1/sessions/${id}/checkin`,
      wrap: (id: string) => `/api/director/v1/sessions/${id}/checkin`,
    },
  },
}));

vi.mock('./config-service', () => ({
  configService: {
    getOrCreateDirectorId: () => 'd_inst_test',
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

  // -----------------------------------------------------------------------
  // Issue #193: identity resolution gating before first check-in
  // -----------------------------------------------------------------------
  describe('checkinSession identity resolution (#193)', () => {
    const selected: RaceSession = {
      raceSessionId: 'sess-193',
      name: 'Identity Test',
      centerId: 'test-center',
    };

    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [selected],
        headers: new Headers(),
      });
      await sessionManager.discover();
      await sessionManager.selectSession('sess-193');
    });

    it('defers POST /checkin until capabilities report identityResolved=true', async () => {
      vi.useFakeTimers();
      try {
        let resolved = false;
        const builder = vi.fn(() => ({
          extensions: [],
          connections: {},
          drivers: [{ carNumber: '15', userName: 'Paul Crofts', carName: '' }],
          identityResolved: resolved,
        }));
        sessionManager.setCapabilitiesBuilder(builder as any);
        sessionManager.setRaceContextGetter(() => null);

        // Stub the actual HTTP POST so we can observe when it fires.
        let postFired = false;
        mockFetch.mockImplementation(async () => {
          postFired = true;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'standby',
              checkinId: 'ci-1',
              checkinTtlSeconds: 120,
              sessionConfig: { raceSessionId: 'sess-193', name: '', status: '', simulator: 'iRacing', drivers: [], obsScenes: [] },
              warnings: [],
            }),
            headers: new Headers(),
          };
        });

        const inFlight = sessionManager.checkinSession();

        // Advance several poll intervals — POST should still be blocked.
        for (let i = 0; i < 5; i++) {
          await vi.advanceTimersByTimeAsync(1000);
        }
        expect(postFired).toBe(false);

        // Roster stabilises — next poll should release the gate.
        resolved = true;
        await vi.advanceTimersByTimeAsync(1000);
        await inFlight;

        expect(postFired).toBe(true);
        expect(builder).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('proceeds with check-in after timeout when identity never resolves', async () => {
      vi.useFakeTimers();
      try {
        const builder = vi.fn(() => ({
          extensions: [],
          connections: {},
          drivers: [{ carNumber: '15', userName: 'Stale Name', carName: '' }],
          identityResolved: false,
        }));
        sessionManager.setCapabilitiesBuilder(builder as any);
        sessionManager.setRaceContextGetter(() => null);

        const sentBody: any = {};
        mockFetch.mockImplementation(async (_url: any, init: any) => {
          sentBody.body = JSON.parse(init.body);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'standby', checkinId: 'ci-2', checkinTtlSeconds: 120,
              sessionConfig: { raceSessionId: 'sess-193', name: '', status: '', simulator: 'iRacing', drivers: [], obsScenes: [] },
              warnings: [],
            }),
            headers: new Headers(),
          };
        });

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const inFlight = sessionManager.checkinSession();

        // Advance just past the 90s timeout.
        await vi.advanceTimersByTimeAsync(91_000);
        await inFlight;

        // Body should carry identityResolved=false from the builder.
        expect(sentBody.body.capabilities.identityResolved).toBe(false);
        // Should have logged the timeout warning at least once.
        expect(warnSpy.mock.calls.some(c => String(c[0]).includes('without confirmed iRacing roster'))).toBe(true);
        warnSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it('skips the stability wait when forceCheckin=true', async () => {
      const builder = vi.fn(() => ({
        extensions: [],
        connections: {},
        drivers: [{ carNumber: '15', userName: 'Stale Name', carName: '' }],
        identityResolved: false,
      }));
      sessionManager.setCapabilitiesBuilder(builder as any);
      sessionManager.setRaceContextGetter(() => null);

      let posted = false;
      mockFetch.mockImplementation(async () => {
        posted = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'standby', checkinId: 'ci-3', checkinTtlSeconds: 120,
            sessionConfig: { raceSessionId: 'sess-193', name: '', status: '', simulator: 'iRacing', drivers: [], obsScenes: [] },
            warnings: [],
          }),
          headers: new Headers(),
        };
      });

      await sessionManager.checkinSession({ forceCheckin: true });
      expect(posted).toBe(true);
    });
  });

  // Issue #225: stale checkin ID not propagated to poll loop after SESSION_TYPE_CHANGE
  // -----------------------------------------------------------------------
  describe('checkinSession re-checkin propagation (#225)', () => {
    const session: RaceSession = {
      raceSessionId: 'sess-225',
      name: 'Re-checkin Test',
      centerId: 'test-center',
    };

    const checkinResponseFor = (id: string) => ({
      status: 'standby',
      checkinId: id,
      checkinTtlSeconds: 120,
      sessionConfig: {
        raceSessionId: 'sess-225',
        name: '',
        status: '',
        simulator: 'iRacing',
        drivers: [],
        obsScenes: [],
      },
      warnings: [],
    });

    beforeEach(async () => {
      // Discover session, select it, and perform initial check-in
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [session],
          headers: new Headers(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => checkinResponseFor('old-id'),
          headers: new Headers(),
        });

      await sessionManager.discover();
      sessionManager.selectSession('sess-225');
      await sessionManager.checkinSession({ forceCheckin: true });

      expect(sessionManager.getState().checkinId).toBe('old-id');
      expect(sessionManager.getState().state).toBe('checked-in');
    });

    it('emits stateChanged with new checkin ID when re-checking in from already-checked-in state', async () => {
      const stateChangedSpy = vi.fn();
      sessionManager.on('stateChanged', stateChangedSpy);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => checkinResponseFor('new-id'),
        headers: new Headers(),
      });

      await sessionManager.checkinSession({ forceCheckin: true });

      expect(sessionManager.getState().checkinId).toBe('new-id');

      // stateChanged must have fired so the orchestrator can call
      // cloudPoller.updateCheckin(newId, ttl) — this was the bug (#225).
      const lastCall = stateChangedSpy.mock.calls[stateChangedSpy.mock.calls.length - 1][0];
      expect(lastCall.state).toBe('checked-in');
      expect(lastCall.checkinId).toBe('new-id');
    });

    it('updates the stored checkin ID after a successful re-checkin', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => checkinResponseFor('re-id'),
        headers: new Headers(),
      });

      await sessionManager.checkinSession({ forceCheckin: true });

      expect(sessionManager.getCheckinId()).toBe('re-id');
    });
  });
});
