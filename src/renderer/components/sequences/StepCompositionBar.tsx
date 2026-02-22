/**
 * StepCompositionBar — Horizontal domain composition bar.
 *
 * Renders a thin bar showing the proportion of steps per domain,
 * similar to GitHub's language bar. Each segment is colored by domain.
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 1.4
 */

import React, { useMemo } from 'react';
import { SequenceStep } from '../../types';
import { getIntentDomain, getIntentDomainStyle } from '../../lib/intent-utils';

export interface StepCompositionBarProps {
  steps: SequenceStep[];
}

interface Segment {
  domain: string;
  count: number;
  percentage: number;
  bgColor: string;
  label: string;
}

export const StepCompositionBar: React.FC<StepCompositionBarProps> = ({ steps }) => {
  const segments = useMemo((): Segment[] => {
    if (steps.length === 0) return [];

    const counts: Record<string, number> = {};
    for (const step of steps) {
      const domain = getIntentDomain(step.intent);
      counts[domain] = (counts[domain] ?? 0) + 1;
    }

    // Sort by count descending so dominant domain is first
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .map(([domain, count]) => {
        const style = getIntentDomainStyle(domain);
        return {
          domain,
          count,
          percentage: (count / steps.length) * 100,
          bgColor: style.bg,
          label: style.label,
        };
      });
  }, [steps]);

  if (segments.length === 0) return null;

  // Minimum visible width for very small segments
  const MIN_WIDTH_PX = 8;

  return (
    <div className="w-full h-[3px] rounded-full overflow-hidden flex" title={
      segments.map((s) => `${s.label}: ${s.count} step${s.count !== 1 ? 's' : ''}`).join(', ')
    }>
      {segments.map((seg) => (
        <div
          key={seg.domain}
          className={`h-full ${seg.bgColor}`}
          style={{
            width: `${seg.percentage}%`,
            minWidth: `${MIN_WIDTH_PX}px`,
          }}
        />
      ))}
    </div>
  );
};
