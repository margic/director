/**
 * SequenceLibrary — Left panel showing all available sequences.
 *
 * Searchable, filterable list organized by category (Built-in, Cloud, Custom).
 * Also contains the collapsible Intents & Events catalogs.
 *
 * See: documents/feature_sequence_executor_ux.md §4.1
 */

import React, { useState, useMemo } from 'react';
import {
  PortableSequence,
  IntentCatalogEntry,
  EventCatalogEntry,
} from '../../types';
import { IntentsCatalog } from './IntentsCatalog';
import { EventsCatalog } from './EventsCatalog';
import { Search, Package, Cloud, User, Plus, Clock } from 'lucide-react';

interface SequenceLibraryProps {
  sequences: PortableSequence[];
  selectedId: string | null;
  onSelect: (sequence: PortableSequence) => void;
  onCreateNew: () => void;
  intents: IntentCatalogEntry[];
  events: EventCatalogEntry[];
  executingId?: string | null;
}

const categoryConfig: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  'built-in': { icon: Package, label: 'Built-in', color: 'text-secondary' },
  cloud: { icon: Cloud, label: 'Cloud', color: 'text-primary' },
  custom: { icon: User, label: 'Custom', color: 'text-green-400' },
};

export const SequenceLibrary: React.FC<SequenceLibraryProps> = ({
  sequences,
  selectedId,
  onSelect,
  onCreateNew,
  intents,
  events,
  executingId,
}) => {
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let result = sequences;

    if (filterCategory) {
      result = result.filter((s) => s.category === filterCategory);
    }

    if (search.trim()) {
      const term = search.toLowerCase();
      result = result.filter(
        (s) =>
          (s.name?.toLowerCase().includes(term) ?? false) ||
          (s.description?.toLowerCase().includes(term) ?? false) ||
          s.steps.some((step) => step.intent.toLowerCase().includes(term))
      );
    }

    return result;
  }, [sequences, search, filterCategory]);

  // Group by category
  const grouped = useMemo(() => {
    const g: Record<string, PortableSequence[]> = {};
    for (const seq of filtered) {
      const cat = seq.category ?? 'custom';
      if (!g[cat]) g[cat] = [];
      g[cat].push(seq);
    }
    return g;
  }, [filtered]);

  const categoryOrder = ['built-in', 'cloud', 'custom'];

  // Estimate duration from system.wait steps
  const estimateDuration = (seq: PortableSequence): string => {
    let totalMs = 0;
    for (const step of seq.steps) {
      if (step.intent === 'system.wait' && typeof step.payload.durationMs === 'number') {
        totalMs += step.payload.durationMs;
      }
    }
    if (totalMs === 0) return `${seq.steps.length} steps`;
    return `~${(totalMs / 1000).toFixed(0)}s`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sequences..."
          className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-sm font-jetbrains text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
        />
      </div>

      {/* Category filter */}
      <div className="flex gap-1 mb-3">
        <button
          onClick={() => setFilterCategory(null)}
          className={`px-2 py-1 rounded text-[10px] font-bold font-rajdhani uppercase tracking-wider transition-colors ${
            !filterCategory ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          All
        </button>
        {categoryOrder.map((cat) => {
          const config = categoryConfig[cat];
          return (
            <button
              key={cat}
              onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
              className={`px-2 py-1 rounded text-[10px] font-bold font-rajdhani uppercase tracking-wider transition-colors ${
                filterCategory === cat
                  ? 'bg-white/10 text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {config.label}
            </button>
          );
        })}
      </div>

      {/* Create New button */}
      <button
        onClick={onCreateNew}
        className="w-full mb-3 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors text-sm"
      >
        <Plus className="w-4 h-4" />
        <span className="font-rajdhani uppercase tracking-wider font-bold text-xs">
          New Sequence
        </span>
      </button>

      {/* Library list */}
      <div className="flex-1 overflow-y-auto space-y-3">
        {categoryOrder.map((cat) => {
          const items = grouped[cat];
          if (!items || items.length === 0) return null;
          const config = categoryConfig[cat];
          const CatIcon = config.icon;

          return (
            <div key={cat}>
              <div className="flex items-center gap-1.5 px-1 mb-1">
                <CatIcon className={`w-3 h-3 ${config.color}`} />
                <span className={`text-[10px] font-rajdhani uppercase tracking-wider font-bold ${config.color}`}>
                  {config.label}
                </span>
              </div>

              <div className="space-y-1">
                {items.map((seq) => {
                  const isSelected = seq.id === selectedId;
                  const isExecuting = seq.id === executingId;

                  return (
                    <button
                      key={seq.id}
                      onClick={() => onSelect(seq)}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                        isSelected
                          ? 'bg-primary/10 border border-primary/30'
                          : 'hover:bg-white/5 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate flex-1">
                          {seq.name ?? seq.id}
                        </span>
                        {isExecuting && (
                          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                        <span>{seq.steps.length} steps</span>
                        <span>·</span>
                        <span>{estimateDuration(seq)}</span>
                        {seq.variables && seq.variables.length > 0 && (
                          <>
                            <span>·</span>
                            <span>{seq.variables.length} vars</span>
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">
            {search ? 'No sequences match your search' : 'No sequences available'}
          </div>
        )}
      </div>

      {/* Intents & Events Browser */}
      <div className="border-t border-border mt-3 pt-3">
        <IntentsCatalog intents={intents} />
        <EventsCatalog events={events} />
      </div>
    </div>
  );
};
