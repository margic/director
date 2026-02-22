/**
 * ExecutionProgressBar — Horizontal progress bar for the Sequences panel header.
 *
 * Renders between the panel title and the two-column content during execution.
 * Shows sequence info, step progress, percentage bar, and elapsed time.
 * Animates in/out based on execution state.
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 1.3
 */

import React, { useState, useEffect, useRef } from 'react';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { SequenceProgress } from '../../types';

export interface ExecutionProgressBarProps {
  /** Current execution progress (null when idle) */
  progress: SequenceProgress | null;
  /** Whether a sequence is currently executing */
  isExecuting: boolean;
  /** Name of the currently executing sequence */
  sequenceName?: string;
}

export const ExecutionProgressBar: React.FC<ExecutionProgressBarProps> = ({
  progress,
  isExecuting,
  sequenceName,
}) => {
  const [elapsed, setElapsed] = useState(0);
  const [visible, setVisible] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Manage visibility with a slight delay for smooth animation
  useEffect(() => {
    if (isExecuting) {
      setVisible(true);
    } else {
      // Keep visible briefly after completion so the user sees 100%
      const timeout = setTimeout(() => setVisible(false), 2000);
      return () => clearTimeout(timeout);
    }
  }, [isExecuting]);

  // Elapsed timer
  useEffect(() => {
    if (isExecuting) {
      startTimeRef.current = Date.now();
      setElapsed(0);
      intervalRef.current = setInterval(() => {
        if (startTimeRef.current) {
          setElapsed(Date.now() - startTimeRef.current);
        }
      }, 100);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isExecuting]);

  if (!visible && !isExecuting) return null;

  const percentage =
    progress && progress.totalSteps > 0
      ? Math.round((progress.currentStep / progress.totalSteps) * 100)
      : 0;

  const elapsedSec = (elapsed / 1000).toFixed(1);
  const isComplete = !isExecuting && progress !== null;
  const isFailed = progress?.stepStatus === 'failed';

  return (
    <div
      className={`mb-3 rounded-lg border overflow-hidden transition-all duration-500 ${
        visible ? 'opacity-100 max-h-24' : 'opacity-0 max-h-0'
      } ${
        isFailed
          ? 'border-destructive/50 bg-destructive/5'
          : isComplete
            ? 'border-green-500/50 bg-green-500/5'
            : 'border-primary/30 bg-primary/5'
      }`}
    >
      <div className="px-4 py-2 flex items-center justify-between gap-4">
        {/* Left: status icon + info */}
        <div className="flex items-center gap-3 min-w-0">
          {isExecuting ? (
            <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
          ) : isFailed ? (
            <XCircle className="w-4 h-4 text-destructive shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-xs font-rajdhani font-bold uppercase tracking-wider text-foreground truncate">
              {sequenceName ?? progress?.sequenceId ?? 'Executing…'}
            </div>
            <div className="text-[10px] font-jetbrains text-muted-foreground">
              {progress
                ? `Step ${progress.currentStep}/${progress.totalSteps} · ${progress.stepIntent}`
                : 'Preparing…'}
            </div>
          </div>
        </div>

        {/* Right: elapsed + percentage */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[10px] font-jetbrains text-muted-foreground">
            {elapsedSec}s
          </span>
          <span className="text-xs font-jetbrains font-bold text-foreground w-10 text-right">
            {percentage}%
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-border">
        <div
          className={`h-full transition-[width] duration-500 ease-out ${
            isFailed ? 'bg-destructive' : isComplete ? 'bg-green-500' : 'bg-primary'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};
