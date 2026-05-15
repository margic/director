/**
 * enricher-schema.test.ts — Issue #183
 */
import { describe, it, expect } from 'vitest';
import { parseLlmJson, validateLlmJson } from '../enricher/schema';

const valid = {
  headline: 'Lynn beached at Turn 4',
  narrative: 'Alex Lynn ran wide, made contact and is now stopped on track.',
  severity: 'major',
  confidence: 0.86,
};

describe('validateLlmJson', () => {
  it('accepts a well-formed payload', () => {
    expect(validateLlmJson(valid)).toEqual(valid);
  });

  it('rejects non-objects', () => {
    expect(() => validateLlmJson(null)).toThrow();
    expect(() => validateLlmJson('hi')).toThrow();
    expect(() => validateLlmJson(42)).toThrow();
  });

  it('rejects missing or oversize headline', () => {
    expect(() => validateLlmJson({ ...valid, headline: '' })).toThrow();
    expect(() => validateLlmJson({ ...valid, headline: 'x'.repeat(61) })).toThrow();
    const { headline: _h, ...noHead } = valid;
    expect(() => validateLlmJson(noHead)).toThrow();
  });

  it('rejects missing or oversize narrative', () => {
    expect(() => validateLlmJson({ ...valid, narrative: '' })).toThrow();
    expect(() => validateLlmJson({ ...valid, narrative: 'x'.repeat(601) })).toThrow();
  });

  it('rejects unknown severity', () => {
    expect(() => validateLlmJson({ ...valid, severity: 'huge' })).toThrow();
  });

  it('rejects out-of-range confidence', () => {
    expect(() => validateLlmJson({ ...valid, confidence: -0.1 })).toThrow();
    expect(() => validateLlmJson({ ...valid, confidence: 1.1 })).toThrow();
    expect(() => validateLlmJson({ ...valid, confidence: 'high' })).toThrow();
  });
});

describe('parseLlmJson', () => {
  it('parses bare JSON', () => {
    expect(parseLlmJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips ```json fences', () => {
    expect(parseLlmJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('strips bare ``` fences', () => {
    expect(parseLlmJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('throws on malformed JSON', () => {
    expect(() => parseLlmJson('{not json')).toThrow();
  });
});
