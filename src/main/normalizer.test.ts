/**
 * Unit tests for normalizer
 */
import { describe, it, expect } from 'vitest';
import { normalizeApiResponse } from './normalizer';
import { PortableSequence } from './director-types';

describe('normalizeApiResponse', () => {
  describe('New API format (PortableSequence with steps)', () => {
    it('should handle new format with steps directly', () => {
      const apiData = {
        id: 'seq-new-1',
        name: 'Test Sequence',
        version: '1.0',
        description: 'A test sequence',
        category: 'test',
        priority: true,
        variables: [],
        steps: [
          {
            id: 'step-1',
            intent: 'system.wait',
            payload: { durationMs: 1000 },
          },
          {
            id: 'step-2',
            intent: 'system.log',
            payload: { message: 'Hello', level: 'INFO' },
          },
        ],
        metadata: {
          author: 'test-user',
        },
      };

      const result = normalizeApiResponse(apiData);

      expect(result).toEqual({
        id: 'seq-new-1',
        name: 'Test Sequence',
        version: '1.0',
        description: 'A test sequence',
        category: 'test',
        priority: true,
        variables: [],
        steps: [
          {
            id: 'step-1',
            intent: 'system.wait',
            payload: { durationMs: 1000 },
          },
          {
            id: 'step-2',
            intent: 'system.log',
            payload: { message: 'Hello', level: 'INFO' },
          },
        ],
        metadata: {
          author: 'test-user',
        },
      });
    });

    it('should generate step IDs when missing in new format', () => {
      const apiData = {
        steps: [
          {
            intent: 'system.wait',
            payload: { durationMs: 1000 },
          },
        ],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.steps[0].id).toBeTruthy();
      expect(typeof result.steps[0].id).toBe('string');
    });

    it('should handle missing payload in new format', () => {
      const apiData = {
        id: 'seq-new-2',
        steps: [
          {
            id: 'step-1',
            intent: 'system.log',
          },
        ],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.steps[0].payload).toEqual({});
    });
  });

  describe('Legacy API format rejection', () => {
    it('should return empty steps for legacy commands format', () => {
      const apiData = {
        id: 'seq-legacy-1',
        commands: [
          {
            id: 'cmd-1',
            type: 'WAIT',
            payload: { durationMs: 5000 },
          },
        ],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.id).toBe('seq-legacy-1');
      expect(result.steps).toEqual([]);
      expect(result.metadata).toEqual({ error: 'Legacy format not supported' });
    });

    it('should use sequenceId as ID for legacy poll responses', () => {
      const apiData = {
        sequenceId: 'from-poll-response',
        commands: [],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.id).toBe('from-poll-response');
      expect(result.steps).toEqual([]);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty steps array', () => {
      const apiData = {
        id: 'seq-empty-steps',
        steps: [],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.steps).toEqual([]);
    });

    it('should generate ID when completely missing from steps format', () => {
      const apiData = {
        steps: [],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.id).toBeTruthy();
      expect(typeof result.id).toBe('string');
    });

    it('should return empty steps for data with no steps or commands', () => {
      const apiData = {
        id: 'no-data',
      };

      const result = normalizeApiResponse(apiData);

      expect(result.steps).toEqual([]);
    });
  });
});
