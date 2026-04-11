/**
 * normalizer.ts
 *
 * Validates and normalizes API responses into PortableSequence format.
 * The Race Control API now returns PortableSequence directly (with `steps`).
 */

import { randomUUID } from 'crypto';
import { PortableSequence, SequenceStep } from './director-types';

/**
 * Normalizes a raw API response into a PortableSequence.
 *
 * Expects the new PortableSequence format with `steps` and semantic `intent` fields.
 * Logs an error and returns a no-op sequence if the response is in the legacy format.
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

  // Legacy format is no longer supported — log error and return empty sequence
  console.error('[Normalizer] Received unsupported legacy API format (commands[]). Race Control should return PortableSequence with steps[].');
  return {
    id: apiData.sequenceId || apiData.id || randomUUID(),
    name: apiData.name,
    steps: [],
    metadata: { error: 'Legacy format not supported' },
  };
}
