/**
 * checkin-acceptance.test.ts
 *
 * Comprehensive acceptance criteria tests for Session Check-In feature.
 * Based on issue: "Implement Check-In Client for Race Control API"
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
    get: vi.fn(() => ({ defaultMode: 'stopped', autoStartOnSessionSelect: false })),
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

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

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
      clearSession: vi.fn(),
      getState: vi.fn(() => ({
        state: 'selected',
        sessions: [],
        selectedSession: { raceSessionId: 'session-abc-123', name: 'Test Race Session' }
      })),
      getSessions: vi.fn(() => []),
      discover: vi.fn(),
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
    it('should successfully check in and receive all expected fields', async () => {
      // Mock successful check-in response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'standby',
          checkinId: 'checkin-xyz-789',
          checkinTtlSeconds: 120,
          sessionConfig: {
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
          },
          warnings: ['OBS connected but iRacing is offline', 'No YouTube extension detected'],
        }),
      }) as any;

      // Execute check-in
      const state = await orchestrator.checkinSession('session-abc-123');

      // Verify check-in was successful
      expect(state.checkinStatus).toBe('standby');
      expect(state.checkinId).toBe('checkin-xyz-789');

      // Verify sessionConfig is present
      expect(state.sessionConfig).toBeDefined();
      expect(state.sessionConfig?.raceSessionId).toBe('session-abc-123');
      expect(state.sessionConfig?.drivers).toHaveLength(1);
      expect(state.sessionConfig?.obsScenes).toEqual(['scene-1', 'scene-2']);
      expect(state.sessionConfig?.timingConfig?.idleRetryIntervalMs).toBe(5000);

      // Verify warnings are captured
      expect(state.checkinWarnings).toHaveLength(2);
      expect(state.checkinWarnings).toContain('OBS connected but iRacing is offline');
      expect(state.checkinWarnings).toContain('No YouTube extension detected');

      // Verify request was made with correct payload
      expect(global.fetch).toHaveBeenCalledWith(
        'https://simracecenter.com/api/director/v1/sessions/session-abc-123/checkin',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-bearer-token',
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('d_inst_test-uuid-12345'),
        })
      );

      // Verify payload includes capabilities
      const requestBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(requestBody.directorId).toBe('d_inst_test-uuid-12345');
      expect(requestBody.capabilities).toBeDefined();
      expect(requestBody.capabilities.intents).toBeDefined();
      expect(requestBody.capabilities.connections).toBeDefined();
    });

    it('should handle check-in with empty warnings array', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'standby',
          checkinId: 'checkin-no-warnings',
          checkinTtlSeconds: 120,
          sessionConfig: {
            raceSessionId: 'session-abc-123',
            name: 'Test Session',
            status: 'ACTIVE',
            simulator: 'iRacing',
            drivers: [],
            obsScenes: [],
          },
          warnings: [],
        }),
      }) as any;

      const state = await orchestrator.checkinSession('session-abc-123');
      expect(state.checkinWarnings).toEqual([]);
    });

    it('should handle check-in with missing warnings field (undefined)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'standby',
          checkinId: 'checkin-no-warnings-field',
          checkinTtlSeconds: 120,
          sessionConfig: {
            raceSessionId: 'session-abc-123',
            name: 'Test Session',
            status: 'ACTIVE',
            simulator: 'iRacing',
            drivers: [],
            obsScenes: [],
          },
          // No warnings field
        }),
      }) as any;

      const state = await orchestrator.checkinSession('session-abc-123');
      expect(state.checkinWarnings).toEqual([]);
    });
  });

  describe('AC2: Warnings display in UI (exposed in state)', () => {
    it('should expose warnings in state for UI consumption', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'standby',
          checkinId: 'checkin-123',
          checkinTtlSeconds: 120,
          sessionConfig: {
            raceSessionId: 'session-abc-123',
            name: 'Test Session',
            status: 'ACTIVE',
            simulator: 'iRacing',
            drivers: [],
            obsScenes: [],
          },
          warnings: ['Warning 1', 'Warning 2', 'Warning 3'],
        }),
      }) as any;

      await orchestrator.checkinSession('session-abc-123');

      // Get state (as UI would)
      const state = orchestrator.getState();

      // Verify warnings are accessible
      expect(state.checkinWarnings).toBeDefined();
      expect(state.checkinWarnings).toHaveLength(3);
      expect(state.checkinWarnings).toEqual(['Warning 1', 'Warning 2', 'Warning 3']);
    });
  });

  describe('AC3: X-Checkin-Id is sent on every sequence request', () => {
    it('should include X-Checkin-Id header in CloudPoller sequence requests', async () => {
      // First, check in
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'standby',
          checkinId: 'checkin-for-polling',
          checkinTtlSeconds: 120,
          sessionConfig: {
            raceSessionId: 'session-abc-123',
            name: 'Test Session',
            status: 'ACTIVE',
            simulator: 'iRacing',
            drivers: [],
            obsScenes: [],
          },
        }),
      }) as any;

      await orchestrator.checkinSession('session-abc-123');

      // Now create a CloudPoller with the checkinId
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
          headers: expect.objectContaining({
            'X-Checkin-Id': 'checkin-for-polling',
          }),
        })
      );

      // Verify checkinId is also in query params (fallback)
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('checkinId=checkin-for-polling'),
        expect.anything()
      );
    });
  });

  describe('AC4: Wrap call releases the check-in on session stop', () => {
    it('should send DELETE request with X-Checkin-Id on wrap', async () => {
      // First check in
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'standby',
          checkinId: 'checkin-to-wrap',
          checkinTtlSeconds: 120,
          sessionConfig: {
            raceSessionId: 'session-abc-123',
            name: 'Test Session',
            status: 'ACTIVE',
            simulator: 'iRacing',
            drivers: [],
            obsScenes: [],
          },
        }),
      }) as any;

      await orchestrator.checkinSession('session-abc-123');
      expect(orchestrator.getState().checkinId).toBe('checkin-to-wrap');

      // Mock successful wrap response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      }) as any;

      // Execute wrap
      await orchestrator.wrapSession('test-stop');

      // Verify DELETE request was made with X-Checkin-Id header
      expect(global.fetch).toHaveBeenCalledWith(
        'https://simracecenter.com/api/director/v1/sessions/session-abc-123/checkin',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-bearer-token',
            'X-Checkin-Id': 'checkin-to-wrap',
          }),
        })
      );

      // Verify state was reset
      const state = orchestrator.getState();
      expect(state.checkinStatus).toBe('unchecked');
      expect(state.checkinId).toBeNull();
      expect(state.sessionConfig).toBeNull();
    });

    it('should handle 404 on wrap as success (already expired)', async () => {
      // Check in first
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'standby',
          checkinId: 'checkin-expired',
          checkinTtlSeconds: 120,
          sessionConfig: {
            raceSessionId: 'session-abc-123',
            name: 'Test Session',
            status: 'ACTIVE',
            simulator: 'iRacing',
            drivers: [],
            obsScenes: [],
          },
        }),
      }) as any;

      await orchestrator.checkinSession('session-abc-123');

      // Mock 404 response (check-in already expired)
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }) as any;

      // Wrap should succeed even with 404
      await orchestrator.wrapSession();

      // Verify state was still reset
      const state = orchestrator.getState();
      expect(state.checkinStatus).toBe('unchecked');
      expect(state.checkinId).toBeNull();
    });
  });

  describe('AC5: Re-check-in fires on extension connect/disconnect', () => {
    beforeEach(() => {
      // Mock successful check-in response for all tests
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'standby',
          checkinId: 'checkin-123',
          checkinTtlSeconds: 120,
          sessionConfig: {
            raceSessionId: 'session-abc-123',
            name: 'Test Session',
            status: 'ACTIVE',
            simulator: 'iRacing',
            drivers: [],
            obsScenes: [],
          },
        }),
      }) as any;
    });

    it('should re-check-in when OBS connects', async () => {
      // Initial check-in
      await orchestrator.checkinSession('session-abc-123');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Emit OBS connection event
      mockEventBus.emit('obs.connectionStateChanged', {
        extensionId: 'director-obs',
        payload: { connected: true },
      });

      // Wait for async re-check-in
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have re-checked in
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should re-check-in when iRacing connects', async () => {
      await orchestrator.checkinSession('session-abc-123');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      mockEventBus.emit('iracing.connectionStateChanged', {
        extensionId: 'director-iracing',
        payload: { connected: true },
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should re-check-in when YouTube status changes', async () => {
      await orchestrator.checkinSession('session-abc-123');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      mockEventBus.emit('youtube.status', {
        extensionId: 'director-youtube',
        payload: { monitoring: true },
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should NOT re-check-in if not currently checked in', async () => {
      // No initial check-in

      // Emit connection event
      mockEventBus.emit('obs.connectionStateChanged', {
        extensionId: 'director-obs',
        payload: { connected: true },
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should not have called fetch
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle multiple rapid connection events gracefully', async () => {
      await orchestrator.checkinSession('session-abc-123');
      const initialCallCount = (global.fetch as any).mock.calls.length;

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

      // Should have re-checked in for each event
      expect((global.fetch as any).mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  describe('Integration: Complete Check-In Flow', () => {
    it('should complete full lifecycle: check-in → poll → wrap', async () => {
      // 1. Check in
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'standby',
          checkinId: 'full-lifecycle-checkin',
          checkinTtlSeconds: 120,
          sessionConfig: {
            raceSessionId: 'session-abc-123',
            name: 'Full Lifecycle Test',
            status: 'ACTIVE',
            simulator: 'iRacing',
            drivers: [],
            obsScenes: [],
          },
          warnings: ['Test warning'],
        }),
      }) as any;

      const checkinState = await orchestrator.checkinSession('session-abc-123');
      expect(checkinState.checkinStatus).toBe('standby');
      expect(checkinState.checkinId).toBe('full-lifecycle-checkin');
      expect(checkinState.checkinWarnings).toContain('Test warning');

      // 2. Verify CloudPoller would use the checkinId
      // (This is tested separately in AC3, just verify state is correct)
      expect(checkinState.checkinId).toBeTruthy();

      // 3. Wrap the session
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      }) as any;

      const wrapState = await orchestrator.wrapSession('test-complete');
      expect(wrapState.checkinStatus).toBe('unchecked');
      expect(wrapState.checkinId).toBeNull();
      expect(wrapState.sessionConfig).toBeNull();
      expect(wrapState.checkinWarnings).toEqual([]);
    });
  });
});
