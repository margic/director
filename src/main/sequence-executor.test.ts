/**
 * Unit tests for SequenceExecutor
 *
 * Tests the built-in intent handlers:
 * - system.wait, system.log
 * - system.executeSequence (nested execution)
 * - overlay.show, overlay.hide
 * - Extension intent dispatch and soft failure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SequenceExecutor } from './sequence-executor';
import { PortableSequence, SequenceStep } from './director-types';

// Mock ExtensionHostService
class MockExtensionHost {
  hasActiveHandler = vi.fn().mockReturnValue(false);
  executeIntent = vi.fn().mockResolvedValue(undefined);
}

// Mock OverlayBus
class MockOverlayBus {
  showOverlay = vi.fn();
  hideOverlay = vi.fn();
}

// Mock SequenceLibrary
class MockSequenceLibrary {
  getSequence = vi.fn().mockResolvedValue(null);
}

describe('SequenceExecutor', () => {
  let executor: SequenceExecutor;
  let mockHost: MockExtensionHost;
  let mockOverlayBus: MockOverlayBus;
  let mockLibrary: MockSequenceLibrary;

  beforeEach(() => {
    mockHost = new MockExtensionHost();
    mockOverlayBus = new MockOverlayBus();
    mockLibrary = new MockSequenceLibrary();
    executor = new SequenceExecutor(mockHost as any, mockOverlayBus as any);
    executor.setSequenceLibrary(mockLibrary as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('system.wait', () => {
    it('should wait for the specified duration', async () => {
      vi.useFakeTimers();
      const step: SequenceStep = {
        id: 's1',
        intent: 'system.wait',
        payload: { durationMs: 500 },
      };

      const promise = executor.executeStep(step);
      vi.advanceTimersByTime(500);
      await promise;

      // No extension call should be made
      expect(mockHost.executeIntent).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('should skip wait if durationMs is 0', async () => {
      const step: SequenceStep = {
        id: 's1',
        intent: 'system.wait',
        payload: { durationMs: 0 },
      };

      await executor.executeStep(step);
      expect(mockHost.executeIntent).not.toHaveBeenCalled();
    });
  });

  describe('system.log', () => {
    it('should log message at INFO level by default', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const step: SequenceStep = {
        id: 's1',
        intent: 'system.log',
        payload: { message: 'Test message' },
      };

      await executor.executeStep(step);

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Test message'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO]'));
    });

    it('should log message at ERROR level', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const step: SequenceStep = {
        id: 's1',
        intent: 'system.log',
        payload: { message: 'Error occurred', level: 'ERROR' },
      };

      await executor.executeStep(step);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error occurred'));
    });
  });

  describe('system.executeSequence', () => {
    it('should execute a nested sequence from the library', async () => {
      const nestedSeq: PortableSequence = {
        id: 'nested-1',
        steps: [
          { id: 'n1', intent: 'system.log', payload: { message: 'nested', level: 'INFO' } },
        ],
      };
      mockLibrary.getSequence.mockResolvedValue(nestedSeq);
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const step: SequenceStep = {
        id: 's1',
        intent: 'system.executeSequence',
        payload: { sequenceId: 'nested-1' },
      };

      await executor.executeStep(step);

      expect(mockLibrary.getSequence).toHaveBeenCalledWith('nested-1');
    });

    it('should skip if sequenceId is missing', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const step: SequenceStep = {
        id: 's1',
        intent: 'system.executeSequence',
        payload: {},
      };

      await executor.executeStep(step);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing sequenceId'));
      expect(mockLibrary.getSequence).not.toHaveBeenCalled();
    });

    it('should skip if sequence is not found', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockLibrary.getSequence.mockResolvedValue(null);

      const step: SequenceStep = {
        id: 's1',
        intent: 'system.executeSequence',
        payload: { sequenceId: 'nonexistent' },
      };

      await executor.executeStep(step);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("'nonexistent' not found"));
    });

    it('should skip if no sequence library is configured', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const executorNoLib = new SequenceExecutor(mockHost as any);

      const step: SequenceStep = {
        id: 's1',
        intent: 'system.executeSequence',
        payload: { sequenceId: 'some-seq' },
      };

      await executorNoLib.executeStep(step);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no sequence library configured'));
    });
  });

  describe('overlay.show', () => {
    it('should call showOverlay on OverlayBus', async () => {
      const step: SequenceStep = {
        id: 's1',
        intent: 'overlay.show',
        payload: { extensionId: 'iracing', overlayId: 'standings' },
      };

      await executor.executeStep(step);

      expect(mockOverlayBus.showOverlay).toHaveBeenCalledWith('iracing', 'standings');
    });

    it('should skip if extensionId or overlayId is missing', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const step: SequenceStep = {
        id: 's1',
        intent: 'overlay.show',
        payload: { extensionId: 'iracing' },
      };

      await executor.executeStep(step);

      expect(mockOverlayBus.showOverlay).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing extensionId or overlayId'));
    });

    it('should skip if no OverlayBus is configured', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const executorNoBus = new SequenceExecutor(mockHost as any);

      const step: SequenceStep = {
        id: 's1',
        intent: 'overlay.show',
        payload: { extensionId: 'iracing', overlayId: 'standings' },
      };

      await executorNoBus.executeStep(step);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no OverlayBus configured'));
    });
  });

  describe('overlay.hide', () => {
    it('should call hideOverlay on OverlayBus', async () => {
      const step: SequenceStep = {
        id: 's1',
        intent: 'overlay.hide',
        payload: { extensionId: 'iracing', overlayId: 'standings' },
      };

      await executor.executeStep(step);

      expect(mockOverlayBus.hideOverlay).toHaveBeenCalledWith('iracing', 'standings');
    });

    it('should skip if extensionId or overlayId is missing', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const step: SequenceStep = {
        id: 's1',
        intent: 'overlay.hide',
        payload: { overlayId: 'standings' },
      };

      await executor.executeStep(step);

      expect(mockOverlayBus.hideOverlay).not.toHaveBeenCalled();
    });
  });

  describe('Extension intents', () => {
    it('should dispatch to extension host when handler is active', async () => {
      mockHost.hasActiveHandler.mockReturnValue(true);
      const step: SequenceStep = {
        id: 's1',
        intent: 'broadcast.showLiveCam',
        payload: { carNum: '42', camGroup: 1 },
      };

      await executor.executeStep(step);

      expect(mockHost.executeIntent).toHaveBeenCalledWith('broadcast.showLiveCam', { carNum: '42', camGroup: 1 });
    });

    it('should soft-fail when no handler is active', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockHost.hasActiveHandler.mockReturnValue(false);
      const step: SequenceStep = {
        id: 's1',
        intent: 'broadcast.showLiveCam',
        payload: { carNum: '42', camGroup: 1 },
      };

      await executor.executeStep(step);

      expect(mockHost.executeIntent).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No active handler'));
    });
  });

  describe('execute (full sequence)', () => {
    it('should execute all steps in order and report progress', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const progressFn = vi.fn();
      const seq: PortableSequence = {
        id: 'full-seq',
        steps: [
          { id: 's1', intent: 'system.log', payload: { message: 'A', level: 'INFO' } },
          { id: 's2', intent: 'system.log', payload: { message: 'B', level: 'INFO' } },
        ],
      };

      await executor.execute(seq, progressFn);

      expect(progressFn).toHaveBeenCalledWith(0, 2);
      expect(progressFn).toHaveBeenCalledWith(1, 2);
      expect(progressFn).toHaveBeenCalledWith(2, 2);
    });

    it('should continue on error (soft failure)', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockHost.hasActiveHandler.mockReturnValue(true);
      mockHost.executeIntent.mockRejectedValueOnce(new Error('boom'));

      const seq: PortableSequence = {
        id: 'error-seq',
        steps: [
          { id: 's1', intent: 'broadcast.showLiveCam', payload: { carNum: '1', camGroup: 1 } },
          { id: 's2', intent: 'system.log', payload: { message: 'after error', level: 'INFO' } },
        ],
      };

      await executor.execute(seq);

      // Both steps should have been attempted
      expect(mockHost.executeIntent).toHaveBeenCalledTimes(1);
    });
  });
});
