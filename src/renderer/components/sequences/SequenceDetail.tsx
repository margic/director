/**
 * SequenceDetail — Right panel showing full sequence inspection and execution.
 *
 * Displays sequence metadata, step list, runtime variables form,
 * execution controls, and live execution log.
 *
 * See: documents/feature_sequence_executor_ux.md §4.3
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  PortableSequence,
  SequenceProgress,
  ExecutionResult,
  StepResult,
} from '../../types';
import { SequenceStepCard } from './SequenceStepCard';
import { TimelineRail } from './TimelineRail';
import { SequenceVariablesForm } from './SequenceVariablesForm';
import { SequenceExecutionLog } from './SequenceExecutionLog';
import {
  Play,
  Square,
  Copy,
  Trash2,
  Pencil,
  AlertTriangle,
  Clock,
  Tag,
  Layers,
} from 'lucide-react';

interface SequenceDetailProps {
  sequence: PortableSequence;
  onExecute: (id: string, variables: Record<string, unknown>, priority: boolean) => void;
  onCancel: () => void;
  onDelete?: (id: string) => void;
  onEdit?: (sequence: PortableSequence) => void;
  onExport?: (id: string) => void;
  isExecuting: boolean;
  currentProgress?: SequenceProgress | null;
  executionLogs: string[];
  lastResult?: ExecutionResult | null;
}

export const SequenceDetail: React.FC<SequenceDetailProps> = ({
  sequence,
  onExecute,
  onCancel,
  onDelete,
  onEdit,
  onExport,
  isExecuting,
  currentProgress,
  executionLogs,
  lastResult,
}) => {
  const [variables, setVariables] = useState<Record<string, unknown>>(() => {
    // Pre-populate defaults
    const defaults: Record<string, unknown> = {};
    for (const v of sequence.variables ?? []) {
      if (v.default !== undefined) {
        defaults[v.name] = v.default;
      }
    }
    return defaults;
  });
  const [priorityOverride, setPriorityOverride] = useState(sequence.priority ?? false);
  const [shakeError, setShakeError] = useState(false);

  // Trigger shake when execution fails
  useEffect(() => {
    if (lastResult && lastResult.sequenceId === sequence.id && lastResult.status === 'error') {
      setShakeError(true);
      const t = setTimeout(() => setShakeError(false), 500);
      return () => clearTimeout(t);
    }
  }, [lastResult, sequence.id]);

  // Reset variable defaults when sequence changes
  React.useEffect(() => {
    const defaults: Record<string, unknown> = {};
    for (const v of sequence.variables ?? []) {
      if (v.default !== undefined) {
        defaults[v.name] = v.default;
      }
    }
    setVariables(defaults);
    setPriorityOverride(sequence.priority ?? false);
  }, [sequence.id]);

  const handleExecute = useCallback(() => {
    // Check required variables
    const missing = (sequence.variables ?? []).filter(
      (v) => v.required && (variables[v.name] === undefined || variables[v.name] === '')
    );
    if (missing.length > 0) {
      setShakeError(true);
      setTimeout(() => setShakeError(false), 500);
      return;
    }
    onExecute(sequence.id, variables, priorityOverride);
  }, [onExecute, sequence.id, sequence.variables, variables, priorityOverride]);

  // Estimate duration
  let estimatedMs = 0;
  for (const step of sequence.steps) {
    if (step.intent === 'system.wait' && typeof step.payload.durationMs === 'number') {
      estimatedMs += step.payload.durationMs;
    }
  }

  // Build step results map from last execution
  const stepResultMap = new Map<string, StepResult>();
  if (lastResult && lastResult.sequenceId === sequence.id) {
    for (const sr of lastResult.steps) {
      stepResultMap.set(sr.stepId, sr);
    }
  }

  const hasVariables = (sequence.variables?.length ?? 0) > 0;
  const isCustom = sequence.category === 'custom';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h2 className="text-xl font-rajdhani font-bold uppercase tracking-wider text-white">
            {sequence.name ?? sequence.id}
          </h2>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            {sequence.version && (
              <span className="flex items-center gap-1">
                <Tag className="w-3 h-3" />
                v{sequence.version}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Layers className="w-3 h-3" />
              {sequence.steps.length} steps
            </span>
            {estimatedMs > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                ~{(estimatedMs / 1000).toFixed(0)}s
              </span>
            )}
            {sequence.category && (
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                sequence.category === 'builtin'
                  ? 'bg-secondary/10 text-secondary'
                  : sequence.category === 'cloud'
                    ? 'bg-primary/10 text-primary'
                    : 'bg-green-500/10 text-green-400'
              }`}>
                {sequence.category}
              </span>
            )}
          </div>
          {sequence.description && (
            <p className="text-sm text-muted-foreground mt-2">
              {sequence.description}
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 ml-4">
          {isCustom && onEdit && (
            <button
              onClick={() => onEdit(sequence)}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
              title="Edit sequence"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          {onExport && (
            <button
              onClick={() => onExport(sequence.id)}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
              title="Copy JSON to clipboard"
            >
              <Copy className="w-4 h-4" />
            </button>
          )}
          {isCustom && onDelete && (
            <button
              onClick={() => onDelete(sequence.id)}
              className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
              title="Delete sequence"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-2">
        {/* Steps — Vertical Timeline Rail */}
        <div>
          <h3 className="text-xs font-rajdhani uppercase tracking-widest text-muted-foreground font-bold mb-2">
            Steps
          </h3>
          <TimelineRail
            steps={sequence.steps}
            stepResultMap={stepResultMap}
            currentStepIndex={
              isExecuting && currentProgress?.sequenceId === sequence.id
                ? currentProgress.currentStep
                : undefined
            }
            isExecuting={isExecuting && currentProgress?.sequenceId === sequence.id}
            currentProgress={currentProgress}
          />
        </div>

        {/* Runtime Variables */}
        {hasVariables && (
          <div>
            <h3 className="text-xs font-rajdhani uppercase tracking-widest text-muted-foreground font-bold mb-2">
              Runtime Variables
            </h3>
            <SequenceVariablesForm
              variables={sequence.variables!}
              values={variables}
              onChange={setVariables}
              disabled={isExecuting}
            />
          </div>
        )}

        {/* Priority toggle */}
        <div className="flex items-center gap-3 px-3 py-2 bg-background border border-border rounded-lg">
          <label className="flex items-center gap-2 cursor-pointer flex-1">
            <input
              type="checkbox"
              checked={priorityOverride}
              onChange={(e) => setPriorityOverride(e.target.checked)}
              disabled={isExecuting}
              className="rounded border-border bg-card text-primary focus:ring-primary"
            />
            <span className="text-sm text-foreground font-rajdhani uppercase tracking-wider">
              Priority Execution
            </span>
          </label>
          {priorityOverride && (
            <span className="flex items-center gap-1 text-xs text-yellow-400">
              <AlertTriangle className="w-3 h-3" />
              Runs parallel — may conflict
            </span>
          )}
        </div>

        {/* Execute / Cancel button */}
        <div className="flex gap-2">
          {isExecuting && currentProgress?.sequenceId === sequence.id ? (
            <button
              onClick={onCancel}
              className="flex-1 py-3 rounded-lg font-bold flex items-center justify-center gap-2 bg-destructive text-white hover:bg-destructive/90 shadow-[0_0_20px_rgba(239,51,64,0.4)] transition-all"
            >
              <Square className="w-4 h-4 fill-current" />
              <span className="font-rajdhani uppercase tracking-wider">Cancel</span>
            </button>
          ) : (
            <button
              onClick={handleExecute}
              disabled={isExecuting}
              className={`flex-1 py-3 rounded-lg font-bold flex items-center justify-center gap-2 bg-primary text-black hover:bg-primary/90 shadow-[0_0_20px_rgba(255,95,31,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed ${shakeError ? 'animate-shake' : ''}`}
            >
              <Play className="w-4 h-4 fill-current" />
              <span className="font-rajdhani uppercase tracking-wider">Execute Sequence</span>
            </button>
          )}
        </div>

        {/* Execution Log */}
        <div>
          <h3 className="text-xs font-rajdhani uppercase tracking-widest text-muted-foreground font-bold mb-2">
            Execution Log
          </h3>
          <SequenceExecutionLog logs={executionLogs} />
        </div>
      </div>
    </div>
  );
};
