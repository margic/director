/**
 * Unit tests for director-types
 *
 * Validates the PortableSequence type structures are correct.
 * Legacy normalization functions have been removed — see normalizer.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  PortableSequence,
  SequenceStep,
  SequenceVariable,
} from './director-types';

describe('PortableSequence type contracts', () => {
  it('should accept a minimal PortableSequence', () => {
    const seq: PortableSequence = {
      id: 'test-seq-1',
      steps: [
        {
          id: 'step-1',
          intent: 'system.wait',
          payload: { durationMs: 1000 },
        },
      ],
    };

    expect(seq.id).toBe('test-seq-1');
    expect(seq.steps).toHaveLength(1);
    expect(seq.steps[0].intent).toBe('system.wait');
  });

  it('should accept a full PortableSequence with all optional fields', () => {
    const seq: PortableSequence = {
      id: 'full-seq',
      name: 'Full Sequence',
      version: '1.0.0',
      description: 'A fully-populated sequence',
      category: 'builtin',
      priority: true,
      variables: [
        {
          name: 'targetDriver',
          label: 'Target Driver',
          type: 'text',
          required: true,
        },
      ],
      steps: [
        {
          id: 'step-1',
          intent: 'broadcast.showLiveCam',
          payload: { carNum: '42', camGroup: 1 },
          metadata: { label: 'Show driver camera', timeout: 5000 },
        },
      ],
      metadata: { source: 'ai-director', totalDurationMs: 15000 },
    };

    expect(seq.name).toBe('Full Sequence');
    expect(seq.priority).toBe(true);
    expect(seq.variables).toHaveLength(1);
    expect(seq.steps[0].metadata?.label).toBe('Show driver camera');
  });

  it('should support all category values', () => {
    const categories: PortableSequence['category'][] = ['builtin', 'cloud', 'custom'];
    categories.forEach((cat) => {
      const seq: PortableSequence = { id: `cat-${cat}`, steps: [], category: cat };
      expect(seq.category).toBe(cat);
    });
  });

  it('should support variable types', () => {
    const variable: SequenceVariable = {
      name: 'delay',
      label: 'Delay Time',
      type: 'number',
      required: false,
      default: 5000,
      constraints: { min: 1000, max: 30000 },
    };

    expect(variable.type).toBe('number');
    expect(variable.constraints?.min).toBe(1000);
  });
});
