/**
 * SequenceExecutionLog — Real-time step-by-step execution output.
 *
 * Displays a scrollable log of execution progress with status icons.
 *
 * See: documents/feature_sequence_executor_ux.md §4.3
 */

import React, { useRef, useEffect } from 'react';

interface SequenceExecutionLogProps {
  logs: string[];
  className?: string;
}

export const SequenceExecutionLog: React.FC<SequenceExecutionLogProps> = ({
  logs,
  className = '',
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  if (logs.length === 0) {
    return (
      <div className={`bg-black/30 rounded-lg p-4 ${className}`}>
        <p className="text-sm text-muted-foreground italic text-center font-jetbrains">
          Run a sequence to see output here
        </p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={`bg-black/30 rounded-lg p-4 overflow-y-auto max-h-64 ${className}`}
    >
      <div className="space-y-1">
        {logs.map((line, i) => (
          <div key={i} className="font-jetbrains text-xs leading-relaxed text-foreground/90">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
};
