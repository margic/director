/**
 * SequencesPanel — Full panel view for the Sequence Executor.
 *
 * Two-column layout: Library (left) + Detail/Builder (right).
 * Manages sequence selection, execution, and history state.
 *
 * See: documents/feature_sequence_executor_ux.md §3.3
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  PortableSequence,
  IntentCatalogEntry,
  EventCatalogEntry,
  SequenceProgress,
  ExecutionResult,
} from '../types';
import { SequenceLibrary } from '../components/sequences/SequenceLibrary';
import { SequenceDetail } from '../components/sequences/SequenceDetail';
import { SequenceBuilder } from '../components/sequences/SequenceBuilder';
import { SequenceExecutionHistory } from '../components/sequences/SequenceExecutionHistory';
import { ExecutionProgressBar } from '../components/sequences/ExecutionProgressBar';
import { Zap, History, ChevronDown, ChevronRight } from 'lucide-react';
import { useSetPageHeader } from '../contexts/PageHeaderContext';

export const SequencesPanel: React.FC = () => {
  // Data state
  const [sequences, setSequences] = useState<PortableSequence[]>([]);
  const [intents, setIntents] = useState<IntentCatalogEntry[]>([]);
  const [events, setEvents] = useState<EventCatalogEntry[]>([]);
  const [history, setHistory] = useState<ExecutionResult[]>([]);

  // UI state
  const [selectedSequence, setSelectedSequence] = useState<PortableSequence | null>(null);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [editingSequence, setEditingSequence] = useState<PortableSequence | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedHistoryResult, setSelectedHistoryResult] = useState<ExecutionResult | null>(null);

  // Execution state
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentProgress, setCurrentProgress] = useState<SequenceProgress | null>(null);
  const [executionLogs, setExecutionLogs] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<ExecutionResult | null>(null);
  const [executingSequenceId, setExecutingSequenceId] = useState<string | null>(null);
  const [successFlash, setSuccessFlash] = useState(false);

  // Push header into the global app bar
  useSetPageHeader({
    title: 'Sequence Executor',
    icon: Zap,
    subtitle: sequences.length || intents.length
      ? `${sequences.length} sequences \u00b7 ${intents.length} intents`
      : undefined,
  });

  // Load data
  const loadData = useCallback(async () => {
    if (!window.electronAPI?.sequences) return;
    try {
      const [seqs, catalogIntents, catalogEvents, hist] = await Promise.all([
        window.electronAPI.sequences.list(),
        window.electronAPI.catalog.intents(),
        window.electronAPI.catalog.events(),
        window.electronAPI.sequences.history(),
      ]);
      setSequences(seqs);
      setIntents(catalogIntents);
      setEvents(catalogEvents);
      setHistory(hist);
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
      }

      if (progress.stepIntent === 'sequence.end') {
        setIsExecuting(false);
        setExecutingSequenceId(null);
        // Trigger success flash
        setSuccessFlash(true);
        setTimeout(() => setSuccessFlash(false), 800);
        // Refresh history
        window.electronAPI.sequences.history().then(setHistory).catch(console.error);
      }
    });
    return unsubscribe;
  }, []);

  // Handlers
  const handleSelectSequence = useCallback((seq: PortableSequence) => {
    setSelectedSequence(seq);
    setIsBuilderOpen(false);
    setEditingSequence(null);
    setExecutionLogs([]);
    setLastResult(null);
  }, []);

  const handleExecute = useCallback(
    async (id: string, variables: Record<string, unknown>, priority: boolean) => {
      if (!window.electronAPI?.sequences) return;
      try {
        setExecutionLogs([]);
        setLastResult(null);
        await window.electronAPI.sequences.execute(id, variables, { priority, source: 'manual' });
      } catch (e: any) {
        setExecutionLogs((prev) => [...prev, `❌ Execution failed: ${e.message}`]);
        setIsExecuting(false);
      }
    },
    []
  );

  const handleCancel = useCallback(async () => {
    if (!window.electronAPI?.sequences) return;
    try {
      await window.electronAPI.sequences.cancel();
    } catch (e) {
      console.error('Cancel failed:', e);
    }
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.electronAPI?.sequences) return;
      try {
        await window.electronAPI.sequences.delete(id);
        if (selectedSequence?.id === id) {
          setSelectedSequence(null);
        }
        await loadData();
      } catch (e) {
        console.error('Delete failed:', e);
      }
    },
    [selectedSequence, loadData]
  );

  const handleExport = useCallback(async (id: string) => {
    if (!window.electronAPI?.sequences) return;
    try {
      const json = await window.electronAPI.sequences.export(id);
      await navigator.clipboard.writeText(json);
    } catch (e) {
      console.error('Export failed:', e);
    }
  }, []);

  const handleCreateNew = useCallback(() => {
    setIsBuilderOpen(true);
    setEditingSequence(null);
    setSelectedSequence(null);
  }, []);

  const handleEdit = useCallback((seq: PortableSequence) => {
    setIsBuilderOpen(true);
    setEditingSequence(seq);
  }, []);

  const handleBuilderSave = useCallback(
    async (seq: PortableSequence) => {
      if (!window.electronAPI?.sequences) return;
      try {
        await window.electronAPI.sequences.save(seq);
        setIsBuilderOpen(false);
        setEditingSequence(null);
        await loadData();
        // Select the saved sequence
        setSelectedSequence(seq);
      } catch (e) {
        console.error('Save failed:', e);
      }
    },
    [loadData]
  );

  const handleBuilderCancel = useCallback(() => {
    setIsBuilderOpen(false);
    setEditingSequence(null);
  }, []);

  const handleHistorySelect = useCallback(
    (result: ExecutionResult) => {
      setSelectedHistoryResult(result);
      // Find and select the sequence
      const seq = sequences.find((s) => s.id === result.sequenceId);
      if (seq) {
        setSelectedSequence(seq);
        setIsBuilderOpen(false);
        setExecutionLogs(result.steps.map((s) => {
          const icon = s.status === 'success' ? '✅' : s.status === 'skipped' ? '⚠️' : '❌';
          return `${icon} ${s.intent} (${s.durationMs}ms)${s.message ? ` — ${s.message}` : ''}`;
        }));
        setLastResult(result);
      }
    },
    [sequences]
  );

  return (
    <div className="w-full h-full flex flex-col">
      {/* Execution Progress Bar */}
      <ExecutionProgressBar
        progress={currentProgress}
        isExecuting={isExecuting}
        sequenceName={sequences.find((s) => s.id === executingSequenceId)?.name}
      />

      {/* Layout: Library + Detail (runtime) or full-width Builder (design) */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Left Panel — Library (hidden during editing/creating) */}
        {!isBuilderOpen && (
          <div className="w-72 shrink-0 bg-card border border-border rounded-xl p-4 flex flex-col overflow-hidden">
            <SequenceLibrary
              sequences={sequences}
              selectedId={selectedSequence?.id ?? null}
              onSelect={handleSelectSequence}
              onCreateNew={handleCreateNew}
              intents={intents}
              events={events}
              executingId={executingSequenceId}
            />
          </div>
        )}

        {/* Main Panel — Detail (runtime) or Builder (design) */}
        <div className={`flex-1 bg-card border border-border rounded-xl flex flex-col overflow-hidden transition-all duration-200 ${
          isBuilderOpen ? '' : 'p-6'
        } ${
          successFlash ? 'animate-success-flash' : ''
        }`}>
          {isBuilderOpen ? (
            <div className="h-full animate-in fade-in duration-200">
              <SequenceBuilder
                initial={editingSequence}
                intents={intents}
                onSave={handleBuilderSave}
                onCancel={handleBuilderCancel}
              />
            </div>
          ) : selectedSequence ? (
            <div key={selectedSequence.id} className="h-full animate-in fade-in duration-200">
              <SequenceDetail
                sequence={selectedSequence}
                onExecute={handleExecute}
                onCancel={handleCancel}
                onDelete={selectedSequence.category === 'custom' ? handleDelete : undefined}
                onEdit={selectedSequence.category === 'custom' ? handleEdit : undefined}
                onExport={handleExport}
                isExecuting={isExecuting}
                currentProgress={currentProgress}
                executionLogs={executionLogs}
                lastResult={lastResult}
              />
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <Zap className="w-12 h-12 mb-4 opacity-20" />
              <p className="text-sm">Select a sequence from the library or create a new one</p>
            </div>
          )}

          {/* Execution History — runtime only (hidden during design) */}
          {!isBuilderOpen && (
            <div className="border-t border-border mt-4 pt-3">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-2 text-xs font-rajdhani uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors w-full"
              >
                {showHistory ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <History className="w-3.5 h-3.5" />
                Execution History ({history.length})
              </button>
              {showHistory && (
                <div className="mt-2 max-h-48 overflow-y-auto">
                  <SequenceExecutionHistory
                    history={history}
                    onSelect={handleHistorySelect}
                    selectedId={selectedHistoryResult?.executionId}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
