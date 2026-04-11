/**
 * SequenceLiveView — Read-only real-time sequence execution view.
 *
 * Mirrors SequenceDetail's layout but is driven entirely by live
 * SequenceProgress events. Shows the executing sequence's steps via
 * TimelineRail with live status coloring, streaming logs, and a
 * calm idle state when nothing is running.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  PortableSequence,
  SequenceProgress,
  ExecutionResult,
  StepResult,
} from '../../types';
import { TimelineRail } from './TimelineRail';
import { SequenceExecutionLog } from './SequenceExecutionLog';
import { ExecutionProgressBar } from './ExecutionProgressBar';
import { SequenceExecutionHistory } from './SequenceExecutionHistory';
import {
  Zap,
  Loader2,
  Tag,
  Layers,
  Clock,
  History,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

export const SequenceLiveView: React.FC = () => {
  // Sequence data
  const [sequences, setSequences] = useState<PortableSequence[]>([]);
  const [executingSequence, setExecutingSequence] = useState<PortableSequence | null>(null);
  const [history, setHistory] = useState<ExecutionResult[]>([]);

  // Execution state
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentProgress, setCurrentProgress] = useState<SequenceProgress | null>(null);
  const [executionLogs, setExecutionLogs] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<ExecutionResult | null>(null);
  const [executingSequenceId, setExecutingSequenceId] = useState<string | null>(null);

  // UI state
  const [showHistory, setShowHistory] = useState(false);

  // Keep sequences ref in sync for lookup inside the progress callback
  const sequencesRef = useRef<PortableSequence[]>([]);
  sequencesRef.current = sequences;

  // Keep executingSequence ref in sync for use in loadData
  const executingSequenceRef = useRef<PortableSequence | null>(null);
  executingSequenceRef.current = executingSequence;

  // Load available sequences + history; show last execution if available
  const loadData = useCallback(async () => {
    if (!window.electronAPI?.sequences) return;
    try {
      const [seqs, hist] = await Promise.all([
        window.electronAPI.sequences.list(),
        window.electronAPI.sequences.history(),
      ]);
      setSequences(seqs);
      setHistory(hist);

      // If no sequence is currently displayed, restore the most recent execution
      if (!executingSequenceRef.current && hist.length > 0) {
        const lastExec = hist[hist.length - 1];
        // Try library first, then scheduler
        let seq = seqs.find((s) => s.id === lastExec.sequenceId) ?? null;
        if (!seq) {
          seq = await window.electronAPI.sequences.getExecuting(lastExec.sequenceId);
        }
        if (seq) {
          setExecutingSequence(seq);
          setExecutingSequenceId(lastExec.sequenceId);
          setLastResult(lastExec);
          setExecutionLogs(
            lastExec.steps.map((s) => {
              const icon = s.status === 'success' ? '✅' : s.status === 'skipped' ? '⚠️' : '❌';
              return `${icon} ${s.intent} (${s.durationMs}ms)${s.message ? ` — ${s.message}` : ''}`;
            })
          );
        }
      }
    } catch (e) {
      console.error('Failed to load sequence data:', e);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Subscribe to execution progress
  useEffect(() => {
    if (!window.electronAPI?.sequences?.onProgress) return;
    const unsubscribe = window.electronAPI.sequences.onProgress((progress) => {
      setCurrentProgress(progress);
      setExecutionLogs((prev) => [...prev, progress.log]);

      if (progress.stepStatus === 'running' && progress.stepIntent === 'sequence.start') {
        setIsExecuting(true);
        setExecutingSequenceId(progress.sequenceId);
        setExecutionLogs([progress.log]);
        setLastResult(null);
        // Look up the sequence in library first
        const seq = sequencesRef.current.find((s) => s.id === progress.sequenceId);
        if (seq) {
          setExecutingSequence(seq);
        } else {
          // Sequence not in library (e.g. agent/cloud generated) — fetch from scheduler
          window.electronAPI.sequences.getExecuting(progress.sequenceId)
            .then((fetched) => {
              if (fetched) setExecutingSequence(fetched);
            })
            .catch(console.error);
        }
      }

      if (progress.stepIntent === 'sequence.end') {
        setIsExecuting(false);
        // Refresh history and set lastResult for step-level status
        window.electronAPI.sequences.history().then((hist) => {
          setHistory(hist);
          const match = hist.find((h) => h.sequenceId === progress.sequenceId);
          if (match) setLastResult(match);
        }).catch(console.error);
      }
    });
    return unsubscribe;
  }, []);

  // Build step results map from last execution
  const stepResultMap = new Map<string, StepResult>();
  if (lastResult && executingSequence && lastResult.sequenceId === executingSequence.id) {
    for (const sr of lastResult.steps) {
      stepResultMap.set(sr.stepId, sr);
    }
  }

  // View a historical result
  const handleHistorySelect = useCallback(
    async (result: ExecutionResult) => {
      // Try library first, then scheduler (agent sequences aren't in library)
      let seq = sequences.find((s) => s.id === result.sequenceId) ?? null;
      if (!seq) {
        seq = await window.electronAPI.sequences.getExecuting(result.sequenceId).catch(() => null);
      }
      if (seq) {
        setExecutingSequence(seq);
        setExecutingSequenceId(result.sequenceId);
        setIsExecuting(false);
        setCurrentProgress(null);
        setExecutionLogs(
          result.steps.map((s) => {
            const icon = s.status === 'success' ? '✅' : s.status === 'skipped' ? '⚠️' : '❌';
            return `${icon} ${s.intent} (${s.durationMs}ms)${s.message ? ` — ${s.message}` : ''}`;
          })
        );
        setLastResult(result);
      }
    },
    [sequences]
  );

  // Estimate duration
  let estimatedMs = 0;
  if (executingSequence) {
    for (const step of executingSequence.steps) {
      if (step.intent === 'system.wait' && typeof step.payload.durationMs === 'number') {
        estimatedMs += step.payload.durationMs;
      }
    }
  }

  return (
    <div className="w-full h-full flex flex-col">
      {/* Execution Progress Bar */}
      <ExecutionProgressBar
        progress={currentProgress}
        isExecuting={isExecuting}
        sequenceName={executingSequence?.name}
      />

      <div className="flex-1 bg-card border border-border rounded-xl flex flex-col overflow-hidden p-6 min-h-0">
        {executingSequence ? (
          <div className="flex flex-col h-full animate-in fade-in duration-200">
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-rajdhani font-bold uppercase tracking-wider text-white">
                    {executingSequence.name ?? executingSequence.id}
                  </h2>
                  {isExecuting ? (
                    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-bold uppercase animate-pulse">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Live
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 text-xs font-bold uppercase">
                      Complete
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  {executingSequence.version && (
                    <span className="flex items-center gap-1">
                      <Tag className="w-3 h-3" />
                      v{executingSequence.version}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Layers className="w-3 h-3" />
                    {executingSequence.steps.length} steps
                  </span>
                  {estimatedMs > 0 && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      ~{(estimatedMs / 1000).toFixed(0)}s
                    </span>
                  )}
                  {executingSequence.category && (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                        executingSequence.category === 'builtin'
                          ? 'bg-secondary/10 text-secondary'
                          : executingSequence.category === 'cloud'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-green-500/10 text-green-400'
                      }`}
                    >
                      {executingSequence.category}
                    </span>
                  )}
                </div>
                {executingSequence.description && (
                  <p className="text-sm text-muted-foreground mt-2">
                    {executingSequence.description}
                  </p>
                )}
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-2">
              {/* Steps — Live Timeline Rail */}
              <div>
                <h3 className="text-xs font-rajdhani uppercase tracking-widest text-muted-foreground font-bold mb-2">
                  Steps
                </h3>
                <TimelineRail
                  steps={executingSequence.steps}
                  stepResultMap={stepResultMap}
                  currentStepIndex={
                    isExecuting && currentProgress?.sequenceId === executingSequence.id
                      ? currentProgress.currentStep
                      : executingSequence.steps.length
                  }
                  isExecuting={isExecuting && currentProgress?.sequenceId === executingSequence.id}
                  currentProgress={currentProgress}
                />
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
        ) : (
          /* Idle state */
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <div className="relative mb-6">
              <Zap className="w-16 h-16 opacity-10" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-3 h-3 rounded-full bg-muted-foreground/20 animate-pulse" />
              </div>
            </div>
            <p className="text-sm font-rajdhani uppercase tracking-wider">
              Waiting for sequence execution
            </p>
            <p className="text-xs mt-1 opacity-60">
              Start a sequence from the Editor or let the Agent run one
            </p>
          </div>
        )}

        {/* Execution History */}
        <div className="border-t border-border mt-4 pt-3">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-2 text-xs font-rajdhani uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            {showHistory ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            <History className="w-3.5 h-3.5" />
            Execution History ({history.length})
          </button>
          {showHistory && (
            <div className="mt-2 max-h-48 overflow-y-auto">
              <SequenceExecutionHistory
                history={history}
                onSelect={handleHistorySelect}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
