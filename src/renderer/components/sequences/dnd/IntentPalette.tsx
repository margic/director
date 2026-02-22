/**
 * Intent Palette
 *
 * Left panel of the sequence builder showing draggable intent chips
 * grouped by domain (System, OBS, Broadcast, Communication, etc.).
 *
 * Features:
 * - Collapsible domain sections
 * - Search/filter within palette
 * - Click-to-add alternative to drag (appends step to end of sequence)
 * - Sorted alphabetically within each domain
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 4.2
 */

import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { DraggableIntentChip } from './DraggableIntentChip';
import { getIntentDomain, getIntentDomainIcon } from '@/lib/intent-utils';
import type { IntentCatalogEntry } from '@/types';

export interface IntentPaletteProps {
  intents: IntentCatalogEntry[];
  onIntentClick?: (intent: IntentCatalogEntry) => void;
  readonly?: boolean;
}

export const IntentPalette: React.FC<IntentPaletteProps> = ({
  intents,
  onIntentClick,
  readonly = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedDomains, setCollapsedDomains] = useState<Set<string>>(new Set());

  // Group intents by domain
  const groupedIntents = useMemo(() => {
    const filtered = intents.filter((intent) => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        intent.intentId.toLowerCase().includes(query) ||
        intent.label?.toLowerCase().includes(query) ||
        intent.extensionLabel?.toLowerCase().includes(query)
      );
    });

    const groups = new Map<string, IntentCatalogEntry[]>();
    for (const intent of filtered) {
      const domain = getIntentDomain(intent.intentId);
      if (!groups.has(domain)) {
        groups.set(domain, []);
      }
      groups.get(domain)!.push(intent);
    }

    // Sort intents within each domain
    for (const [, domainIntents] of groups) {
      domainIntents.sort((a, b) => {
        const aName = a.label || a.intentId;
        const bName = b.label || b.intentId;
        return aName.localeCompare(bName);
      });
    }

    // Sort domains (system first, then alphabetically)
    const sortedDomains = Array.from(groups.keys()).sort((a, b) => {
      if (a === 'system') return -1;
      if (b === 'system') return 1;
      return a.localeCompare(b);
    });

    return sortedDomains.map((domain) => ({
      domain,
      intents: groups.get(domain)!,
    }));
  }, [intents, searchQuery]);

  const toggleDomain = (domain: string) => {
    setCollapsedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <h3 className="text-xs font-rajdhani font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Intent Palette
        </h3>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search intents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs font-jetbrains"
          />
        </div>
      </div>

      {/* Intent Groups */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {groupedIntents.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground italic">
            {searchQuery ? 'No intents match your search' : 'No intents available'}
          </div>
        ) : (
          groupedIntents.map(({ domain, intents: domainIntents }) => {
            const Icon = getIntentDomainIcon(domain);
            const isCollapsed = collapsedDomains.has(domain);

            return (
              <div key={domain} className="space-y-1">
                {/* Domain Header */}
                <button
                  onClick={() => toggleDomain(domain)}
                  className="w-full flex items-center gap-2 p-2 rounded hover:bg-background/50 transition-colors"
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-rajdhani font-bold uppercase tracking-wider text-muted-foreground">
                    {domain}
                  </span>
                  <span className="ml-auto text-[10px] font-jetbrains text-muted-foreground">
                    {domainIntents.length}
                  </span>
                </button>

                {/* Domain Intents */}
                {!isCollapsed && (
                  <div className="pl-4 space-y-1">
                    {domainIntents.map((intent) => (
                      <DraggableIntentChip
                        key={intent.intentId}
                        intent={intent}
                        onClick={() => !readonly && onIntentClick?.(intent)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer Hint */}
      {!readonly && (
        <div className="p-3 border-t border-border bg-background/50">
          <p className="text-[10px] font-jetbrains text-muted-foreground text-center">
            Drag to canvas or click to append
          </p>
        </div>
      )}
    </div>
  );
};
