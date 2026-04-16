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
    get: vi.fn(() => ({ defaultMode: 'stopped' })),
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
      clearSession: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn(() => ({
        state: 'none',
        sessions: [],
        selectedSession: null,
        checkinStatus: 'unchecked',
        checkinId: null,
        sessionConfig: null,
        checkinWarnings: [],
        checkinTtlSeconds: 120,
      })),
      getSessions: vi.fn(() => []),
      discover: vi.fn(),
      checkinSession: vi.fn().mockResolvedValue({}),
      wrapSession: vi.fn().mockResolvedValue({}),
      refreshCheckin: vi.fn().mockResolvedValue({}),
      getCheckinId: vi.fn(() => null),
      getCheckinTtlSeconds: vi.fn(() => 120),
      getSessionConfig: vi.fn(() => null),
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

    it('should transition from manual to auto via setMode when checked in', async () => {
      // Setup: Mock a selected session and active check-in
      mockSessionManager.getSelectedSession.mockReturnValue({
        raceSessionId: 'session-1',
        name: 'Test Session',
      });
      mockSessionManager.getState.mockReturnValue({
        state: 'checked-in',
        sessions: [],
        selectedSession: { raceSessionId: 'session-1', name: 'Test Session' },
        checkinStatus: 'standby',
        checkinId: 'checkin-123',
        sessionConfig: null,
        checkinWarnings: [],
        checkinTtlSeconds: 120,
      });
      mockSessionManager.getCheckinId.mockReturnValue('checkin-123');

      // First, get to manual mode
      await orchestrator.setMode('manual');
      expect(orchestrator.getState().mode).toBe('manual');

      // Then transition to auto
      await orchestrator.setMode('auto');
      expect(orchestrator.getState().mode).toBe('auto');
    });

    it('should not transition to auto without active check-in', async () => {
      // Setup: Mock a selected session but NO check-in
      mockSessionManager.getSelectedSession.mockReturnValue({
        raceSessionId: 'session-1',
        name: 'Test Session',
      });

      const state = await orchestrator.setMode('auto');
      expect(state.mode).toBe('stopped');
      expect(state.lastError).toBe('Session not checked in');
    });

    it('should transition from auto to manual via setMode', async () => {
      // Setup: Mock a selected session and active check-in
      mockSessionManager.getSelectedSession.mockReturnValue({
        raceSessionId: 'session-1',
        name: 'Test Session',
      });
      mockSessionManager.getState.mockReturnValue({
        state: 'checked-in',
        sessions: [],
        selectedSession: { raceSessionId: 'session-1', name: 'Test Session' },
        checkinStatus: 'standby',
        checkinId: 'checkin-123',
        sessionConfig: null,
        checkinWarnings: [],
        checkinTtlSeconds: 120,
      });
      mockSessionManager.getCheckinId.mockReturnValue('checkin-123');

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
    it('should track check-in status from SessionManager', () => {
      const state = orchestrator.getState();
      expect(state.checkinStatus).toBe('unchecked');
      expect(state.checkinId).toBeNull();
    });

    it('should delegate check-in to SessionManager', async () => {
      const state = await orchestrator.checkinSession('session-1');
      expect(mockSessionManager.checkinSession).toHaveBeenCalled();
    });

    it('should delegate wrap to SessionManager', async () => {
      const state = await orchestrator.wrapSession();
      expect(mockSessionManager.wrapSession).toHaveBeenCalled();
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
    it('should refresh check-in via SessionManager when extension connects after initial check-in', async () => {
      // Set SessionManager to appear checked-in
      mockSessionManager.getState.mockReturnValue({
        state: 'checked-in',
        sessions: [],
        selectedSession: { raceSessionId: 'session-1', name: 'Test Session' },
        checkinStatus: 'standby',
        checkinId: 'checkin-123',
        sessionConfig: null,
        checkinWarnings: [],
        checkinTtlSeconds: 120,
      });

      // Simulate OBS connection event
      mockEventBus.emit('obs.connectionStateChanged', {
        extensionId: 'director-obs',
        payload: { connected: true },
      });

      // Wait for async refresh
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should have called SessionManager.refreshCheckin
      expect(mockSessionManager.refreshCheckin).toHaveBeenCalled();
    });

    it('should not refresh check-in if not currently checked in', async () => {
      // SessionManager is in default unchecked state

      // Simulate connection event without being checked in
      mockEventBus.emit('obs.connectionStateChanged', {
        extensionId: 'director-obs',
        payload: { connected: true },
      });

      // Wait for potential async operations
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should not have called refreshCheckin
      expect(mockSessionManager.refreshCheckin).not.toHaveBeenCalled();
    });

    it('should handle refresh failure gracefully', async () => {
      // Set SessionManager to appear checked-in
      mockSessionManager.getState.mockReturnValue({
        state: 'checked-in',
        sessions: [],
        selectedSession: { raceSessionId: 'session-1', name: 'Test Session' },
        checkinStatus: 'standby',
        checkinId: 'checkin-123',
        sessionConfig: null,
        checkinWarnings: [],
        checkinTtlSeconds: 120,
      });

      // Mock refreshCheckin to fail
      mockSessionManager.refreshCheckin.mockRejectedValue(new Error('Network error'));

      // Simulate connection event
      mockEventBus.emit('iracing.connectionStateChanged', {
        extensionId: 'director-iracing',
        payload: { connected: true },
      });

      // Wait for async operations — should not throw
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockSessionManager.refreshCheckin).toHaveBeenCalled();
    });

    it('should refresh check-in when extension capabilities change', async () => {
      // Set SessionManager to appear checked-in
      mockSessionManager.getState.mockReturnValue({
        state: 'checked-in',
        sessions: [],
        selectedSession: { raceSessionId: 'session-1', name: 'Test Session' },
        checkinStatus: 'standby',
        checkinId: 'checkin-123',
        sessionConfig: null,
        checkinWarnings: [],
        checkinTtlSeconds: 120,
      });

      // Simulate extension enabled
      mockEventBus.emit('extension.capabilitiesChanged', {
        extensionId: 'director-obs',
        payload: { extensionId: 'director-obs', enabled: true },
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockSessionManager.refreshCheckin).toHaveBeenCalled();
    });

    it('should refresh check-in when extension is disabled', async () => {
      mockSessionManager.getState.mockReturnValue({
        state: 'checked-in',
        sessions: [],
        selectedSession: { raceSessionId: 'session-1', name: 'Test Session' },
        checkinStatus: 'standby',
        checkinId: 'checkin-123',
        sessionConfig: null,
        checkinWarnings: [],
        checkinTtlSeconds: 120,
      });

      // Simulate extension disabled
      mockEventBus.emit('extension.capabilitiesChanged', {
        extensionId: 'director-iracing',
        payload: { extensionId: 'director-iracing', enabled: false },
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockSessionManager.refreshCheckin).toHaveBeenCalled();
    });

    it('should not refresh on capability change if not checked in', async () => {
      // Default unchecked state

      mockEventBus.emit('extension.capabilitiesChanged', {
        extensionId: 'director-obs',
        payload: { extensionId: 'director-obs', enabled: true },
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockSessionManager.refreshCheckin).not.toHaveBeenCalled();
    });
  });
});
