/**
 * director-orchestrator.test.ts
 * Tests for DirectorOrchestrator mode FSM and coordination logic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DirectorOrchestrator } from './director-orchestrator';
import { AuthService } from './auth-service';
import { ExtensionHostService } from './extension-host/extension-host';
import { SessionManager } from './session-manager';
import { SequenceScheduler } from './sequence-scheduler';
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
    getOrCreateDirectorId: vi.fn(() => 'd_inst_test-uuid'),
  },
}));
vi.mock('./telemetry-service', () => ({
  telemetryService: {
    trackEvent: vi.fn(),
    trackException: vi.fn(),
    trackDependency: vi.fn(),
  },
}));

describe('DirectorOrchestrator', () => {
  let orchestrator: DirectorOrchestrator;
  let mockAuthService: any;
  let mockExtensionHost: any;
  let mockSessionManager: any;
  let mockScheduler: any;
  let mockEventBus: any;

  beforeEach(() => {
    // Create mock instances
    mockAuthService = {
      getAccessToken: vi.fn().mockResolvedValue('test-token'),
    };

    mockExtensionHost = {
      getCapabilityCatalog: vi.fn(() => ({
        getAllIntents: vi.fn(() => [
          { intent: { intent: 'test.intent' }, extensionId: 'test-ext', enabled: true },
        ]),
      })),
      getConnectionHealth: vi.fn(() => ({})),
    };

    mockSessionManager = Object.assign(new EventEmitter(), {
      getSelectedSession: vi.fn(() => null),
      selectSession: vi.fn(),
      clearSession: vi.fn(),
      getState: vi.fn(() => ({ state: 'none', sessions: [], selectedSession: null })),
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

  describe('Initialization', () => {
    it('should start in stopped mode', () => {
      const state = orchestrator.getState();
      expect(state.mode).toBe('stopped');
      expect(state.status).toBe('IDLE');
      expect(state.sessionId).toBeNull();
    });
  });

  describe('Mode Transitions', () => {
    it('should transition from stopped to manual when session selected', async () => {
      // Setup: Mock a selected session
      mockSessionManager.getSelectedSession.mockReturnValue({
        raceSessionId: 'session-1',
        name: 'Test Session',
      });

      // Trigger session state change
      mockSessionManager.emit('stateChanged', {
        state: 'selected',
        selectedSession: { raceSessionId: 'session-1', name: 'Test Session' },
      });

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 10));

      const state = orchestrator.getState();
      expect(state.mode).toBe('manual');
      expect(state.sessionId).toBe('session-1');
    });

    it('should transition from manual to auto via setMode', async () => {
      // Setup: Mock a selected session
      mockSessionManager.getSelectedSession.mockReturnValue({
        raceSessionId: 'session-1',
        name: 'Test Session',
      });

      // First, get to manual mode
      await orchestrator.setMode('manual');
      expect(orchestrator.getState().mode).toBe('manual');

      // Then transition to auto
      await orchestrator.setMode('auto');
      expect(orchestrator.getState().mode).toBe('auto');
    });

    it('should transition from auto to manual via setMode', async () => {
      // Setup: Mock a selected session
      mockSessionManager.getSelectedSession.mockReturnValue({
        raceSessionId: 'session-1',
        name: 'Test Session',
      });

      // Get to auto mode
      await orchestrator.setMode('auto');
      expect(orchestrator.getState().mode).toBe('auto');

      // Transition to manual
      await orchestrator.setMode('manual');
      expect(orchestrator.getState().mode).toBe('manual');
    });

    it('should transition to stopped when session cleared', async () => {
      // Setup: Start in manual mode with session
      mockSessionManager.getSelectedSession.mockReturnValue({
        raceSessionId: 'session-1',
        name: 'Test Session',
      });
      await orchestrator.setMode('manual');
      expect(orchestrator.getState().mode).toBe('manual');

      // Clear session
      mockSessionManager.getSelectedSession.mockReturnValue(null);
      mockSessionManager.emit('stateChanged', {
        state: 'none',
        selectedSession: null,
      });

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 10));

      const state = orchestrator.getState();
      expect(state.mode).toBe('stopped');
    });

    it('should not transition to manual/auto without selected session', async () => {
      mockSessionManager.getSelectedSession.mockReturnValue(null);

      const state = await orchestrator.setMode('manual');
      expect(state.mode).toBe('stopped');
      expect(state.lastError).toBe('No session selected');
    });

    it('should be idempotent when setting same mode', async () => {
      const state1 = await orchestrator.setMode('stopped');
      const state2 = await orchestrator.setMode('stopped');
      expect(state1.mode).toBe(state2.mode);
    });
  });

  describe('Sequence Handling', () => {
    it('should track current sequence from scheduler progress', () => {
      mockScheduler.emit('progress', {
        sequenceId: 'seq-1',
        sequenceName: 'Test Sequence',
        currentStep: 1,
        totalSteps: 3,
        stepIntent: 'system.wait',
        stepStatus: 'running',
        log: 'Waiting...',
      });

      const state = orchestrator.getState();
      expect(state.currentSequenceId).toBe('seq-1');
      expect(state.totalCommands).toBe(3);
      expect(state.processedCommands).toBe(1);
    });

    it('should reset sequence tracking on completion', () => {
      // First set a running sequence
      mockScheduler.emit('progress', {
        sequenceId: 'seq-1',
        sequenceName: 'Test Sequence',
        currentStep: 3,
        totalSteps: 3,
        stepIntent: 'system.wait',
        stepStatus: 'running',
        log: 'Waiting...',
      });

      expect(orchestrator.getState().currentSequenceId).toBe('seq-1');

      // Then emit end event
      mockScheduler.emit('progress', {
        sequenceId: 'seq-1',
        sequenceName: 'Test Sequence',
        currentStep: 3,
        totalSteps: 3,
        stepIntent: 'sequence.end',
        stepStatus: 'success',
        log: 'Completed',
      });

      const state = orchestrator.getState();
      expect(state.currentSequenceId).toBeNull();
      expect(state.totalCommands).toBe(0);
      expect(state.processedCommands).toBe(0);
    });
  });

  describe('Check-in and Wrap', () => {
    it('should track check-in status', () => {
      const state = orchestrator.getState();
      expect(state.checkinStatus).toBe('unchecked');
      expect(state.checkinId).toBeNull();
    });

    it('should handle check-in error when no auth token', async () => {
      mockAuthService.getAccessToken.mockResolvedValue(null);

      const state = await orchestrator.checkinSession('session-1');
      expect(state.checkinStatus).toBe('error');
      expect(state.lastError).toBe('No auth token available');
    });

    it('should handle wrap with no active check-in', async () => {
      const state = await orchestrator.wrapSession();
      expect(state.checkinStatus).toBe('unchecked');
    });
  });

  describe('State Change Events', () => {
    it('should emit stateChanged events', async () => {
      const listener = vi.fn();
      orchestrator.on('stateChanged', listener);

      mockSessionManager.getSelectedSession.mockReturnValue({
        raceSessionId: 'session-1',
        name: 'Test Session',
      });

      await orchestrator.setMode('manual');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'manual',
          sessionId: 'session-1',
        })
      );
    });
  });

  describe('Manual Sequence Execution', () => {
    it('should allow manual execution by sequence ID', async () => {
      // Mock fetch for sequence retrieval
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'seq-1',
          steps: [{ id: 'step-1', intent: 'system.wait', payload: { durationMs: 1000 } }],
        }),
      }) as any;

      await orchestrator.executeSequenceById('seq-1');

      expect(mockScheduler.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'seq-1' }),
        {},
        { source: 'manual' }
      );
    });

    it('should handle fetch errors gracefully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }) as any;

      // Should not throw
      await expect(orchestrator.executeSequenceById('seq-1')).resolves.toBeUndefined();
    });

    it('should handle missing auth token', async () => {
      mockAuthService.getAccessToken.mockResolvedValue(null);

      // Should not throw
      await expect(orchestrator.executeSequenceById('seq-1')).resolves.toBeUndefined();
    });
  });

  describe('Active Intents', () => {
    it('should return built-in intents plus active extension intents', () => {
      // Access private method via type assertion
      const intents = (orchestrator as any).getActiveIntents();
      expect(intents).toContain('system.wait');
      expect(intents).toContain('system.log');
      expect(intents).toContain('test.intent');
    });

    it('should return only built-in intents on catalog error', () => {
      mockExtensionHost.getCapabilityCatalog.mockImplementation(() => {
        throw new Error('Catalog error');
      });

      const intents = (orchestrator as any).getActiveIntents();
      expect(intents).toEqual(['system.wait', 'system.log']);
    });
  });

  describe('Re-check-in on Extension Events', () => {
    beforeEach(() => {
      // Mock fetch for check-in calls
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          checkinId: 'checkin-123',
          checkinTtlSeconds: 120,
          sessionConfig: {
            raceSessionId: 'session-1',
            name: 'Test Session',
            status: 'ACTIVE',
            simulator: 'iRacing',
            drivers: [],
            obsScenes: [],
          },
          warnings: [],
        }),
      }) as any;
    });

    it('should re-check-in when extension connects after initial check-in', async () => {
      // First check in
      await orchestrator.checkinSession('session-1');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Simulate OBS connection event
      mockEventBus.emit('obs.connectionStateChanged', {
        extensionId: 'director-obs',
        payload: { connected: true },
      });

      // Wait for async re-check-in
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should have called fetch again for re-check-in
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should not re-check-in if not currently checked in', async () => {
      // Simulate connection event without being checked in
      mockEventBus.emit('obs.connectionStateChanged', {
        extensionId: 'director-obs',
        payload: { connected: true },
      });

      // Wait for potential async operations
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should not have called fetch
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle re-check-in failure gracefully', async () => {
      // First check in successfully
      await orchestrator.checkinSession('session-1');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Mock fetch to fail on re-check-in
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      }) as any;

      // Simulate connection event
      mockEventBus.emit('iracing.connectionStateChanged', {
        extensionId: 'director-iracing',
        payload: { connected: true },
      });

      // Wait for async re-check-in
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should have attempted re-check-in without throwing
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
