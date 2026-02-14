/**
 * TimelineStepNode — A single step on the vertical timeline rail.
 *
 * Renders a status node circle connected by the rail line,
 * with domain icon, intent name, and expandable payload detail.
 * Default: collapsed (Decision Q3). Click to expand.
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 1.2
 */

import React from 'react';
import { SequenceStep, StepResult } from '../../types';
import {
  getIntentDomain,
  getIntentDomainIcon,
  getIntentDomainStyle,
  humanizeIntent,
} from '../../lib/intent-utils';
import {
  Check,
  X,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

export type StepStatus = 'pending' | 'active' | 'completed' | 'failed' | 'skipped';

interface TimelineStepNodeProps {
  step: SequenceStep;
  index: number;
  status: StepStatus;
  result?: StepResult;
  isExpanded: boolean;
  onToggle: () => void;
  isLast?: boolean;
}

/** CSS classes for the node circle by status. */
function getNodeClasses(status: StepStatus): string {
  switch (status) {
    case 'completed':
      return 'bg-green-500 border-green-500';
    case 'active':
      return 'bg-primary border-primary animate-pulse';
    case 'failed':
      return 'bg-destructive border-destructive';
    case 'skipped':
      return 'bg-transparent border-yellow-400';
    case 'pending':
    default:
      return 'bg-transparent border-muted-foreground/40';
  }
}

/** Inner icon for completed / failed nodes. */
function NodeIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'completed':
      return <Check className="w-2.5 h-2.5 text-white" />;
    case 'failed':
      return <X className="w-2.5 h-2.5 text-white" />;
    case 'skipped':
      return <AlertTriangle className="w-2 h-2 text-yellow-400" />;
    default:
      return null;
  }
}

/** Card glow for active step. */
function getCardClasses(status: StepStatus): string {
  switch (status) {
    case 'active':
      return 'border-primary/50 shadow-[0_0_8px_rgba(255,95,31,0.2)]';
    case 'completed':
      return 'border-green-500/30';
    case 'failed':
      return 'border-destructive/30 bg-destructive/5';
    case 'skipped':
      return 'border-yellow-400/30 opacity-70';
    case 'pending':
    default:
      return 'border-border opacity-60';
  }
}

export const TimelineStepNode: React.FC<TimelineStepNodeProps> = ({
  step,
  index,
  status,
  result,
  isExpanded,
  onToggle,
  isLast = false,
}) => {
  const domain = getIntentDomain(step.intent);
  const domainStyle = getIntentDomainStyle(domain);
  const DomainIcon = getIntentDomainIcon(domain);
  const label = step.metadata?.label ?? humanizeIntent(step.intent);
  const hasPayload = Object.keys(step.payload).length > 0;

  return (
    <div className="relative flex gap-3">
      {/* Rail line + node */}
      <div className="flex flex-col items-center shrink-0 w-6">
        {/* Node circle */}
        <div
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center z-10 mt-1 transition-all duration-300 ${getNodeClasses(status)}`}
        >
          <NodeIcon status={status} />
        </div>
        {/* Connector line to next step */}
        {!isLast && (
          <div
            className={`w-0.5 flex-1 mt-0 transition-colors duration-300 ${
              status === 'completed' ? 'bg-green-500/60' : 'bg-border'
            }`}
          />
        )}
      </div>

      {/* Step content card */}
      <div
        className={`flex-1 mb-3 rounded-lg border bg-background p-3 cursor-pointer transition-all duration-300 border-l-[3px] ${domainStyle.border} ${getCardClasses(status)}`}
        onClick={onToggle}
      >
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-jetbrains text-muted-foreground shrink-0">
              {index + 1}.
            </span>
            <DomainIcon className={`w-4 h-4 shrink-0 ${domainStyle.text}`} />
            <span className="text-sm font-medium text-foreground truncate">
              {label}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-2">
            {/* Duration badge */}
            {result && (
              <span className="text-[10px] font-jetbrains text-muted-foreground">
                {result.durationMs}ms
              </span>
            )}
            {/* Active spinner (inline) */}
            {status === 'active' && (
              <div className="w-3 h-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            )}
            {/* Expand / collapse chevron */}
            {hasPayload && (
              <span className="text-muted-foreground">
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </span>
            )}
          </div>
        </div>

        {/* Intent ID subtitle */}
        <div className="flex items-center gap-2 mt-1 ml-6">
          <span className={`text-[10px] font-jetbrains ${domainStyle.text} opacity-70`}>
            {step.intent}
          </span>
          {/* Variable reference indicator */}
          {Object.values(step.payload).some(
            (v) => typeof v === 'string' && v.includes('$var(')
          ) && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-yellow-500/10 text-yellow-400 font-bold">
              VAR
            </span>
          )}
        </div>

        {/* Expanded payload detail */}
        {isExpanded && hasPayload && (
          <div className="mt-3 ml-6 space-y-1 border-t border-border/50 pt-2">
            {Object.entries(step.payload).map(([key, value]) => (
              <div key={key} className="flex gap-2 text-xs">
                <span className="font-jetbrains text-secondary min-w-[100px] shrink-0">
                  {key}:
                </span>
                <span
                  className={`font-jetbrains break-all ${
                    typeof value === 'string' && value.includes('$var(')
                      ? 'text-yellow-400'
                      : 'text-foreground/80'
                  }`}
                >
                  {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
