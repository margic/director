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
      getObsScenes: vi.fn(() => []),
      getCameraGroups: vi.fn(() => []),
      getDrivers: vi.fn(() => []),
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
      getCapabilities: vi.fn(() => ({ extensions: [], connections: {} })),
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

      // Should have called SessionManager.checkinSession (full POST — re-triggers Planner)
      expect(mockSessionManager.checkinSession).toHaveBeenCalled();
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

      // Mock checkinSession to fail
      mockSessionManager.checkinSession.mockRejectedValue(new Error('Network error'));

      // Simulate connection event
      mockEventBus.emit('iracing.connectionStateChanged', {
        extensionId: 'director-iracing',
        payload: { connected: true },
      });

      // Wait for async operations — should not throw
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockSessionManager.checkinSession).toHaveBeenCalled();
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

      expect(mockSessionManager.checkinSession).toHaveBeenCalled();
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

      expect(mockSessionManager.checkinSession).toHaveBeenCalled();
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

  describe('getRaceContext - class-aware battles (#150)', () => {
    /** Helper: emit a raceStateChanged event with the given cars list. */
    function emitRaceState(cars: any[]) {
      mockEventBus.emit('iracing.raceStateChanged', {
        payload: {
          sessionFlags: 0,
          sessionType: 'Race',
          totalSessionLaps: 50,
          sessionLapsRemain: 25,
          cars,
        },
      });
    }

    it('does not pair a GT3 with the LMP2 directly ahead in mixed-class field', () => {
      // 6 cars by overall position: LMP2 leads, then a GT3 0.5s back, then more.
      // Same-class adjacency tests: GT3-GT3 close, LMP2-LMP2 close.
      const cars = [
        // overall pos 1: LMP2 #1 (leader, no gap)
        { carNumber: '1',  carClass: 'LMP2', classPosition: 1, position: 1, gapToCarAhead: 0,   lapsCompleted: 10 },
        // overall pos 2: GT3 #10, 0.5s behind LMP2 #1 — must NOT be a battle
        { carNumber: '10', carClass: 'GT3',  classPosition: 1, position: 2, gapToCarAhead: 0.5, lapsCompleted: 10 },
        // overall pos 3: LMP2 #2, 1.0s behind GT3 #10 (=> 1.5s behind LMP2 #1)
        { carNumber: '2',  carClass: 'LMP2', classPosition: 2, position: 3, gapToCarAhead: 1.0, lapsCompleted: 10 },
        // overall pos 4: GT3 #11, 0.4s behind LMP2 #2 (=> 1.4s gap to GT3 #10) — NOT a battle
        { carNumber: '11', carClass: 'GT3',  classPosition: 2, position: 4, gapToCarAhead: 0.4, lapsCompleted: 10 },
        // overall pos 5: GT3 #12, 0.3s behind GT3 #11 — IS a same-class battle
        { carNumber: '12', carClass: 'GT3',  classPosition: 3, position: 5, gapToCarAhead: 0.3, lapsCompleted: 10 },
        // overall pos 6: LMP2 #3, 4.0s back — no battles
        { carNumber: '3',  carClass: 'LMP2', classPosition: 3, position: 6, gapToCarAhead: 4.0, lapsCompleted: 10 },
      ];
      emitRaceState(cars);

      const ctx = (orchestrator as any).getRaceContext();

      expect(ctx.battles).toBeDefined();
      // Only the GT3 #11 vs GT3 #12 pair (gap 0.3) qualifies.
      expect(ctx.battles).toHaveLength(1);
      expect(ctx.battles[0]).toEqual({ cars: ['11', '12'], gapSec: 0.3 });
    });

    it('detects multiple same-class battles in different classes', () => {
      const cars = [
        { carNumber: '1',  carClass: 'LMP2', classPosition: 1, position: 1, gapToCarAhead: 0,   lapsCompleted: 10 },
        { carNumber: '2',  carClass: 'LMP2', classPosition: 2, position: 2, gapToCarAhead: 0.6, lapsCompleted: 10 }, // LMP2 battle
        { carNumber: '10', carClass: 'GT3',  classPosition: 1, position: 3, gapToCarAhead: 5.0, lapsCompleted: 10 },
        { carNumber: '11', carClass: 'GT3',  classPosition: 2, position: 4, gapToCarAhead: 0.8, lapsCompleted: 10 }, // GT3 battle
      ];
      emitRaceState(cars);

      const ctx = (orchestrator as any).getRaceContext();

      expect(ctx.battles).toHaveLength(2);
      expect(ctx.battles).toContainEqual({ cars: ['1', '2'], gapSec: 0.6 });
      expect(ctx.battles).toContainEqual({ cars: ['10', '11'], gapSec: 0.8 });
    });

    it('sums the gap across other-class cars between two same-class cars', () => {
      // LMP2 #1, GT3 #10 (0.4s back), LMP2 #2 (0.4s back) → LMP2#1↔LMP2#2 gap = 0.8s, IS battle
      const cars = [
        { carNumber: '1',  carClass: 'LMP2', classPosition: 1, position: 1, gapToCarAhead: 0,   lapsCompleted: 10 },
        { carNumber: '10', carClass: 'GT3',  classPosition: 1, position: 2, gapToCarAhead: 0.4, lapsCompleted: 10 },
        { carNumber: '2',  carClass: 'LMP2', classPosition: 2, position: 3, gapToCarAhead: 0.4, lapsCompleted: 10 },
      ];
      emitRaceState(cars);

      const ctx = (orchestrator as any).getRaceContext();
      expect(ctx.battles).toEqual([{ cars: ['1', '2'], gapSec: 0.8 }]);
    });

    it('returns no battles when same-class gap is >= 1.0s', () => {
      const cars = [
        { carNumber: '1',  carClass: 'LMP2', classPosition: 1, position: 1, gapToCarAhead: 0,   lapsCompleted: 10 },
        { carNumber: '2',  carClass: 'LMP2', classPosition: 2, position: 2, gapToCarAhead: 1.5, lapsCompleted: 10 },
      ];
      emitRaceState(cars);

      const ctx = (orchestrator as any).getRaceContext();
      expect(ctx.battles).toBeUndefined();
    });
  });

  describe('Re-check-in on SESSION_TYPE_CHANGE (#206)', () => {
    it('should refresh check-in when iRacing sessionType changes (e.g. Practice → Race)', async () => {
      mockSessionManager.getCheckinId.mockReturnValue('checkin-123');

      // Emit first raceStateChanged to establish the baseline sessionType
      mockEventBus.emit('iracing.raceStateChanged', {
        payload: { sessionFlags: 0, sessionType: 'Practice', cars: [] },
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockSessionManager.refreshCheckin).not.toHaveBeenCalled();

      // Now emit with a different sessionType — should trigger re-check-in
      mockEventBus.emit('iracing.raceStateChanged', {
        payload: { sessionFlags: 0, sessionType: 'Race', cars: [] },
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockSessionManager.refreshCheckin).toHaveBeenCalledTimes(1);
    });

    it('should NOT refresh check-in when sessionType stays the same', async () => {
      mockSessionManager.getCheckinId.mockReturnValue('checkin-123');

      mockEventBus.emit('iracing.raceStateChanged', {
        payload: { sessionFlags: 0, sessionType: 'Race', cars: [] },
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      mockEventBus.emit('iracing.raceStateChanged', {
        payload: { sessionFlags: 0, sessionType: 'Race', cars: [] },
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockSessionManager.refreshCheckin).not.toHaveBeenCalled();
    });

    it('should NOT refresh check-in on first raceStateChanged (no prior sessionType)', async () => {
      mockSessionManager.getCheckinId.mockReturnValue('checkin-123');

      // First emission — lastKnownSessionType is '' so no change detected
      mockEventBus.emit('iracing.raceStateChanged', {
        payload: { sessionFlags: 0, sessionType: 'Race', cars: [] },
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockSessionManager.refreshCheckin).not.toHaveBeenCalled();
    });

    it('should NOT refresh check-in when there is no active check-in', async () => {
      mockSessionManager.getCheckinId.mockReturnValue(null);

      mockEventBus.emit('iracing.raceStateChanged', {
        payload: { sessionFlags: 0, sessionType: 'Practice', cars: [] },
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      mockEventBus.emit('iracing.raceStateChanged', {
        payload: { sessionFlags: 0, sessionType: 'Race', cars: [] },
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockSessionManager.refreshCheckin).not.toHaveBeenCalled();
    });

    it('should handle re-check-in failure gracefully on session type change', async () => {
      mockSessionManager.getCheckinId.mockReturnValue('checkin-123');
      mockSessionManager.refreshCheckin.mockRejectedValue(new Error('Network error'));

      mockEventBus.emit('iracing.raceStateChanged', {
        payload: { sessionFlags: 0, sessionType: 'Practice', cars: [] },
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      mockEventBus.emit('iracing.raceStateChanged', {
        payload: { sessionFlags: 0, sessionType: 'Race', cars: [] },
      });
      // Should not throw
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(mockSessionManager.refreshCheckin).toHaveBeenCalledTimes(1);
    });
  });
});
