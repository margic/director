/**
 * normalizer.ts
 *
 * Consolidates all API response normalization logic into a single function.
 * Handles both new PortableSequence format (with `steps` and semantic `intent` fields)
 * and legacy DirectorSequence format (with `commands` and `commandType` fields).
 *
 * This replaces the three separate normalization implementations:
 * 1. DirectorService.normalizeApiResponse() (private method)
 * 2. normalizeApiSequence() (in director-types.ts)
 * 3. normalizeNextSequenceResponse() (in director-types.ts)
 */

import { randomUUID } from 'crypto';
import { PortableSequence, SequenceStep } from './director-types';

/**
 * Intent mappings for legacy API CommandType values.
 * Maps the old enum-based command types from the OpenAPI spec
 * to the semantic intent names registered by extensions.
 */
const LEGACY_INTENT_MAP: Record<string, string> = {
  'SWITCH_CAMERA': 'broadcast.showLiveCam',
  'SWITCH_OBS_SCENE': 'obs.switchScene',
  'DRIVER_TTS': 'communication.announce',
  'VIEWER_CHAT': 'communication.talkToChat',
  'PLAY_AUDIO': 'audio.play',          // Future
  'SHOW_OVERLAY': 'overlay.show',       // Future
  'HIDE_OVERLAY': 'overlay.hide',       // Future
};

/**
 * Normalizes a raw API response into a PortableSequence.
 *
 * Supports two formats:
 * 1. **New format**: API returns PortableSequence directly with `steps` and semantic `intent` fields
 * 2. **Legacy format**: API returns DirectorSequence/GetNextSequenceResponse with `commands` and `commandType` fields
 *
 * @param apiData - Raw API response (any structure)
 * @returns PortableSequence - Normalized sequence ready for execution
 */
export function normalizeApiResponse(apiData: any): PortableSequence {
  // New format: API returns PortableSequence directly with `steps`
  if (apiData.steps && Array.isArray(apiData.steps)) {
    return {
      id: apiData.id || randomUUID(),
      name: apiData.name,
      version: apiData.version,
      description: apiData.description,
      category: apiData.category,
      priority: apiData.priority,
      variables: apiData.variables,
      steps: apiData.steps.map((step: any) => ({
        id: step.id || randomUUID(),
        intent: step.intent,
        payload: step.payload || {},
        metadata: step.metadata,
      })),
      metadata: apiData.metadata,
    };
  }

  // Legacy format: API returned DirectorSequence/GetNextSequenceResponse with `commands`
  console.warn('[Normalizer] Received legacy API format with commands[] — normalizing to PortableSequence');
  const commands: any[] = apiData.commands || [];

  const steps: SequenceStep[] = commands.map((cmd: any, index: number) => {
    const type = cmd.commandType || cmd.type;
    const id = cmd.id || randomUUID();

    // Handle WAIT
    if (type === 'WAIT') {
      const durationMs = cmd.payload?.durationMs ?? cmd.durationMs ?? 0;
      return { id, intent: 'system.wait', payload: { durationMs } };
    }

    // Handle LOG
    if (type === 'LOG') {
      const payload = cmd.payload || { message: cmd.message || '', level: cmd.level || 'INFO' };
      return { id, intent: 'system.log', payload };
    }

    // Handle EXECUTE_INTENT (already intent-based, unwrap)
    if (type === 'EXECUTE_INTENT') {
      return {
        id,
        intent: cmd.payload?.intent || 'system.log',
        payload: cmd.payload?.payload || {},
      };
    }

    // Map legacy command types to semantic intents
    const intent = LEGACY_INTENT_MAP[type];
    if (intent) {
      let payload = cmd.payload || {};

      if (cmd.target) {
        if (type === 'SWITCH_CAMERA') {
          payload = {
            carNum: cmd.target.carNumber?.toString(),
            camGroup: cmd.target.cameraGroup?.toString(),
            ...cmd.target,
          };
        } else if (type === 'SWITCH_OBS_SCENE') {
          payload = {
            sceneName: cmd.target.obsSceneId || cmd.target.sceneName,
            ...cmd.target,
          };
        } else {
          payload = { ...cmd.target };
        }
      }

      return { id, intent, payload };
    }

    // Unknown command — emit a warning log step
    console.warn(`[Normalizer] Unknown API command type: ${type}`);
    return {
      id,
      intent: 'system.log',
      payload: { message: `Unknown API command type: ${type}`, level: 'WARN' },
    };
  });

  return {
    id: apiData.sequenceId || apiData.id || randomUUID(),
    name: apiData.name,
    steps,
    metadata: {
      priority: apiData.priority,
      generatedAt: apiData.generatedAt || apiData.metadata?.generatedAt,
      totalDurationMs: apiData.totalDurationMs || apiData.metadata?.totalDurationMs,
    },
  };
}
