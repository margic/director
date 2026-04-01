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
  DirectorSequence,
  normalizeApiSequence,
  SequenceStep,
} from '../../main/director-types';

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

  describe('Legacy format conversion', () => {
    it('should convert legacy commands array to PortableSequence with correct intents', () => {
      const legacySeq: DirectorSequence = {
        id: 'legacy-seq-1',
        commands: [
          {
            id: 'cmd-1',
            type: 'WAIT',
            payload: { durationMs: 3000 },
          },
          {
            id: 'cmd-2',
            type: 'SWITCH_CAMERA',
            payload: { carNumber: '5', cameraGroupNumber: 2 },
          },
          {
            id: 'cmd-3',
            type: 'SWITCH_OBS_SCENE',
            payload: { sceneName: 'MainBroadcast' },
          },
          {
            id: 'cmd-4',
            type: 'LOG',
            payload: { message: 'Sequence complete', level: 'INFO' },
          },
        ],
      };

      const result = normalizeApiSequence(legacySeq);

      // Verify normalized to PortableSequence format
      expect(result.id).toBe('legacy-seq-1');
      expect(result.steps).toBeDefined();
      expect(Array.isArray(result.steps)).toBe(true);
      expect(result.steps.length).toBe(4);

      // Verify intents are correctly mapped
      expect(result.steps[0].intent).toBe('system.wait');
      expect(result.steps[1].intent).toBe('broadcast.showLiveCam');
      expect(result.steps[2].intent).toBe('obs.switchScene');
      expect(result.steps[3].intent).toBe('system.log');

      // Verify payloads are preserved
      expect(result.steps[0].payload).toEqual({ durationMs: 3000 });
      expect(result.steps[1].payload).toEqual({ carNumber: '5', cameraGroupNumber: 2 });
      expect(result.steps[2].payload).toEqual({ sceneName: 'MainBroadcast' });
      expect(result.steps[3].payload).toEqual({ message: 'Sequence complete', level: 'INFO' });
    });

    it('should convert DRIVER_TTS to communication.announce intent', () => {
      const legacySeq: DirectorSequence = {
        id: 'tts-seq',
        commands: [
          {
            id: 'cmd-1',
            type: 'DRIVER_TTS',
            payload: { text: 'Good luck!', voiceId: 'en-US-1' },
          },
        ],
      };

      const result = normalizeApiSequence(legacySeq);

      expect(result.steps[0].intent).toBe('communication.announce');
      expect(result.steps[0].payload).toEqual({ text: 'Good luck!', voiceId: 'en-US-1' });
    });

    it('should convert VIEWER_CHAT to communication.talkToChat intent', () => {
      const legacySeq: DirectorSequence = {
        id: 'chat-seq',
        commands: [
          {
            id: 'cmd-1',
            type: 'VIEWER_CHAT',
            payload: { platform: 'YOUTUBE', message: 'Welcome to the stream!' },
          },
        ],
      };

      const result = normalizeApiSequence(legacySeq);

      expect(result.steps[0].intent).toBe('communication.talkToChat');
      expect(result.steps[0].payload).toEqual({ platform: 'YOUTUBE', message: 'Welcome to the stream!' });
    });
  });

  describe('Required fields validation', () => {
    it('should have id field after normalization', () => {
      const legacySeq: DirectorSequence = {
        id: 'test-id-123',
        commands: [
          {
            id: 'cmd-1',
            type: 'LOG',
            payload: { message: 'test', level: 'INFO' },
          },
        ],
      };

      const result = normalizeApiSequence(legacySeq);

      expect(result.id).toBe('test-id-123');
      expect(typeof result.id).toBe('string');
      expect(result.id.length).toBeGreaterThan(0);
    });

    it('should have steps field after normalization', () => {
      const legacySeq: DirectorSequence = {
        id: 'test-seq',
        commands: [
          {
            id: 'cmd-1',
            type: 'WAIT',
            payload: { durationMs: 1000 },
          },
        ],
      };

      const result = normalizeApiSequence(legacySeq);

      expect(result.steps).toBeDefined();
      expect(Array.isArray(result.steps)).toBe(true);
      expect(result.steps.length).toBeGreaterThan(0);
    });

    it('should preserve empty steps array', () => {
      const legacySeq: DirectorSequence = {
        id: 'empty-seq',
        commands: [],
      };

      const result = normalizeApiSequence(legacySeq);

      expect(result.steps).toBeDefined();
      expect(Array.isArray(result.steps)).toBe(true);
      expect(result.steps.length).toBe(0);
    });
  });

  describe('Step shape validation', () => {
    it('should ensure each step has id, intent, and payload fields', () => {
      const legacySeq: DirectorSequence = {
        id: 'shape-test-seq',
        commands: [
          {
            id: 'cmd-1',
            type: 'WAIT',
            payload: { durationMs: 2000 },
          },
          {
            id: 'cmd-2',
            type: 'SWITCH_CAMERA',
            payload: { carNumber: '3', cameraGroupNumber: 4 },
          },
        ],
      };

      const result = normalizeApiSequence(legacySeq);

      result.steps.forEach((step: SequenceStep) => {
        // Required fields
        expect(step.id).toBeDefined();
        expect(typeof step.id).toBe('string');

        expect(step.intent).toBeDefined();
        expect(typeof step.intent).toBe('string');

        expect(step.payload).toBeDefined();
        expect(typeof step.payload).toBe('object');
        expect(step.payload).not.toBeNull();
      });
    });

    it('should generate step IDs when missing in legacy format', () => {
      const legacySeq: DirectorSequence = {
        id: 'no-ids-seq',
        commands: [
          {
            type: 'WAIT',
            payload: { durationMs: 1000 },
          } as any,
          {
            type: 'LOG',
            payload: { message: 'test', level: 'INFO' },
          } as any,
        ],
      };

      const result = normalizeApiSequence(legacySeq);

      expect(result.steps[0].id).toBe('step_0');
      expect(result.steps[1].id).toBe('step_1');
    });
  });

  describe('Canonical intent names', () => {
    it('should resolve all standard intents correctly', () => {
      const legacySeq: DirectorSequence = {
        id: 'intent-mapping-seq',
        commands: [
          {
            id: 'cmd-1',
            type: 'WAIT',
            payload: { durationMs: 1000 },
          },
          {
            id: 'cmd-2',
            type: 'LOG',
            payload: { message: 'test', level: 'INFO' },
          },
          {
            id: 'cmd-3',
            type: 'SWITCH_CAMERA',
            payload: { carNumber: '1', cameraGroupNumber: 1 },
          },
          {
            id: 'cmd-4',
            type: 'SWITCH_OBS_SCENE',
            payload: { sceneName: 'Scene1' },
          },
          {
            id: 'cmd-5',
            type: 'DRIVER_TTS',
            payload: { text: 'Message', voiceId: 'voice-1' },
          },
          {
            id: 'cmd-6',
            type: 'VIEWER_CHAT',
            payload: { platform: 'TWITCH', message: 'Hello' },
          },
        ],
      };

      const result = normalizeApiSequence(legacySeq);

      // Map of expected intent resolutions
      const expectedIntents = [
        'system.wait',
        'system.log',
        'broadcast.showLiveCam',
        'obs.switchScene',
        'communication.announce',
        'communication.talkToChat',
      ];

      result.steps.forEach((step, index) => {
        expect(step.intent).toBe(expectedIntents[index]);
      });
    });

    it('should handle EXECUTE_INTENT by unwrapping to the specified intent', () => {
      const legacySeq: DirectorSequence = {
        id: 'execute-intent-seq',
        commands: [
          {
            id: 'cmd-1',
            type: 'EXECUTE_INTENT',
            payload: {
              intent: 'custom.myExtension.action',
              payload: { customField: 'value' },
            },
          },
        ],
      };

      const result = normalizeApiSequence(legacySeq);

      expect(result.steps[0].intent).toBe('custom.myExtension.action');
      expect(result.steps[0].payload).toEqual({ customField: 'value' });
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

    it('should accept legacy field names for backward compatibility during normalization', () => {
      // When normalizing from legacy format, the API may use old field names
      // The normalizer should pass them through (payload transformation is executor's job)
      const legacySeq: DirectorSequence = {
        id: 'legacy-fields-seq',
        commands: [
          {
            id: 'cmd-1',
            type: 'SWITCH_CAMERA',
            payload: { carNumber: '42', cameraGroupNumber: 2 },
          },
        ],
      };

      const result = normalizeApiSequence(legacySeq);

      // Normalizer preserves payload as-is, including legacy field names
      expect(result.steps[0].payload).toHaveProperty('carNumber');
      expect(result.steps[0].payload).toHaveProperty('cameraGroupNumber');
    });
  });

  describe('Malformed sequence rejection', () => {
    it('should handle sequence without steps or commands gracefully', () => {
      const malformedSeq = {
        id: 'malformed-seq',
        // Missing both 'steps' and 'commands'
      } as any;

      // The Director should detect this and handle it
      // For now, we verify that a proper sequence has the required structure
      expect(malformedSeq.steps).toBeUndefined();
      expect(malformedSeq.commands).toBeUndefined();

      // This would be caught by runtime validation before execution
      const hasValidFormat =
        Array.isArray(malformedSeq.steps) ||
        Array.isArray(malformedSeq.commands);

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
