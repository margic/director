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

  describe('Legacy API format (commands)', () => {
    it('should convert WAIT command to system.wait intent', () => {
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

      expect(result.steps[0]).toEqual({
        id: 'cmd-1',
        intent: 'system.wait',
        payload: { durationMs: 5000 },
      });
    });

    it('should convert WAIT command with durationMs at top level', () => {
      const apiData = {
        id: 'seq-legacy-2',
        commands: [
          {
            id: 'cmd-1',
            type: 'WAIT',
            durationMs: 3000,
          },
        ],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.steps[0]).toEqual({
        id: 'cmd-1',
        intent: 'system.wait',
        payload: { durationMs: 3000 },
      });
    });

    it('should convert LOG command to system.log intent', () => {
      const apiData = {
        id: 'seq-legacy-3',
        commands: [
          {
            id: 'cmd-2',
            type: 'LOG',
            payload: { message: 'Test log', level: 'WARN' },
          },
        ],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.steps[0]).toEqual({
        id: 'cmd-2',
        intent: 'system.log',
        payload: { message: 'Test log', level: 'WARN' },
      });
    });

    it('should convert LOG command with message/level at top level', () => {
      const apiData = {
        id: 'seq-legacy-4',
        commands: [
          {
            id: 'cmd-2',
            type: 'LOG',
            message: 'Direct message',
            level: 'ERROR',
          },
        ],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.steps[0].payload).toEqual({
        message: 'Direct message',
        level: 'ERROR',
      });
    });

    it('should unwrap EXECUTE_INTENT command', () => {
      const apiData = {
        id: 'seq-legacy-5',
        commands: [
          {
            id: 'cmd-3',
            type: 'EXECUTE_INTENT',
            payload: {
              intent: 'custom.action',
              payload: { foo: 'bar' },
            },
          },
        ],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.steps[0]).toEqual({
        id: 'cmd-3',
        intent: 'custom.action',
        payload: { foo: 'bar' },
      });
    });

    it('should convert SWITCH_CAMERA to broadcast.showLiveCam intent', () => {
      const apiData = {
        id: 'seq-legacy-6',
        commands: [
          {
            id: 'cmd-4',
            type: 'SWITCH_CAMERA',
            target: {
              carNumber: 42,
              cameraGroup: 3,
            },
          },
        ],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.steps[0]).toEqual({
        id: 'cmd-4',
        intent: 'broadcast.showLiveCam',
        payload: {
          carNum: '42',
          camGroup: '3',
          carNumber: 42,
          cameraGroup: 3,
        },
      });
    });

    it('should convert SWITCH_OBS_SCENE to obs.switchScene intent', () => {
      const apiData = {
        id: 'seq-legacy-7',
        commands: [
          {
            id: 'cmd-5',
            type: 'SWITCH_OBS_SCENE',
            target: {
              obsSceneId: 'MainScene',
            },
          },
        ],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.steps[0]).toEqual({
        id: 'cmd-5',
        intent: 'obs.switchScene',
        payload: {
          sceneName: 'MainScene',
          obsSceneId: 'MainScene',
        },
      });
    });

    it('should prefer sceneName over obsSceneId', () => {
      const apiData = {
        id: 'seq-legacy-8',
        commands: [
          {
            id: 'cmd-5',
            type: 'SWITCH_OBS_SCENE',
            target: {
              obsSceneId: 'OldName',
              sceneName: 'NewName',
            },
          },
        ],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.steps[0].payload.sceneName).toBe('NewName');
    });

    it('should convert DRIVER_TTS to communication.announce intent', () => {
      const apiData = {
        id: 'seq-legacy-9',
        commands: [
          {
            id: 'cmd-6',
            type: 'DRIVER_TTS',
            payload: { text: 'Hello driver' },
          },
        ],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.steps[0]).toEqual({
        id: 'cmd-6',
        intent: 'communication.announce',
        payload: { text: 'Hello driver' },
      });
    });

    it('should convert VIEWER_CHAT to communication.talkToChat intent', () => {
      const apiData = {
        id: 'seq-legacy-10',
        commands: [
          {
            id: 'cmd-7',
            type: 'VIEWER_CHAT',
            payload: { message: 'Hello viewers!', platform: 'YOUTUBE' },
          },
        ],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.steps[0]).toEqual({
        id: 'cmd-7',
        intent: 'communication.talkToChat',
        payload: { message: 'Hello viewers!', platform: 'YOUTUBE' },
      });
    });

    it('should handle unknown command types with warning log', () => {
      const apiData = {
        id: 'seq-legacy-11',
        commands: [
          {
            id: 'cmd-8',
            type: 'UNKNOWN_TYPE',
            payload: {},
          },
        ],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.steps[0]).toEqual({
        id: 'cmd-8',
        intent: 'system.log',
        payload: {
          message: 'Unknown API command type: UNKNOWN_TYPE',
          level: 'WARN',
        },
      });
    });

    it('should handle commandType field instead of type', () => {
      const apiData = {
        id: 'seq-legacy-12',
        commands: [
          {
            id: 'cmd-9',
            commandType: 'WAIT',
            payload: { durationMs: 2000 },
          },
        ],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.steps[0].intent).toBe('system.wait');
    });

    it('should generate step IDs when missing in legacy format', () => {
      const apiData = {
        id: 'seq-legacy-13',
        commands: [
          {
            type: 'WAIT',
            payload: { durationMs: 1000 },
          },
        ],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.steps[0].id).toBeTruthy();
    });

    it('should use sequenceId as ID if id field is missing', () => {
      const apiData = {
        sequenceId: 'from-poll-response',
        commands: [],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.id).toBe('from-poll-response');
    });

    it('should extract metadata from legacy format', () => {
      const apiData = {
        id: 'seq-legacy-14',
        name: 'Legacy Sequence',
        priority: 'HIGH',
        generatedAt: '2026-04-01T12:00:00Z',
        totalDurationMs: 10000,
        commands: [],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.name).toBe('Legacy Sequence');
      expect(result.metadata).toEqual({
        priority: 'HIGH',
        generatedAt: '2026-04-01T12:00:00Z',
        totalDurationMs: 10000,
      });
    });

    it('should extract metadata from nested metadata field', () => {
      const apiData = {
        id: 'seq-legacy-15',
        commands: [],
        metadata: {
          generatedAt: '2026-04-01T13:00:00Z',
          totalDurationMs: 5000,
          author: 'test',
        },
      };

      const result = normalizeApiResponse(apiData);

      expect(result.metadata).toEqual({
        priority: undefined,
        generatedAt: '2026-04-01T13:00:00Z',
        totalDurationMs: 5000,
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle empty commands array', () => {
      const apiData = {
        id: 'seq-empty',
        commands: [],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.steps).toEqual([]);
      expect(result.id).toBe('seq-empty');
    });

    it('should handle empty steps array', () => {
      const apiData = {
        id: 'seq-empty-steps',
        steps: [],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.steps).toEqual([]);
    });

    it('should generate ID when completely missing', () => {
      const apiData = {
        commands: [],
      };

      const result = normalizeApiResponse(apiData);

      expect(result.id).toBeTruthy();
      expect(typeof result.id).toBe('string');
    });

    it('should handle mixed command and target fields', () => {
      const apiData = {
        id: 'seq-mixed',
        commands: [
          {
            id: 'cmd-1',
            type: 'SWITCH_CAMERA',
            payload: { existingField: 'value' },
            target: {
              carNumber: 10,
              cameraGroup: 2,
            },
          },
        ],
      };

      const result = normalizeApiResponse(apiData);

      // Target fields should be merged with payload
      expect(result.steps[0].payload).toEqual({
        carNum: '10',
        camGroup: '2',
        carNumber: 10,
        cameraGroup: 2,
      });
    });
  });
});
