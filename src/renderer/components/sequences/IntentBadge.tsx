/**
 * IntentBadge — Domain-colored chip for intent IDs with icon.
 *
 * Color coding + icon by intent namespace:
 * - system.*       → Settings gear / muted grey
 * - broadcast.*    → Flag / primary orange
 * - obs.*          → Monitor / secondary blue
 * - communication.* → MessageSquare / green
 * - discord.*      → Headphones / indigo
 * - youtube.*      → Youtube / red
 * - other          → Puzzle / muted
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 1.1
 */

import React from 'react';
import {
  getIntentDomain,
  getIntentDomainIcon,
  getIntentDomainStyle,
} from '../../lib/intent-utils';

interface IntentBadgeProps {
  intent: string;
  className?: string;
}

export const IntentBadge: React.FC<IntentBadgeProps> = ({ intent, className = '' }) => {
  const domain = getIntentDomain(intent);
  const style = getIntentDomainStyle(domain);
  const DomainIcon = getIntentDomainIcon(domain);

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold font-rajdhani uppercase tracking-wider ${style.bg} ${style.text} ${className}`}
    >
      <DomainIcon className="w-3 h-3" />
      <span className="opacity-70">[{style.label}]</span>
      <span>{intent}</span>
    </span>
  );
};

/**
 * Compact version showing only the domain badge with icon (no intent ID).
 */
export const IntentDomainBadge: React.FC<{ intent: string; className?: string }> = ({ intent, className = '' }) => {
  const domain = getIntentDomain(intent);
  const style = getIntentDomainStyle(domain);
  const DomainIcon = getIntentDomainIcon(domain);

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold font-rajdhani uppercase tracking-wider ${style.bg} ${style.text} ${className}`}
    >
      <DomainIcon className="w-3 h-3" />
      {style.label}
    </span>
  );
};
