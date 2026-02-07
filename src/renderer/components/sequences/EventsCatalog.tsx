/**
 * EventsCatalog — Collapsible browser of all registered events.
 *
 * Shows event ID, source extension, label, and payload schema.
 *
 * See: documents/feature_sequence_executor_ux.md §4.2
 */

import React, { useState } from 'react';
import { EventCatalogEntry } from '../../types';
import { ChevronDown, ChevronRight, Radio } from 'lucide-react';

interface EventsCatalogProps {
  events: EventCatalogEntry[];
  collapsed?: boolean;
}

export const EventsCatalog: React.FC<EventsCatalogProps> = ({
  events,
  collapsed: initialCollapsed = true,
}) => {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  // Group by domain
  const grouped = events.reduce<Record<string, EventCatalogEntry[]>>((acc, event) => {
    const domain = event.eventId.split('.')[0];
    if (!acc[domain]) acc[domain] = [];
    acc[domain].push(event);
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
        <Radio className="w-3.5 h-3.5" />
        <span className="text-xs font-rajdhani uppercase tracking-wider font-bold">
          Events ({events.length})
        </span>
      </button>

      {!collapsed && (
        <div className="space-y-1 pl-2">
          {Object.entries(grouped).map(([domain, entries]) => (
            <EventDomainGroup key={domain} domain={domain} entries={entries} />
          ))}
        </div>
      )}
    </div>
  );
};

const EventDomainGroup: React.FC<{ domain: string; entries: EventCatalogEntry[] }> = ({
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
              key={entry.eventId}
              className="flex items-center gap-2 py-1 text-xs group"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-secondary/60" />
              <span className="font-jetbrains text-foreground/80 group-hover:text-foreground">
                {entry.eventId}
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
