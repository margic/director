/**
 * SequenceLibraryCard — Rich visual card for a sequence in the library list.
 *
 * Replaces the flat text list items with a structured card showing:
 * - Colored left strip (dominant domain)
 * - Title + category badge
 * - Domain icons + step count + duration estimate + variable count
 * - Step composition bar at the bottom
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 1.4
 */

import React, { useMemo } from 'react';
import { PortableSequence } from '../../types';
import { StepCompositionBar } from './StepCompositionBar';
import {
  getUniqueDomains,
  getIntentDomain,
  getIntentDomainIcon,
  getIntentDomainStyle,
  humanizeIntent,
} from '../../lib/intent-utils';
import { Clock, Variable } from 'lucide-react';

export interface SequenceLibraryCardProps {
  sequence: PortableSequence;
  isSelected: boolean;
  isExecuting: boolean;
  onClick: () => void;
}

const categoryBadge: Record<string, { label: string; className: string }> = {
  'builtin': { label: 'BUILT-IN', className: 'bg-secondary/20 text-secondary' },
  cloud: { label: 'CLOUD', className: 'bg-primary/20 text-primary' },
  custom: { label: 'CUSTOM', className: 'bg-green-500/20 text-green-400' },
};

export const SequenceLibraryCard: React.FC<SequenceLibraryCardProps> = ({
  sequence,
  isSelected,
  isExecuting,
  onClick,
}) => {
  // Determine dominant domain (most steps)
  const dominantDomain = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const step of sequence.steps) {
      const domain = getIntentDomain(step.intent);
      counts[domain] = (counts[domain] ?? 0) + 1;
    }
    let maxDomain = 'system';
    let maxCount = 0;
    for (const [domain, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxDomain = domain;
        maxCount = count;
      }
    }
    return maxDomain;
  }, [sequence.steps]);

  const dominantStyle = getIntentDomainStyle(dominantDomain);
  const domains = getUniqueDomains(sequence.steps);
  const badge = categoryBadge[sequence.category ?? 'custom'] ?? categoryBadge.custom;

  // Estimate duration from system.wait steps
  const durationLabel = useMemo(() => {
    let totalMs = 0;
    for (const step of sequence.steps) {
      if (step.intent === 'system.wait' && typeof step.payload.durationMs === 'number') {
        totalMs += step.payload.durationMs;
      }
    }
    if (totalMs === 0) return null;
    return `~${(totalMs / 1000).toFixed(0)}s`;
  }, [sequence.steps]);

  const varCount = sequence.variables?.length ?? 0;

  // Hover preview: first 3 step intents
  const hoverPreview = useMemo(() => {
    const preview = sequence.steps.slice(0, 3).map(
      (s, i) => `${i + 1}. ${humanizeIntent(s.intent)}`
    );
    if (sequence.steps.length > 3) {
      preview.push(`... +${sequence.steps.length - 3} more`);
    }
    return preview.join('\n');
  }, [sequence.steps]);

  return (
    <button
      onClick={onClick}
      title={hoverPreview}
      className={`w-full text-left rounded-lg overflow-hidden transition-all duration-200 group ${
        isSelected
          ? 'ring-1 ring-primary/50 bg-card/80'
          : 'hover:bg-white/5'
      } ${isExecuting ? 'ring-1 ring-primary/40' : ''}`}
    >
      <div className="flex">
        {/* Left color strip */}
        <div
          className={`w-[3px] shrink-0 ${dominantStyle.border.replace('border-', 'bg-').replace('/50', '')} ${
            isExecuting ? 'animate-pulse' : ''
          }`}
        />

        {/* Card content */}
        <div className="flex-1 px-3 py-2 min-w-0">
          {/* Title row */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-foreground truncate flex-1">
              {sequence.name ?? sequence.id}
            </span>
            <span
              className={`text-[9px] font-rajdhani font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${badge.className} shrink-0`}
            >
              {badge.label}
            </span>
          </div>

          {/* Info row: domain icons + step count + duration + vars */}
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-1.5">
            {/* Domain icons */}
            <div className="flex items-center gap-0.5 shrink-0">
              {domains.map((domain) => {
                const Icon = getIntentDomainIcon(domain);
                const style = getIntentDomainStyle(domain);
                return (
                  <span key={domain} title={style.label}>
                    <Icon className={`w-3 h-3 ${style.text}`} />
                  </span>
                );
              })}
            </div>

            <span className="text-muted-foreground/50">·</span>
            <span>{sequence.steps.length} steps</span>

            {durationLabel && (
              <>
                <span className="text-muted-foreground/50">·</span>
                <span className="flex items-center gap-0.5">
                  <Clock className="w-2.5 h-2.5" />
                  {durationLabel}
                </span>
              </>
            )}

            {varCount > 0 && (
              <span className="flex items-center gap-0.5 bg-yellow-500/10 text-yellow-400 px-1 rounded">
                <Variable className="w-2.5 h-2.5" />
                {varCount}
              </span>
            )}

            {/* Executing indicator */}
            {isExecuting && (
              <div className="ml-auto w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
            )}
          </div>

          {/* Composition bar */}
          <StepCompositionBar steps={sequence.steps} />
        </div>
      </div>
    </button>
  );
};
