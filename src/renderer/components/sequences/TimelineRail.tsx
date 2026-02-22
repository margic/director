/**
 * TimelineRail — Connected vertical timeline for sequence steps.
 *
 * Replaces the flat space-y-2 step list in SequenceDetail with a
 * visually linked timeline showing execution state per step.
 * Includes a global progress bar at the bottom during execution.
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 1.2
 */

import React, { useState, useEffect, useRef } from 'react';
import { SequenceStep, StepResult, SequenceProgress } from '../../types';
import { TimelineStepNode, StepStatus } from './TimelineStepNode';

interface TimelineRailProps {
  steps: SequenceStep[];
  /** Map of stepId → StepResult from last execution. */
  stepResultMap: Map<string, StepResult>;
  /** 1-indexed current step number from progress events. */
  currentStepIndex?: number;
  /** Whether a sequence is currently executing. */
  isExecuting: boolean;
  /** Current progress event. */
  currentProgress?: SequenceProgress | null;
}

/** Derive the visual status for a step given execution context. */
function deriveStepStatus(
  stepIndex: number,
  step: SequenceStep,
  stepResultMap: Map<string, StepResult>,
  currentStepIndex: number | undefined,
  isExecuting: boolean,
): StepStatus {
  // If we have a result for this step, use it
  const result = stepResultMap.get(step.id);
  if (result) {
    switch (result.status) {
      case 'success':
        return 'completed';
      case 'failed':
        return 'failed';
      case 'skipped':
        return 'skipped';
    }
  }

  // During execution, check position relative to current step
  if (isExecuting && currentStepIndex !== undefined) {
    const oneIndexed = stepIndex + 1;
    if (oneIndexed === currentStepIndex) return 'active';
    if (oneIndexed < currentStepIndex) return 'completed';
  }

  return 'pending';
}

export const TimelineRail: React.FC<TimelineRailProps> = ({
  steps,
  stepResultMap,
  currentStepIndex,
  isExecuting,
  currentProgress,
}) => {
  // All steps collapsed by default (Decision Q3)
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  // Elapsed time tracker
  const [elapsedMs, setElapsedMs] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isExecuting && !startTimeRef.current) {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        if (startTimeRef.current) {
          setElapsedMs(Date.now() - startTimeRef.current);
        }
      }, 100);
    } else if (!isExecuting) {
      startTimeRef.current = null;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      // Don't reset elapsedMs — keep last value visible until next run
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isExecuting]);

  // Reset elapsed when a new execution starts
  useEffect(() => {
    if (isExecuting && currentStepIndex === 1) {
      setElapsedMs(0);
      startTimeRef.current = Date.now();
    }
  }, [isExecuting, currentStepIndex]);

  const toggleStep = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

  // Progress percentage
  const progressPercent = isExecuting && currentStepIndex && steps.length > 0
    ? Math.round(((currentStepIndex - 1) / steps.length) * 100)
    : stepResultMap.size > 0
      ? Math.round((stepResultMap.size / steps.length) * 100)
      : 0;

  // Estimate remaining time
  const estimatedTotalMs = isExecuting && currentStepIndex && currentStepIndex > 1
    ? (elapsedMs / (currentStepIndex - 1)) * steps.length
    : 0;
  const remainingMs = Math.max(0, estimatedTotalMs - elapsedMs);

  return (
    <div className="flex flex-col">
      {/* Timeline steps */}
      <div className="relative">
        {steps.map((step, i) => {
          const status = deriveStepStatus(i, step, stepResultMap, currentStepIndex, isExecuting);
          return (
            <TimelineStepNode
              key={step.id}
              step={step}
              index={i}
              status={status}
              result={stepResultMap.get(step.id)}
              isExpanded={expandedSteps.has(step.id)}
              onToggle={() => toggleStep(step.id)}
              isLast={i === steps.length - 1}
            />
          );
        })}
      </div>

      {/* Progress bar — shown during or after execution */}
      {(isExecuting || stepResultMap.size > 0) && (
        <div className="mt-2 px-1">
          {/* Bar */}
          <div className="h-1.5 bg-border rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                isExecuting ? 'bg-primary' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(100, progressPercent)}%` }}
            />
          </div>
          {/* Labels */}
          <div className="flex items-center justify-between mt-1 text-[10px] font-jetbrains text-muted-foreground">
            <span>
              {isExecuting && currentStepIndex
                ? `Step ${currentStepIndex}/${steps.length}`
                : `${stepResultMap.size}/${steps.length} completed`}
            </span>
            <span>
              {isExecuting ? (
                <>
                  {(elapsedMs / 1000).toFixed(1)}s elapsed
                  {remainingMs > 0 && ` · ~${(remainingMs / 1000).toFixed(0)}s remaining`}
                </>
              ) : (
                `${progressPercent}%`
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
