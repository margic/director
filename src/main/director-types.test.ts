/**
 * Unit tests for director-types normalization functions
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeApiSequence,
  normalizeNextSequenceResponse,
  DirectorCommand,
  DirectorSequence,
  GetNextSequenceResponse,
  WaitCommand,
  LogCommand,
  SwitchCameraCommand,
  SwitchObsSceneCommand,
  DriverTtsCommand,
  ViewerChatCommand,
  ExecuteIntentCommand,
} from './director-types';

describe('normalizeCommand', () => {
  it('should convert WAIT command to system.wait intent', () => {
    const legacy: DirectorSequence = {
      id: 'seq-1',
      commands: [
        {
          id: 'cmd-1',
          type: 'WAIT',
          payload: { durationMs: 5000 },
        } as WaitCommand,
      ],
    };

    const result = normalizeApiSequence(legacy);

    expect(result.steps[0]).toEqual({
      id: 'cmd-1',
      intent: 'system.wait',
      payload: { durationMs: 5000 },
    });
  });

  it('should convert LOG command to system.log intent', () => {
    const legacy: DirectorSequence = {
      id: 'seq-2',
      commands: [
        {
          id: 'cmd-2',
          type: 'LOG',
          payload: { message: 'Test log', level: 'INFO' },
        } as LogCommand,
      ],
    };

    const result = normalizeApiSequence(legacy);

    expect(result.steps[0]).toEqual({
      id: 'cmd-2',
      intent: 'system.log',
      payload: { message: 'Test log', level: 'INFO' },
    });
  });

  it('should convert SWITCH_CAMERA to broadcast.showLiveCam intent', () => {
    const legacy: DirectorSequence = {
      id: 'seq-3',
      commands: [
        {
          id: 'cmd-3',
          type: 'SWITCH_CAMERA',
          payload: { carNumber: '42', cameraGroupNumber: 1 },
        } as SwitchCameraCommand,
      ],
    };

    const result = normalizeApiSequence(legacy);

    expect(result.steps[0]).toEqual({
      id: 'cmd-3',
      intent: 'broadcast.showLiveCam',
      payload: { carNumber: '42', cameraGroupNumber: 1 },
    });
  });

  it('should convert SWITCH_OBS_SCENE to obs.switchScene intent', () => {
    const legacy: DirectorSequence = {
      id: 'seq-4',
      commands: [
        {
          id: 'cmd-4',
          type: 'SWITCH_OBS_SCENE',
          payload: { sceneName: 'MainScene', transition: 'Fade' },
        } as SwitchObsSceneCommand,
      ],
    };

    const result = normalizeApiSequence(legacy);

    expect(result.steps[0]).toEqual({
      id: 'cmd-4',
      intent: 'obs.switchScene',
      payload: { sceneName: 'MainScene', transition: 'Fade' },
    });
  });

  it('should convert DRIVER_TTS to communication.announce intent', () => {
    const legacy: DirectorSequence = {
      id: 'seq-5',
      commands: [
        {
          id: 'cmd-5',
          type: 'DRIVER_TTS',
          payload: { text: 'Hello driver', voiceId: 'voice-1' },
        } as DriverTtsCommand,
      ],
    };

    const result = normalizeApiSequence(legacy);

    expect(result.steps[0]).toEqual({
      id: 'cmd-5',
      intent: 'communication.announce',
      payload: { text: 'Hello driver', voiceId: 'voice-1' },
    });
  });

  it('should convert VIEWER_CHAT to communication.talkToChat intent', () => {
    const legacy: DirectorSequence = {
      id: 'seq-6',
      commands: [
        {
          id: 'cmd-6',
          type: 'VIEWER_CHAT',
          payload: { platform: 'YOUTUBE', message: 'Hello viewers!' },
        } as ViewerChatCommand,
      ],
    };

    const result = normalizeApiSequence(legacy);

    expect(result.steps[0]).toEqual({
      id: 'cmd-6',
      intent: 'communication.talkToChat',
      payload: { platform: 'YOUTUBE', message: 'Hello viewers!' },
    });
  });

  it('should unwrap EXECUTE_INTENT and use the intent directly', () => {
    const legacy: DirectorSequence = {
      id: 'seq-7',
      commands: [
        {
          id: 'cmd-7',
          type: 'EXECUTE_INTENT',
          payload: {
            intent: 'custom.action',
            payload: { customData: 'test' },
          },
        } as ExecuteIntentCommand,
      ],
    };

    const result = normalizeApiSequence(legacy);

    expect(result.steps[0]).toEqual({
      id: 'cmd-7',
      intent: 'custom.action',
      payload: { customData: 'test' },
    });
  });

  it('should handle unknown command types by creating a warning log step', () => {
    const legacy: DirectorSequence = {
      id: 'seq-8',
      commands: [
        {
          id: 'cmd-8',
          type: 'UNKNOWN_TYPE',
          payload: {},
        } as any,
      ],
    };

    const result = normalizeApiSequence(legacy);

    expect(result.steps[0]).toEqual({
      id: 'cmd-8',
      intent: 'system.log',
      payload: {
        message: 'Unknown legacy command type: UNKNOWN_TYPE',
        level: 'WARN',
      },
    });
  });

  it('should generate step IDs when not provided', () => {
    const legacy: DirectorSequence = {
      id: 'seq-9',
      commands: [
        {
          type: 'WAIT',
          payload: { durationMs: 1000 },
        } as any,
      ],
    };

    const result = normalizeApiSequence(legacy);

    expect(result.steps[0].id).toBe('step_0');
  });
});

describe('normalizeApiSequence', () => {
  it('should convert full legacy sequence to PortableSequence', () => {
    const legacy: DirectorSequence = {
      id: 'full-seq-1',
      commands: [
        {
          id: 'cmd-1',
          type: 'LOG',
          payload: { message: 'Starting sequence', level: 'INFO' },
        } as LogCommand,
        {
          id: 'cmd-2',
          type: 'WAIT',
          payload: { durationMs: 2000 },
        } as WaitCommand,
        {
          id: 'cmd-3',
          type: 'SWITCH_CAMERA',
          payload: { carNumber: '5', cameraGroupNumber: 3 },
        } as SwitchCameraCommand,
      ],
      metadata: {
        source: 'test',
        priority: 'NORMAL',
      },
    };

    const result = normalizeApiSequence(legacy);

    expect(result).toEqual({
      id: 'full-seq-1',
      steps: [
        {
          id: 'cmd-1',
          intent: 'system.log',
          payload: { message: 'Starting sequence', level: 'INFO' },
        },
        {
          id: 'cmd-2',
          intent: 'system.wait',
          payload: { durationMs: 2000 },
        },
        {
          id: 'cmd-3',
          intent: 'broadcast.showLiveCam',
          payload: { carNumber: '5', cameraGroupNumber: 3 },
        },
      ],
      metadata: {
        source: 'test',
        priority: 'NORMAL',
      },
    });
  });

  it('should preserve metadata when converting sequences', () => {
    const legacy: DirectorSequence = {
      id: 'seq-meta',
      commands: [],
      metadata: {
        author: 'test-user',
        version: 1,
        tags: ['test', 'demo'],
      },
    };

    const result = normalizeApiSequence(legacy);

    expect(result.metadata).toEqual({
      author: 'test-user',
      version: 1,
      tags: ['test', 'demo'],
    });
  });
});

describe('normalizeNextSequenceResponse', () => {
  it('should convert poll response to PortableSequence', () => {
    const response: GetNextSequenceResponse = {
      sequenceId: 'poll-seq-1',
      createdAt: '2026-04-01T12:00:00Z',
      priority: 'HIGH',
      commands: [
        {
          id: 'cmd-1',
          type: 'LOG',
          payload: { message: 'Priority sequence', level: 'INFO' },
        } as LogCommand,
      ],
      totalDurationMs: 5000,
    };

    const result = normalizeNextSequenceResponse(response);

    expect(result).toEqual({
      id: 'poll-seq-1',
      steps: [
        {
          id: 'cmd-1',
          intent: 'system.log',
          payload: { message: 'Priority sequence', level: 'INFO' },
        },
      ],
      metadata: { priority: 'HIGH' },
    });
  });

  it('should extract priority from response into metadata', () => {
    const response: GetNextSequenceResponse = {
      sequenceId: 'urgent-seq',
      createdAt: '2026-04-01T12:00:00Z',
      priority: 'URGENT',
      commands: [
        {
          id: 'cmd-1',
          type: 'WAIT',
          payload: { durationMs: 100 },
        } as WaitCommand,
      ],
    };

    const result = normalizeNextSequenceResponse(response);

    expect(result.metadata).toEqual({ priority: 'URGENT' });
  });

  it('should handle response without priority', () => {
    const response: GetNextSequenceResponse = {
      sequenceId: 'no-priority-seq',
      createdAt: '2026-04-01T12:00:00Z',
      commands: [
        {
          id: 'cmd-1',
          type: 'LOG',
          payload: { message: 'No priority', level: 'INFO' },
        } as LogCommand,
      ],
    };

    const result = normalizeNextSequenceResponse(response);

    expect(result.metadata).toEqual({ priority: undefined });
  });
});
