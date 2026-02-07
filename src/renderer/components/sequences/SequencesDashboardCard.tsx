/**
 * SequencesDashboardCard — Dashboard widget for the Sequence Executor.
 *
 * Shows executor status, last execution info, and sequence count.
 * Follows the same h-64 card pattern as other extension widgets.
 *
 * See: documents/feature_sequence_executor_ux.md §3.2
 */

import React, { useState, useEffect } from 'react';
import { Zap, Loader2 } from 'lucide-react';
import { SequenceProgress, PortableSequence, ExecutionResult } from '../../types';

interface SequencesDashboardCardProps {
  onClick: () => void;
}

export const SequencesDashboardCard: React.FC<SequencesDashboardCardProps> = ({ onClick }) => {
  const [sequences, setSequences] = useState<PortableSequence[]>([]);
  const [intentCount, setIntentCount] = useState(0);
  const [lastResult, setLastResult] = useState<ExecutionResult | null>(null);
  const [currentProgress, setCurrentProgress] = useState<SequenceProgress | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!window.electronAPI?.sequences) return;
      try {
        const [seqs, history, intents] = await Promise.all([
          window.electronAPI.sequences.list(),
          window.electronAPI.sequences.history(),
          window.electronAPI.catalog.intents(),
        ]);
        setSequences(seqs);
        setIntentCount(intents.length);
        if (history.length > 0) {
          setLastResult(history[history.length - 1]);
        }
      } catch (e) {
        console.error('Failed to load sequence data', e);
      }
    };

    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  // Subscribe to progress events
  useEffect(() => {
    if (!window.electronAPI?.sequences?.onProgress) return;
    const unsubscribe = window.electronAPI.sequences.onProgress((progress) => {
      setCurrentProgress(progress);
      // Clear progress when sequence ends
      if (progress.stepIntent === 'sequence.end') {
        setTimeout(() => setCurrentProgress(null), 3000);
      }
    });
    return unsubscribe;
  }, []);

  const isExecuting = currentProgress !== null && currentProgress.stepIntent !== 'sequence.end';
  const hasError = lastResult?.status === 'failed' || lastResult?.status === 'partial';
  const isEmpty = sequences.length === 0;

  // Status dot color
  let dotColor = 'bg-muted-foreground/40'; // Idle
  let statusText = 'READY';
  if (isExecuting) {
    dotColor = 'bg-primary animate-pulse';
    statusText = 'EXECUTING';
  } else if (hasError) {
    dotColor = 'bg-destructive';
    statusText = 'LAST RUN FAILED';
  } else if (isEmpty) {
    dotColor = 'bg-yellow-500';
    statusText = 'NO SEQUENCES';
  }

  return (
    <div
      className="bg-card border border-border rounded-xl p-6 h-64 flex flex-col justify-between hover:border-primary/50 transition-colors group relative overflow-hidden cursor-pointer"
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex justify-between items-center z-10">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          <h3 className="text-muted-foreground text-sm font-bold uppercase tracking-wider font-rajdhani">
            Sequence Executor
          </h3>
        </div>
        <div className={`w-3 h-3 rounded-full ${dotColor}`} />
      </div>

      {/* Body */}
      <div className="z-10">
        <div className="text-2xl font-jetbrains font-bold text-white mb-1">
          {statusText}
        </div>
        <div className="text-xs text-muted-foreground font-rajdhani">
          {isExecuting ? (
            <span className="flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Step {currentProgress!.currentStep}/{currentProgress!.totalSteps}: {currentProgress!.stepIntent}
            </span>
          ) : lastResult ? (
            <span>{lastResult.sequenceName} · {lastResult.status}</span>
          ) : (
            <span>{sequences.length} sequences · {intentCount} intents</span>
          )}
        </div>
      </div>

      {/* Footer */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="z-10 w-full py-3 rounded-lg font-bold flex items-center justify-center gap-2 bg-primary text-black hover:bg-primary/90 shadow-[0_0_20px_rgba(255,95,31,0.4)] transition-all"
      >
        <Zap className="w-4 h-4" />
        <span className="font-rajdhani uppercase tracking-wider">Open Sequences</span>
      </button>

      {/* Background effect during execution */}
      {isExecuting && (
        <div className="absolute inset-0 bg-primary/5 animate-pulse pointer-events-none" />
      )}
    </div>
  );
};
