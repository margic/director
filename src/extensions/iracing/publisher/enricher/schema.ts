/**
 * schema.ts — Issue #183
 *
 * Strict, dependency-free validation of provider JSON output. Used by every
 * provider adapter before returning a `ProviderResponse`. Returns either a
 * normalised value or throws a descriptive `Error` consumed by the enricher's
 * parse-error counter.
 */

import type { ProviderResponse } from './provider';

/**
 * Validate the JSON-mode response from an LLM provider. Required fields:
 *   - headline   string ≤ 60 chars
 *   - narrative  string ≤ 600 chars
 *   - severity   'minor' | 'major' | 'race-defining'
 *   - confidence number in [0, 1]
 *
 * `tokensIn`, `tokensOut`, `latencyMs`, `model` come from the adapter, NOT
 * from the LLM, and are merged in by the caller.
 */
export function validateLlmJson(input: unknown): {
  headline: string;
  narrative: string;
  severity: ProviderResponse['severity'];
  confidence: number;
} {
  if (!input || typeof input !== 'object') {
    throw new Error('LLM response is not an object');
  }
  const r = input as Record<string, unknown>;

  const headline = r.headline;
  if (typeof headline !== 'string' || headline.length === 0 || headline.length > 60) {
    throw new Error('headline must be a non-empty string ≤ 60 chars');
  }

  const narrative = r.narrative;
  if (typeof narrative !== 'string' || narrative.length === 0 || narrative.length > 600) {
    throw new Error('narrative must be a non-empty string ≤ 600 chars');
  }

  const severity = r.severity;
  if (severity !== 'minor' && severity !== 'major' && severity !== 'race-defining') {
    throw new Error('severity must be one of minor | major | race-defining');
  }

  const confidence = r.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('confidence must be a number in [0, 1]');
  }

  return { headline, narrative, severity, confidence };
}

/**
 * Strict JSON.parse wrapper. Some chat models prefix/suffix the JSON with
 * markdown fences — this strips them before parsing.
 */
export function parseLlmJson(raw: string): unknown {
  let s = raw.trim();
  if (s.startsWith('```')) {
    // Strip a markdown fence: ```json ... ``` or ``` ... ```
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(s);
}
