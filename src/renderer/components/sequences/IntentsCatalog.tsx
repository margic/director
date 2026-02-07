/**
 * IntentsCatalog — Collapsible browser of all registered intents.
 *
 * Shows intent ID, source extension, label, schema, and active status.
 *
 * See: documents/feature_sequence_executor_ux.md §4.2
 */

import React, { useState, useEffect } from 'react';
import { IntentCatalogEntry } from '../../types';
import { ChevronDown, ChevronRight, Zap } from 'lucide-react';

interface IntentsCatalogProps {
  intents: IntentCatalogEntry[];
  collapsed?: boolean;
}

export const IntentsCatalog: React.FC<IntentsCatalogProps> = ({
  intents,
  collapsed: initialCollapsed = true,
}) => {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  // Group by domain
  const grouped = intents.reduce<Record<string, IntentCatalogEntry[]>>((acc, intent) => {
    const domain = intent.intentId.split('.')[0];
    if (!acc[domain]) acc[domain] = [];
    acc[domain].push(intent);
    return acc;
  }, {});

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 py-2 px-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
        <Zap className="w-3.5 h-3.5" />
        <span className="text-xs font-rajdhani uppercase tracking-wider font-bold">
          Intents ({intents.length})
        </span>
      </button>

      {!collapsed && (
        <div className="space-y-1 pl-2">
          {Object.entries(grouped).map(([domain, entries]) => (
            <DomainGroup key={domain} domain={domain} entries={entries} />
          ))}
        </div>
      )}
    </div>
  );
};

const DomainGroup: React.FC<{ domain: string; entries: IntentCatalogEntry[] }> = ({
  domain,
  entries,
}) => {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 py-1 px-1 text-muted-foreground hover:text-foreground text-xs transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span className="font-rajdhani uppercase tracking-wider font-bold">{domain}.*</span>
        <span className="text-muted-foreground/60">({entries.length})</span>
      </button>

      {open && (
        <div className="pl-5 space-y-0.5">
          {entries.map((entry) => (
            <div
              key={entry.intentId}
              className="flex items-center gap-2 py-1 text-xs group"
            >
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  entry.active ? 'bg-green-400' : 'bg-muted-foreground/40'
                }`}
              />
              <span className="font-jetbrains text-foreground/80 group-hover:text-foreground">
                {entry.intentId}
              </span>
              {entry.extensionLabel && (
                <span className="text-muted-foreground/60 text-[10px]">
                  ({entry.extensionLabel})
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
