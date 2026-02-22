/**
 * SequenceStepCard — Visual representation of a single SequenceStep.
 *
 * Shows step number, domain icon, intent badge, payload key-value pairs,
 * domain-colored left border, and handler status indicator.
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 1.1
 */

import React from 'react';
import { SequenceStep, StepResult } from '../../types';
import { IntentDomainBadge } from './IntentBadge';
import {
  getIntentDomain,
  getIntentDomainIcon,
  getIntentDomainStyle,
} from '../../lib/intent-utils';
import { CheckCircle, AlertTriangle, XCircle, Loader2 } from 'lucide-react';

interface SequenceStepCardProps {
  step: SequenceStep;
  index: number;
  /** Execution result for this step (if sequence has been run) */
  result?: StepResult;
  /** Whether this step is currently executing */
  isRunning?: boolean;
}

export const SequenceStepCard: React.FC<SequenceStepCardProps> = ({
  step,
  index,
  result,
  isRunning = false,
}) => {
  const hasVarRef = Object.values(step.payload).some(
    (v) => typeof v === 'string' && v.includes('$var(')
  );

  const domain = getIntentDomain(step.intent);
  const domainStyle = getIntentDomainStyle(domain);
  const DomainIcon = getIntentDomainIcon(domain);

  return (
    <div className={`bg-background border border-border rounded-lg p-3 group hover:border-primary/30 transition-colors border-l-[3px] ${domainStyle.border}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-jetbrains text-muted-foreground w-6">
            {index + 1}.
          </span>
          <DomainIcon className={`w-4 h-4 ${domainStyle.text}`} />
          <span className="font-jetbrains text-sm text-foreground font-medium">
            {step.intent}
          </span>
          <IntentDomainBadge intent={step.intent} />
          {hasVarRef && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 font-bold">
              VAR
            </span>
          )}
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-1">
          {isRunning && <Loader2 className="w-4 h-4 text-primary animate-spin" />}
          {result?.status === 'success' && <CheckCircle className="w-4 h-4 text-green-400" />}
          {result?.status === 'skipped' && <AlertTriangle className="w-4 h-4 text-yellow-400" />}
          {result?.status === 'failed' && <XCircle className="w-4 h-4 text-destructive" />}
          {result && (
            <span className="text-[10px] font-jetbrains text-muted-foreground">
              {result.durationMs}ms
            </span>
          )}
        </div>
      </div>

      {/* Label */}
      {step.metadata?.label && (
        <p className="text-xs text-muted-foreground mb-2 ml-8">
          {step.metadata.label}
        </p>
      )}

      {/* Payload */}
      {Object.keys(step.payload).length > 0 && (
        <div className="ml-8 space-y-1">
          {Object.entries(step.payload).map(([key, value]) => (
            <div key={key} className="flex gap-2 text-xs">
              <span className="font-jetbrains text-secondary min-w-[100px] shrink-0">
                {key}:
              </span>
              <span className={`font-jetbrains break-all ${
                typeof value === 'string' && value.includes('$var(')
                  ? 'text-yellow-400'
                  : 'text-foreground/80'
              }`}>
                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
