/**
 * IntentBadge — Domain-colored chip for intent IDs.
 *
 * Color coding by intent namespace:
 * - system.*       → muted/grey
 * - broadcast.*    → primary (orange)
 * - obs.*          → secondary (blue)
 * - communication.* → green
 * - other          → default border
 *
 * See: documents/feature_sequence_executor_ux.md §12
 */

import React from 'react';

interface IntentBadgeProps {
  intent: string;
  className?: string;
}

function getIntentStyle(intent: string): { bg: string; text: string; label: string } {
  const domain = intent.split('.')[0];
  switch (domain) {
    case 'system':
      return { bg: 'bg-muted', text: 'text-muted-foreground', label: 'SYS' };
    case 'broadcast':
      return { bg: 'bg-primary/20', text: 'text-primary', label: 'iRace' };
    case 'obs':
      return { bg: 'bg-secondary/20', text: 'text-secondary', label: 'OBS' };
    case 'communication':
      return { bg: 'bg-green-500/20', text: 'text-green-400', label: 'COMMS' };
    default:
      return { bg: 'bg-white/5', text: 'text-muted-foreground', label: domain.toUpperCase() };
  }
}

export const IntentBadge: React.FC<IntentBadgeProps> = ({ intent, className = '' }) => {
  const style = getIntentStyle(intent);
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold font-rajdhani uppercase tracking-wider ${style.bg} ${style.text} ${className}`}
    >
      <span className="opacity-70">[{style.label}]</span>
      <span>{intent}</span>
    </span>
  );
};

/**
 * Compact version showing only the domain badge (no intent ID).
 */
export const IntentDomainBadge: React.FC<{ intent: string; className?: string }> = ({ intent, className = '' }) => {
  const style = getIntentStyle(intent);
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold font-rajdhani uppercase tracking-wider ${style.bg} ${style.text} ${className}`}
    >
      {style.label}
    </span>
  );
};
