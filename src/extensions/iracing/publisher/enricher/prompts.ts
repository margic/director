/**
 * prompts.ts — Issue #183
 *
 * Prompt templates for each cluster kind. Plain-string templates kept inline
 * (no file IO) to keep the publisher dependency-free and side-effect-free.
 *
 * Every prompt asks the model to respond as STRICT JSON with the exact
 * fields validated by `schema.validateLlmJson`. A few-shot example is
 * included to lock the format.
 */

import type { ClusterRequest } from './provider';

const SYSTEM = `You are a sim-racing broadcast colour commentator condensing a burst of telemetry events into one short narrative beat.
Respond with ONLY a JSON object — no prose, no markdown fences — matching this exact shape:
{
  "headline":   string (≤ 60 chars, present tense, broadcast tone),
  "narrative":  string (1–3 sentences, ≤ 600 chars),
  "severity":   "minor" | "major" | "race-defining",
  "confidence": number in [0, 1]
}`;

const FEW_SHOT = `Example input (incident cluster):
[
  {"type":"OFF_TRACK","car":{"carNumber":"7","driverName":"Alex Lynn"},"sessionTime":1234.5},
  {"type":"CONTACT_DETECTED","car":{"carNumber":"7","driverName":"Alex Lynn"},"sessionTime":1235.1},
  {"type":"PLAYER_STOPPED","car":{"carNumber":"7","driverName":"Alex Lynn"},"sessionTime":1236.0}
]
Example output:
{"headline":"Lynn beached at Turn 4","narrative":"Alex Lynn ran wide, made contact and is now stopped on track. The #7 will need a recovery and is losing time to the field.","severity":"major","confidence":0.86}`;

function summariseCluster(req: ClusterRequest): string {
  const items = req.events.map((e) => ({
    type: e.type,
    sessionTime: e.sessionTime,
    car: e.car ? { carNumber: e.car.carNumber, driverName: e.car.driverName } : undefined,
    payload: e.payload,
  }));
  return JSON.stringify(items, null, 0);
}

/**
 * Build the user-message prompt body for a cluster. The system message is
 * shared across all cluster kinds and provided separately by the adapter.
 */
export function buildUserPrompt(req: ClusterRequest): string {
  const kindLabel =
    req.kind === 'incident'
      ? 'an incident cluster'
      : req.kind === 'battle'
        ? 'a sustained on-track battle'
        : 'a completed stint';
  return `${FEW_SHOT}

Now condense ${kindLabel} (${req.events.length} events from sessionTime ${req.startTime.toFixed(2)} to ${req.endTime.toFixed(2)}):
${summariseCluster(req)}`;
}

export const SYSTEM_PROMPT = SYSTEM;
