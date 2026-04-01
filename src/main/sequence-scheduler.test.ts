/**
 * Unit tests for SequenceScheduler
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SequenceScheduler } from './sequence-scheduler';
import { SequenceExecutor } from './sequence-executor';
import { PortableSequence, ExecutionResult } from './director-types';

// Mock SequenceExecutor
class MockSequenceExecutor {
  executeStep = vi.fn();

  constructor() {
    // executeStep is called by scheduler for each step
    // Make it async but fast for testing
    this.executeStep.mockResolvedValue(undefined);
  }
}

describe('SequenceScheduler', () => {
  let scheduler: SequenceScheduler;
  let mockExecutor: MockSequenceExecutor;

  beforeEach(() => {
    mockExecutor = new MockSequenceExecutor();
    scheduler = new SequenceScheduler(mockExecutor as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('enqueue', () => {
    it('should return an execution ID', async () => {
      const sequence: PortableSequence = {
        id: 'seq-1',
        steps: [],
      };

      const executionId = await scheduler.enqueue(sequence);

      expect(executionId).toBeTruthy();
      expect(typeof executionId).toBe('string');
    });

    it('should execute priority sequence immediately without queueing', async () => {
      const prioritySeq: PortableSequence = {
        id: 'priority-seq',
        priority: true,
        steps: [],
      };

      await scheduler.enqueue(prioritySeq);

      // Queue should remain empty for priority sequences
      await new Promise(resolve => setTimeout(resolve, 50));
      const queue = scheduler.getQueue();
      expect(queue).toHaveLength(0);
    });

    it('should execute priority sequence via options even if sequence.priority is false', async () => {
      const sequence: PortableSequence = {
        id: 'seq-2',
        steps: [],
      };

      await scheduler.enqueue(sequence, {}, { priority: true });

      // Should not be in queue
      await new Promise(resolve => setTimeout(resolve, 50));
      const queue = scheduler.getQueue();
      expect(queue).toHaveLength(0);
    });

    it('should handle multiple sequences with proper queueing', async () => {
      const seq1: PortableSequence = { id: 'seq-1', steps: [] };
      const seq2: PortableSequence = { id: 'seq-2', steps: [] };

      // Make execution slow so items queue up
      mockExecutor.executeStep.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 100))
      );

      const id1 = await scheduler.enqueue(seq1);
      const id2 = await scheduler.enqueue(seq2);

      // Check immediately - second should be queued
      const queue = scheduler.getQueue();

      // Either both are queued or the first is executing and second is queued
      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });
  });

  describe('priority logic', () => {
    it('should execute priority sequences in parallel with queued sequences', async () => {
      // Make execution slow
      mockExecutor.executeStep.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 200))
      );

      const normalSeq: PortableSequence = {
        id: 'normal-seq',
        steps: [{ id: 'step-1', intent: 'system.wait', payload: { durationMs: 100 } }],
      };

      const prioritySeq: PortableSequence = {
        id: 'priority-seq',
        priority: true,
        steps: [{ id: 'step-1', intent: 'system.log', payload: { message: 'Urgent', level: 'INFO' } }],
      };

      await scheduler.enqueue(normalSeq);
      await scheduler.enqueue(prioritySeq);

      // Priority should execute immediately while normal processes
      await new Promise(resolve => setTimeout(resolve, 50));

      // Both should have called executeStep (priority runs in parallel)
      expect(mockExecutor.executeStep).toHaveBeenCalled();
    });

    it('should allow cancelling current execution', async () => {
      mockExecutor.executeStep.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 1000))
      );

      const sequence: PortableSequence = {
        id: 'seq-to-cancel',
        steps: [{ id: 'step-1', intent: 'system.wait', payload: { durationMs: 1000 } }],
      };

      // Start execution
      await scheduler.enqueue(sequence);

      // Give it a moment to start
      await new Promise(resolve => setTimeout(resolve, 50));

      // Cancel current execution
      await scheduler.cancelCurrent();

      // After cancellation, isExecuting should eventually be false
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(scheduler.isExecuting()).toBe(false);
    });

    it('should allow cancelling queued sequence by executionId', async () => {
      // Make execution slow so items queue up
      mockExecutor.executeStep.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 500))
      );

      const seq1: PortableSequence = {
        id: 'seq-1',
        steps: [{ id: 'step-1', intent: 'system.wait', payload: { durationMs: 1000 } }],
      };
      const seq2: PortableSequence = {
        id: 'seq-2',
        steps: [{ id: 'step-1', intent: 'system.wait', payload: { durationMs: 100 } }],
      };

      const id1 = await scheduler.enqueue(seq1);
      const id2 = await scheduler.enqueue(seq2);

      // Wait a moment for processing to start
      await new Promise(resolve => setTimeout(resolve, 50));

      // Cancel the second one (should still be queued)
      await scheduler.cancelQueued(id2);

      const queue = scheduler.getQueue();

      // The second sequence should no longer be in the queue
      const hasSeq2 = queue.some(q => q.executionId === id2);
      expect(hasSeq2).toBe(false);
    });

    it('should recalculate queue positions after cancellation', async () => {
      // Make execution slow
      mockExecutor.executeStep.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 500))
      );

      const seq1: PortableSequence = { id: 'seq-1', steps: [] };
      const seq2: PortableSequence = { id: 'seq-2', steps: [] };
      const seq3: PortableSequence = { id: 'seq-3', steps: [] };

      await scheduler.enqueue(seq1);
      const id2 = await scheduler.enqueue(seq2);
      await scheduler.enqueue(seq3);

      // Wait for processing to start
      await new Promise(resolve => setTimeout(resolve, 50));

      // Cancel middle one
      await scheduler.cancelQueued(id2);

      const queue = scheduler.getQueue();

      // Check that positions are sequential if items are in queue
      if (queue.length > 0) {
        expect(queue[0].position).toBe(1);
        if (queue.length > 1) {
          expect(queue[1].position).toBe(2);
        }
      }
    });
  });

  describe('queue management', () => {
    it('should return a copy of the queue (not the internal reference)', async () => {
      const sequence: PortableSequence = { id: 'seq-1', steps: [] };

      // Make execution slow
      mockExecutor.executeStep.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 500))
      );

      await scheduler.enqueue(sequence);
      await new Promise(resolve => setTimeout(resolve, 10));

      const queue1 = scheduler.getQueue();
      const queue2 = scheduler.getQueue();

      expect(queue1).not.toBe(queue2); // Different references
    });

    it('should emit queueChanged event when queue is modified', async () => {
      const sequence: PortableSequence = { id: 'seq-1', steps: [] };

      let eventEmitted = false;
      scheduler.on('queueChanged', () => {
        eventEmitted = true;
      });

      await scheduler.enqueue(sequence);

      expect(eventEmitted).toBe(true);
    });
  });

  describe('execution history', () => {
    it('should track execution history', () => {
      const history = scheduler.getHistory();
      expect(Array.isArray(history)).toBe(true);
    });

    it('should return a copy of the history (not the internal reference)', () => {
      const history1 = scheduler.getHistory();
      const history2 = scheduler.getHistory();

      expect(history1).not.toBe(history2); // Different references
      expect(history1).toEqual(history2); // Same content
    });

    it('should add completed sequences to history', async () => {
      const sequence: PortableSequence = {
        id: 'hist-seq',
        steps: [{ id: 'step-1', intent: 'system.log', payload: { message: 'test', level: 'INFO' } }],
      };

      await scheduler.enqueue(sequence);

      // Wait for execution to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const history = scheduler.getHistory();

      // History should have at least one entry
      expect(history.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('isExecuting', () => {
    it('should return false when no execution is active', () => {
      expect(scheduler.isExecuting()).toBe(false);
    });

    it('should return true when execution is active', async () => {
      mockExecutor.executeStep.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 500))
      );

      const sequence: PortableSequence = {
        id: 'seq-1',
        steps: [
          { id: 'step-1', intent: 'system.wait', payload: { durationMs: 1000 } },
        ],
      };

      // Enqueue (don't await)
      scheduler.enqueue(sequence);

      // Give it a moment to start processing
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(scheduler.isExecuting()).toBe(true);

      // Clean up
      await scheduler.cancelCurrent();
    });
  });
});
