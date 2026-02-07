/**
 * SequenceExecutionHistory — In-memory ring buffer history list.
 *
 * Displays the last N execution results with status, timing, and
 * click-to-inspect functionality.
 *
 * See: documents/feature_sequence_executor_ux.md §8.5
 */

import React from 'react';
import { ExecutionResult } from '../../types';
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Ban,
  Clock,
} from 'lucide-react';

interface SequenceExecutionHistoryProps {
  history: ExecutionResult[];
  onSelect?: (result: ExecutionResult) => void;
  selectedId?: string;
}

const statusConfig: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  completed: { icon: CheckCircle, color: 'text-green-400', label: 'COMPLETED' },
  partial: { icon: AlertTriangle, color: 'text-yellow-400', label: 'PARTIAL' },
  failed: { icon: XCircle, color: 'text-destructive', label: 'FAILED' },
  cancelled: { icon: Ban, color: 'text-muted-foreground', label: 'CANCELLED' },
};

export const SequenceExecutionHistory: React.FC<SequenceExecutionHistoryProps> = ({
  history,
  onSelect,
  selectedId,
}) => {
  if (history.length === 0) {
    return (
      <div className="text-center py-4 text-sm text-muted-foreground italic">
        No executions yet
      </div>
    );
  }

  // Most recent first
  const sorted = [...history].reverse();

  return (
    <div className="space-y-1">
      {sorted.map((result) => {
        const config = statusConfig[result.status] ?? statusConfig.failed;
        const StatusIcon = config.icon;
        const isSelected = result.executionId === selectedId;

        return (
          <button
            key={result.executionId}
            onClick={() => onSelect?.(result)}
            className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center gap-3 ${
              isSelected
                ? 'bg-primary/10 border border-primary/30'
                : 'hover:bg-white/5 border border-transparent'
            }`}
          >
            <StatusIcon className={`w-4 h-4 shrink-0 ${config.color}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground truncate">
                  {result.sequenceName}
                </span>
                {result.priority && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary font-bold">
                    PRI
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span className="font-jetbrains">
                  {(result.totalDurationMs / 1000).toFixed(1)}s
                </span>
                <span>·</span>
                <span>
                  {result.steps.filter((s) => s.status === 'success').length}/{result.steps.length} steps
                </span>
                <span>·</span>
                <span>{result.source}</span>
              </div>
            </div>
            <span className={`text-[10px] font-bold uppercase ${config.color}`}>
              {config.label}
            </span>
          </button>
        );
      })}
    </div>
  );
};
