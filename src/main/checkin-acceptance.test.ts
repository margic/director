/**
 * checkin-acceptance.test.ts
 *
 * Comprehensive acceptance criteria tests for Session Check-In feature.
 * Based on issue: "Implement Check-In Client for Race Control API"
 *
 * Check-in lifecycle is owned by SessionManager. The DirectorOrchestrator
 * delegates to SessionManager and reads check-in state from it.
 *
 * Acceptance Criteria:
 * 1. Check-in call succeeds and returns checkinId + sessionConfig + warnings
 * 2. Warnings display in UI (via state exposure)
 * 3. X-Checkin-Id is sent on every sequence request
 * 4. Wrap call releases the check-in on session stop
 * 5. Re-check-in fires on extension connect/disconnect
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DirectorOrchestrator } from './director-orchestrator';
import { CloudPoller } from './cloud-poller';
import { EventEmitter } from 'events';

// Mock dependencies
vi.mock('./auth-service');
vi.mock('./extension-host/extension-host');
vi.mock('./session-manager');
vi.mock('./sequence-scheduler');
vi.mock('./config-service', () => ({
  configService: {
    get: vi.fn(() => ({ defaultMode: 'stopped' })),
    set: vi.fn(),
    getOrCreateDirectorId: vi.fn(() => 'd_inst_test-uuid-12345'),
  },
}));
vi.mock('./telemetry-service', () => ({
  telemetryService: {
    trackEvent: vi.fn(),
    trackException: vi.fn(),
    trackDependency: vi.fn(),
  },
}));

describe('Session Check-In Acceptance Criteria', () => {
  let orchestrator: DirectorOrchestrator;
  let mockAuthService: any;
  let mockExtensionHost: any;
  let mockSessionManager: any;
  let mockScheduler: any;
  let mockEventBus: any;

  // Shared helper to configure SessionManager mock state
  let sessionManagerState: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    sessionManagerState = {
      state: 'selected',
      sessions: [],
      selectedSession: { raceSessionId: 'session-abc-123', name: 'Test Race Session' },
      checkinStatus: 'unchecked',
      checkinId: null,
      sessionConfig: null,
      checkinWarnings: [],
      checkinTtlSeconds: 120,
    };

    // Create mock instances
    mockAuthService = {
      getAccessToken: vi.fn().mockResolvedValue('test-bearer-token'),
    };

    mockExtensionHost = {
      getCapabilityCatalog: vi.fn(() => ({
        getAllIntents: vi.fn(() => [
          {
            intent: { intent: 'obs.switchScene', schema: { sceneId: 'string' } },
            extensionId: 'director-obs',
            enabled: true
          },
          {
            intent: { intent: 'iracing.getData' },
            extensionId: 'director-iracing',
            enabled: true
          },
        ]),
      })),
      getConnectionHealth: vi.fn(() => ({
        'director-obs': { connected: true, connectedSince: '2026-04-01T00:00:00Z' },
        'director-iracing': { connected: false },
      })),
    };

    mockSessionManager = Object.assign(new EventEmitter(), {
      getSelectedSession: vi.fn(() => ({
        raceSessionId: 'session-abc-123',
        name: 'Test Race Session',
      })),
      selectSession: vi.fn(),
      clearSession: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn(() => sessionManagerState),
      getSessions: vi.fn(() => []),
      discover: vi.fn(),
      checkinSession: vi.fn().mockResolvedValue({}),
      wrapSession: vi.fn().mockResolvedValue({}),
      refreshCheckin: vi.fn().mockResolvedValue({}),
      getCheckinId: vi.fn(() => sessionManagerState.checkinId),
      getCheckinTtlSeconds: vi.fn(() => sessionManagerState.checkinTtlSeconds),
      getSessionConfig: vi.fn(() => sessionManagerState.sessionConfig),
    });

    mockScheduler = Object.assign(new EventEmitter(), {
      enqueue: vi.fn(),
    });

    mockEventBus = Object.assign(new EventEmitter(), {
      emitExtensionEvent: vi.fn(),
    });

    orchestrator = new DirectorOrchestrator(
      mockAuthService,
      mockExtensionHost,
      mockSessionManager,
      mockScheduler,
      mockEventBus
    );
  });

  describe('AC1: Check-in call succeeds and returns checkinId + sessionConfig + warnings', () => {
    it('should delegate check-in to SessionManager and expose state', async () => {
      // Configure mock to update state on checkinSession
      mockSessionManager.checkinSession.mockImplementation(async () => {
        sessionManagerState.checkinStatus = 'standby';
        sessionManagerState.checkinId = 'checkin-xyz-789';
        sessionManagerState.checkinTtlSeconds = 120;
        sessionManagerState.sessionConfig = {
          raceSessionId: 'session-abc-123',
          name: 'Test Race Session',
          status: 'ACTIVE',
          simulator: 'iRacing',
          drivers: [
            {
              driverId: 'driver-1',
              carNumber: '42',
              rigId: 'rig-1',
              obsSceneId: 'scene-1',
              displayName: 'John Doe',
            },
          ],
          obsScenes: ['scene-1', 'scene-2'],
          obsHost: 'ws://localhost:4455',
          timingConfig: {
            idleRetryIntervalMs: 5000,
            retryBackoffMs: 1000,
          },
        };
        sessionManagerState.checkinWarnings = ['OBS connected but iRacing is offline', 'No YouTube extension detected'];
        sessionManagerState.state = 'checked-in';
        return sessionManagerState;
      });

      // Execute check-in via orchestrator (delegates to SessionManager)
      const state = await orchestrator.checkinSession('session-abc-123');

      // Verify SessionManager.checkinSession was called
      expect(mockSessionManager.checkinSession).toHaveBeenCalled();

      // Verify state reflects SessionManager
      expect(state.checkinStatus).toBe('standby');
      expect(state.checkinId).toBe('checkin-xyz-789');

      // Verify sessionConfig
      expect(state.sessionConfig).toBeDefined();
      expect(state.sessionConfig?.raceSessionId).toBe('session-abc-123');
      expect(state.sessionConfig?.drivers).toHaveLength(1);
      expect(state.sessionConfig?.obsScenes).toEqual(['scene-1', 'scene-2']);
      expect(state.sessionConfig?.timingConfig?.idleRetryIntervalMs).toBe(5000);

      // Verify warnings
      expect(state.checkinWarnings).toHaveLength(2);
      expect(state.checkinWarnings).toContain('OBS connected but iRacing is offline');
      expect(state.checkinWarnings).toContain('No YouTube extension detected');
    });

    it('should handle check-in with empty warnings array', async () => {
      mockSessionManager.checkinSession.mockImplementation(async () => {
        sessionManagerState.checkinStatus = 'standby';
        sessionManagerState.checkinId = 'checkin-no-warnings';
        sessionManagerState.checkinWarnings = [];
        sessionManagerState.state = 'checked-in';
        return sessionManagerState;
      });

      const state = await orchestrator.checkinSession('session-abc-123');
      expect(state.checkinWarnings).toEqual([]);
    });
  });

  describe('AC2: Warnings display in UI (exposed in state)', () => {
    it('should expose warnings in state for UI consumption', async () => {
      mockSessionManager.checkinSession.mockImplementation(async () => {
        sessionManagerState.checkinWarnings = ['Warning 1', 'Warning 2', 'Warning 3'];
        sessionManagerState.checkinStatus = 'standby';
        sessionManagerState.checkinId = 'checkin-123';
        sessionManagerState.state = 'checked-in';
        return sessionManagerState;
      });

      await orchestrator.checkinSession('session-abc-123');

      const state = orchestrator.getState();
      expect(state.checkinWarnings).toBeDefined();
      expect(state.checkinWarnings).toHaveLength(3);
      expect(state.checkinWarnings).toEqual(['Warning 1', 'Warning 2', 'Warning 3']);
    });
  });

  describe('AC3: X-Checkin-Id is sent on every sequence request', () => {
    it('should include X-Checkin-Id header in CloudPoller sequence requests', async () => {
      // Create a CloudPoller with the checkinId
      const poller = new CloudPoller(
        mockAuthService,
        'session-abc-123',
        {
          idleRetryMs: 5000,
          getActiveIntents: () => ['system.wait', 'obs.switchScene'],
          onSequence: vi.fn(),
          onSessionEnded: vi.fn(),
          checkinId: 'checkin-for-polling',
          checkinTtlSeconds: 120,
        }
      );

      // Mock 204 No Content response (no sequence available)
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 204,
        headers: new Headers({ 'Retry-After': '5' }),
      }) as any;

      // Start polling (it will make one request)
      poller.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      poller.stop();

      // Verify X-Checkin-Id header was sent
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/sequences/next'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-Checkin-Id': 'checkin-for-polling',
          }),
        })
      );
    });
  });

  describe('AC4: Wrap call releases the check-in on session stop', () => {
    it('should delegate wrap to SessionManager', async () => {
      // Set up checked-in state
      sessionManagerState.checkinStatus = 'standby';
      sessionManagerState.checkinId = 'checkin-to-wrap';
      sessionManagerState.state = 'checked-in';

      mockSessionManager.wrapSession.mockImplementation(async () => {
        sessionManagerState.checkinStatus = 'unchecked';
        sessionManagerState.checkinId = null;
        sessionManagerState.sessionConfig = null;
        sessionManagerState.checkinWarnings = [];
        sessionManagerState.state = 'selected';
        return sessionManagerState;
      });

      // Execute wrap
      await orchestrator.wrapSession('test-stop');

      // Verify SessionManager.wrapSession was called
      expect(mockSessionManager.wrapSession).toHaveBeenCalledWith('test-stop');

      // Verify state was reset
      const state = orchestrator.getState();
      expect(state.checkinStatus).toBe('unchecked');
      expect(state.checkinId).toBeNull();
      expect(state.sessionConfig).toBeNull();
    });

    it('should handle wrap when not checked in', async () => {
      // No check-in active (default state)
      await orchestrator.wrapSession();

      // Should still call SessionManager
      expect(mockSessionManager.wrapSession).toHaveBeenCalled();
    });
  });

  describe('AC5: Re-check-in fires on extension connect/disconnect', () => {
    it('should refresh check-in via SessionManager when OBS connects', async () => {
      // Set checked-in state
      sessionManagerState.checkinStatus = 'standby';
      sessionManagerState.checkinId = 'checkin-123';
      sessionManagerState.state = 'checked-in';

      // Emit OBS connection event
      mockEventBus.emit('obs.connectionStateChanged', {
        extensionId: 'director-obs',
        payload: { connected: true },
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockSessionManager.refreshCheckin).toHaveBeenCalled();
    });

    it('should refresh check-in via SessionManager when iRacing connects', async () => {
      sessionManagerState.checkinStatus = 'standby';
      sessionManagerState.checkinId = 'checkin-123';
      sessionManagerState.state = 'checked-in';

      mockEventBus.emit('iracing.connectionStateChanged', {
        extensionId: 'director-iracing',
        payload: { connected: true },
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(mockSessionManager.refreshCheckin).toHaveBeenCalled();
    });

    it('should refresh check-in via SessionManager when YouTube status changes', async () => {
      sessionManagerState.checkinStatus = 'standby';
      sessionManagerState.checkinId = 'checkin-123';
      sessionManagerState.state = 'checked-in';

      mockEventBus.emit('youtube.status', {
        extensionId: 'director-youtube',
        payload: { monitoring: true },
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(mockSessionManager.refreshCheckin).toHaveBeenCalled();
    });

    it('should refresh check-in when extension capabilities change (enable)', async () => {
      sessionManagerState.checkinStatus = 'standby';
      sessionManagerState.checkinId = 'checkin-123';
      sessionManagerState.state = 'checked-in';

      mockEventBus.emit('extension.capabilitiesChanged', {
        extensionId: 'director-obs',
        payload: { extensionId: 'director-obs', enabled: true },
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(mockSessionManager.refreshCheckin).toHaveBeenCalled();
    });

    it('should refresh check-in when extension capabilities change (disable)', async () => {
      sessionManagerState.checkinStatus = 'standby';
      sessionManagerState.checkinId = 'checkin-123';
      sessionManagerState.state = 'checked-in';

      mockEventBus.emit('extension.capabilitiesChanged', {
        extensionId: 'director-iracing',
        payload: { extensionId: 'director-iracing', enabled: false },
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(mockSessionManager.refreshCheckin).toHaveBeenCalled();
    });

    it('should NOT refresh if not currently checked in', async () => {
      // Default unchecked state

      mockEventBus.emit('obs.connectionStateChanged', {
        extensionId: 'director-obs',
        payload: { connected: true },
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(mockSessionManager.refreshCheckin).not.toHaveBeenCalled();
    });

    it('should handle multiple rapid connection events gracefully', async () => {
      sessionManagerState.checkinStatus = 'standby';
      sessionManagerState.checkinId = 'checkin-123';
      sessionManagerState.state = 'checked-in';

      // Emit multiple connection events rapidly
      mockEventBus.emit('obs.connectionStateChanged', {
        extensionId: 'director-obs',
        payload: { connected: true },
      });
      mockEventBus.emit('iracing.connectionStateChanged', {
        extensionId: 'director-iracing',
        payload: { connected: true },
      });
      mockEventBus.emit('youtube.status', {
        extensionId: 'director-youtube',
        payload: { monitoring: true },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have called refreshCheckin for each event
      expect(mockSessionManager.refreshCheckin.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Integration: Complete Check-In Flow', () => {
    it('should complete full lifecycle: check-in → state → wrap', async () => {
      // 1. Check in
      mockSessionManager.checkinSession.mockImplementation(async () => {
        sessionManagerState.checkinStatus = 'standby';
        sessionManagerState.checkinId = 'full-lifecycle-checkin';
        sessionManagerState.checkinWarnings = ['Test warning'];
        sessionManagerState.state = 'checked-in';
        return sessionManagerState;
      });

      const checkinState = await orchestrator.checkinSession('session-abc-123');
      expect(checkinState.checkinStatus).toBe('standby');
      expect(checkinState.checkinId).toBe('full-lifecycle-checkin');
      expect(checkinState.checkinWarnings).toContain('Test warning');

      // 2. Verify state is correct
      expect(checkinState.checkinId).toBeTruthy();

      // 3. Wrap the session
      mockSessionManager.wrapSession.mockImplementation(async () => {
        sessionManagerState.checkinStatus = 'unchecked';
        sessionManagerState.checkinId = null;
        sessionManagerState.sessionConfig = null;
        sessionManagerState.checkinWarnings = [];
        sessionManagerState.state = 'selected';
        return sessionManagerState;
      });

      const wrapState = await orchestrator.wrapSession('test-complete');
      expect(wrapState.checkinStatus).toBe('unchecked');
      expect(wrapState.checkinId).toBeNull();
      expect(wrapState.sessionConfig).toBeNull();
      expect(wrapState.checkinWarnings).toEqual([]);
    });
  });
});
