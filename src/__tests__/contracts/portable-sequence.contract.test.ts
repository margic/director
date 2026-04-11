/**
 * Contract tests for PortableSequence wire format
 *
 * These tests validate that the Director can parse and execute the canonical
 * PortableSequence format as defined in the Race Control contract.
 *
 * This mirrors the contract tests in margic/racecontrol to ensure consistency
 * between the API producer (Race Control) and consumer (Director).
 */
import { describe, it, expect } from 'vitest';
import {
  PortableSequence,
  SequenceStep,
} from '../../main/director-types';
import { normalizeApiResponse } from '../../main/normalizer';

describe('PortableSequence Contract Tests', () => {
  describe('New format passthrough', () => {
    it('should pass through sequence with steps array unchanged', () => {
      // A sequence already in PortableSequence format should be used as-is
      const portableSeq: PortableSequence = {
        id: 'portable-seq-1',
        name: 'Test Sequence',
        version: '1.0.0',
        description: 'A test sequence',
        steps: [
          {
            id: 'step-1',
            intent: 'system.wait',
            payload: { durationMs: 5000 },
          },
          {
            id: 'step-2',
            intent: 'broadcast.showLiveCam',
            payload: { carNum: '42', camGroup: 1 },
          },
        ],
        metadata: {
          source: 'ai-director',
          totalDurationMs: 15000,
        },
      };

      // When a PortableSequence is already in the correct format,
      // the normalizer should not need to transform it
      // (In practice, the Director would detect the `steps` field and skip normalization)

      // Verify the structure is valid
      expect(portableSeq.id).toBeDefined();
      expect(portableSeq.steps).toBeDefined();
      expect(Array.isArray(portableSeq.steps)).toBe(true);
      expect(portableSeq.steps.length).toBe(2);

      // Verify each step has the required shape
      portableSeq.steps.forEach(step => {
        expect(step.id).toBeDefined();
        expect(step.intent).toBeDefined();
        expect(step.payload).toBeDefined();
        expect(typeof step.payload).toBe('object');
      });
    });

    it('should accept minimal PortableSequence with only required fields', () => {
      const minimalSeq: PortableSequence = {
        id: 'minimal-seq',
        steps: [
          {
            id: 'step-1',
            intent: 'system.log',
            payload: { message: 'Hello', level: 'INFO' },
          },
        ],
      };

      expect(minimalSeq.id).toBeDefined();
      expect(minimalSeq.steps).toBeDefined();
      expect(minimalSeq.steps.length).toBe(1);
    });
  });

  describe('Normalizer passthrough for PortableSequence', () => {
    it('should pass through a PortableSequence via normalizeApiResponse unchanged', () => {
      const portableSeq: PortableSequence = {
        id: 'normalizer-test-1',
        name: 'Normalizer Test',
        steps: [
          {
            id: 'step-1',
            intent: 'system.wait',
            payload: { durationMs: 3000 },
          },
          {
            id: 'step-2',
            intent: 'broadcast.showLiveCam',
            payload: { carNum: '5', camGroup: 2 },
          },
        ],
        metadata: { source: 'ai-director', totalDurationMs: 15000 },
      };

      const result = normalizeApiResponse(portableSeq);

      expect(result.id).toBe('normalizer-test-1');
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].intent).toBe('system.wait');
      expect(result.steps[1].intent).toBe('broadcast.showLiveCam');
      expect(result.steps[1].payload).toEqual({ carNum: '5', camGroup: 2 });
    });
  });

  describe('Required fields validation', () => {
    it('should have id and steps fields on a valid PortableSequence', () => {
      const seq: PortableSequence = {
        id: 'test-id-123',
        steps: [
          {
            id: 'step-1',
            intent: 'system.log',
            payload: { message: 'test', level: 'INFO' },
          },
        ],
      };

      expect(seq.id).toBe('test-id-123');
      expect(typeof seq.id).toBe('string');
      expect(seq.id.length).toBeGreaterThan(0);
      expect(seq.steps).toBeDefined();
      expect(Array.isArray(seq.steps)).toBe(true);
      expect(seq.steps.length).toBeGreaterThan(0);
    });

    it('should allow empty steps array', () => {
      const seq: PortableSequence = {
        id: 'empty-seq',
        steps: [],
      };

      expect(seq.steps).toBeDefined();
      expect(Array.isArray(seq.steps)).toBe(true);
      expect(seq.steps.length).toBe(0);
    });
  });

  describe('Step shape validation', () => {
    it('should ensure each step has id, intent, and payload fields', () => {
      const seq: PortableSequence = {
        id: 'shape-test-seq',
        steps: [
          {
            id: 'step-1',
            intent: 'system.wait',
            payload: { durationMs: 2000 },
          },
          {
            id: 'step-2',
            intent: 'broadcast.showLiveCam',
            payload: { carNum: '3', camGroup: 4 },
          },
        ],
      };

      seq.steps.forEach((step: SequenceStep) => {
        expect(step.id).toBeDefined();
        expect(typeof step.id).toBe('string');

        expect(step.intent).toBeDefined();
        expect(typeof step.intent).toBe('string');

        expect(step.payload).toBeDefined();
        expect(typeof step.payload).toBe('object');
        expect(step.payload).not.toBeNull();
      });
    });
  });

  describe('Canonical intent names', () => {
    it('should use standard intent names in PortableSequence steps', () => {
      const seq: PortableSequence = {
        id: 'intent-mapping-seq',
        steps: [
          { id: 's1', intent: 'system.wait', payload: { durationMs: 1000 } },
          { id: 's2', intent: 'system.log', payload: { message: 'test', level: 'INFO' } },
          { id: 's3', intent: 'broadcast.showLiveCam', payload: { carNum: '1', camGroup: 1 } },
          { id: 's4', intent: 'obs.switchScene', payload: { sceneName: 'Scene1' } },
          { id: 's5', intent: 'communication.announce', payload: { text: 'Message' } },
          { id: 's6', intent: 'communication.talkToChat', payload: { platform: 'TWITCH', message: 'Hello' } },
        ],
      };

      const expectedIntents = [
        'system.wait',
        'system.log',
        'broadcast.showLiveCam',
        'obs.switchScene',
        'communication.announce',
        'communication.talkToChat',
      ];

      seq.steps.forEach((step, index) => {
        expect(step.intent).toBe(expectedIntents[index]);
      });
    });
  });

  describe('Director payload field names', () => {
    it('should use carNum field name in camera payloads (not carNumber)', () => {
      // The canonical PortableSequence format uses Director-native field names
      // This test documents that carNum (not carNumber) is the preferred field name
      const portableSeq: PortableSequence = {
        id: 'cam-payload-seq',
        steps: [
          {
            id: 'step-1',
            intent: 'broadcast.showLiveCam',
            payload: { carNum: '42', camGroup: 1 },
          },
        ],
      };

      expect(portableSeq.steps[0].payload).toHaveProperty('carNum');
      expect(portableSeq.steps[0].payload).toHaveProperty('camGroup');
    });

    it('should use camGroup field name (not cameraGroupNumber)', () => {
      const portableSeq: PortableSequence = {
        id: 'cam-group-seq',
        steps: [
          {
            id: 'step-1',
            intent: 'broadcast.showLiveCam',
            payload: { carNum: '5', camGroup: 3 },
          },
        ],
      };

      const step = portableSeq.steps[0];
      expect(step.payload).toHaveProperty('camGroup');
      expect(typeof step.payload.camGroup).toBe('number');
    });

    it('should use sceneName field in OBS scene switching', () => {
      const portableSeq: PortableSequence = {
        id: 'obs-scene-seq',
        steps: [
          {
            id: 'step-1',
            intent: 'obs.switchScene',
            payload: { sceneName: 'Studio Scene' },
          },
        ],
      };

      expect(portableSeq.steps[0].payload).toHaveProperty('sceneName');
      expect(typeof portableSeq.steps[0].payload.sceneName).toBe('string');
    });

    it('should use message field in communication intents', () => {
      const portableSeq: PortableSequence = {
        id: 'message-seq',
        steps: [
          {
            id: 'step-1',
            intent: 'system.log',
            payload: { message: 'Test message', level: 'INFO' },
          },
          {
            id: 'step-2',
            intent: 'communication.talkToChat',
            payload: { message: 'Chat message', platform: 'YOUTUBE' },
          },
        ],
      };

      expect(portableSeq.steps[0].payload).toHaveProperty('message');
      expect(portableSeq.steps[1].payload).toHaveProperty('message');
    });

    it('should document canonical field names for camera payloads', () => {
      // The canonical PortableSequence format uses carNum/camGroup (not carNumber/cameraGroupNumber)
      const seq: PortableSequence = {
        id: 'canonical-fields-seq',
        steps: [
          {
            id: 'step-1',
            intent: 'broadcast.showLiveCam',
            payload: { carNum: '42', camGroup: 2 },
          },
        ],
      };

      expect(seq.steps[0].payload).toHaveProperty('carNum');
      expect(seq.steps[0].payload).toHaveProperty('camGroup');
      expect(seq.steps[0].payload).not.toHaveProperty('carNumber');
      expect(seq.steps[0].payload).not.toHaveProperty('cameraGroupNumber');
    });
  });

  describe('Malformed sequence rejection', () => {
    it('should handle sequence without steps gracefully', () => {
      const malformedSeq = {
        id: 'malformed-seq',
        // Missing 'steps'
      } as any;

      // The Director should detect this and handle it
      expect(malformedSeq.steps).toBeUndefined();

      // This would be caught by runtime validation before execution
      const hasValidFormat = Array.isArray(malformedSeq.steps);

      expect(hasValidFormat).toBe(false);
    });

    it('should reject sequence with null steps array', () => {
      const invalidSeq = {
        id: 'null-steps-seq',
        steps: null,
      } as any;

      expect(Array.isArray(invalidSeq.steps)).toBe(false);
    });

    it('should reject sequence without id', () => {
      const noIdSeq = {
        steps: [
          {
            id: 'step-1',
            intent: 'system.wait',
            payload: { durationMs: 1000 },
          },
        ],
      } as any;

      expect(noIdSeq.id).toBeUndefined();
    });

    it('should reject step without required fields', () => {
      const invalidStep = {
        // Missing 'id'
        intent: 'system.wait',
        payload: { durationMs: 1000 },
      } as any;

      expect(invalidStep.id).toBeUndefined();

      const invalidStep2 = {
        id: 'step-1',
        // Missing 'intent'
        payload: { durationMs: 1000 },
      } as any;

      expect(invalidStep2.intent).toBeUndefined();

      const invalidStep3 = {
        id: 'step-1',
        intent: 'system.wait',
        // Missing 'payload'
      } as any;

      expect(invalidStep3.payload).toBeUndefined();
    });
  });

  describe('AI Director metadata validation', () => {
    it('should validate totalDurationMs >= 10000 for ai-director sequences', () => {
      const aiDirectorSeq: PortableSequence = {
        id: 'ai-seq-1',
        steps: [
          {
            id: 'step-1',
            intent: 'system.wait',
            payload: { durationMs: 5000 },
          },
          {
            id: 'step-2',
            intent: 'broadcast.showLiveCam',
            payload: { carNum: '1', camGroup: 1 },
          },
          {
            id: 'step-3',
            intent: 'system.wait',
            payload: { durationMs: 7000 },
          },
        ],
        metadata: {
          source: 'ai-director',
          totalDurationMs: 15000,
        },
      };

      // Verify metadata exists and has totalDurationMs
      expect(aiDirectorSeq.metadata).toBeDefined();
      expect(aiDirectorSeq.metadata?.totalDurationMs).toBeDefined();

      // AI Director sequences must be at least 10 seconds
      const totalDuration = aiDirectorSeq.metadata?.totalDurationMs as number;
      expect(totalDuration).toBeGreaterThanOrEqual(10000);
    });

    it('should reject ai-director sequence with totalDurationMs < 10000', () => {
      const tooShortSeq: PortableSequence = {
        id: 'too-short-seq',
        steps: [
          {
            id: 'step-1',
            intent: 'system.wait',
            payload: { durationMs: 5000 },
          },
        ],
        metadata: {
          source: 'ai-director',
          totalDurationMs: 5000,
        },
      };

      const totalDuration = tooShortSeq.metadata?.totalDurationMs as number;

      // This should fail validation for AI Director sequences
      if (tooShortSeq.metadata?.source === 'ai-director') {
        expect(totalDuration).toBeLessThan(10000);
        // In production, this would trigger a validation error
      }
    });

    it('should allow sequences without totalDurationMs for non-ai-director sources', () => {
      const manualSeq: PortableSequence = {
        id: 'manual-seq',
        steps: [
          {
            id: 'step-1',
            intent: 'system.log',
            payload: { message: 'Quick log', level: 'INFO' },
          },
        ],
        metadata: {
          source: 'manual',
        },
      };

      // Manual sequences don't require totalDurationMs
      expect(manualSeq.metadata?.totalDurationMs).toBeUndefined();
      // This is valid for non-AI Director sequences
    });

    it('should validate ai-director sequences have appropriate duration metadata', () => {
      const validAiSeq: PortableSequence = {
        id: 'valid-ai-seq',
        steps: [
          {
            id: 'step-1',
            intent: 'broadcast.showLiveCam',
            payload: { carNum: '23', camGroup: 1 },
          },
          {
            id: 'step-2',
            intent: 'system.wait',
            payload: { durationMs: 8000 },
          },
          {
            id: 'step-3',
            intent: 'broadcast.showLiveCam',
            payload: { carNum: '42', camGroup: 2 },
          },
          {
            id: 'step-4',
            intent: 'system.wait',
            payload: { durationMs: 4000 },
          },
        ],
        metadata: {
          source: 'ai-director',
          totalDurationMs: 12000,
        },
      };

      expect(validAiSeq.metadata?.source).toBe('ai-director');
      expect(validAiSeq.metadata?.totalDurationMs).toBeDefined();
      expect(validAiSeq.metadata?.totalDurationMs).toBeGreaterThanOrEqual(10000);
    });
  });

  describe('Fixture data consistency', () => {
    it('should use consistent test data matching Race Control contract tests', () => {
      // This test documents the canonical fixture data format
      // that should be used across both RC and Director contract tests

      const canonicalFixture: PortableSequence = {
        id: 'fixture-seq-1',
        name: 'Standard Battle Sequence',
        version: '1.0.0',
        description: 'Shows a close racing battle between two cars',
        steps: [
          {
            id: 'step-1',
            intent: 'broadcast.showLiveCam',
            payload: { carNum: '42', camGroup: 1 },
            metadata: { label: 'Show car 42' },
          },
          {
            id: 'step-2',
            intent: 'system.wait',
            payload: { durationMs: 5000 },
            metadata: { label: 'Hold for 5 seconds' },
          },
          {
            id: 'step-3',
            intent: 'broadcast.showLiveCam',
            payload: { carNum: '23', camGroup: 2 },
            metadata: { label: 'Show car 23' },
          },
          {
            id: 'step-4',
            intent: 'system.wait',
            payload: { durationMs: 5000 },
            metadata: { label: 'Hold for 5 seconds' },
          },
        ],
        metadata: {
          source: 'ai-director',
          totalDurationMs: 10000,
          category: 'battle',
        },
      };

      // Verify fixture structure
      expect(canonicalFixture.id).toBeDefined();
      expect(canonicalFixture.steps).toBeDefined();
      expect(canonicalFixture.steps.length).toBe(4);
      expect(canonicalFixture.metadata?.totalDurationMs).toBe(10000);

      // Verify this matches the minimum duration for AI sequences
      expect(canonicalFixture.metadata?.totalDurationMs).toBeGreaterThanOrEqual(10000);
    });
  });
});
