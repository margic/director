/**
 * Intent domain utilities — icon, color, and label mappings.
 *
 * Centralizes domain-to-visual mapping used across IntentBadge,
 * SequenceStepCard, SequenceLibrary, TimelineRail, and overlays.
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 1.1
 */

import {
  Settings,
  Monitor,
  Flag,
  MessageSquare,
  Youtube,
  Headphones,
  Puzzle,
  type LucideIcon,
} from 'lucide-react';

/** Extract the domain namespace from a fully-qualified intent ID. */
export function getIntentDomain(intent: string): string {
  return intent.split('.')[0] ?? intent;
}

/** Extract the action name from a fully-qualified intent ID. */
export function getIntentAction(intent: string): string {
  const parts = intent.split('.');
  return parts.length > 1 ? parts.slice(1).join('.') : intent;
}

/** Map a domain namespace to its Lucide icon component. */
export function getIntentDomainIcon(domain: string): LucideIcon {
  switch (domain) {
    case 'system':
      return Settings;
    case 'obs':
      return Monitor;
    case 'broadcast':
      return Flag;
    case 'communication':
      return MessageSquare;
    case 'youtube':
      return Youtube;
    case 'discord':
      return Headphones;
    default:
      return Puzzle;
  }
}

export interface DomainStyle {
  /** Tailwind background class (e.g. 'bg-primary/20') */
  bg: string;
  /** Tailwind text class (e.g. 'text-primary') */
  text: string;
  /** Tailwind border color class (e.g. 'border-primary/50') */
  border: string;
  /** Short uppercase label (e.g. 'OBS') */
  label: string;
}

/** Map a domain namespace to its color/style tokens. */
export function getIntentDomainStyle(domain: string): DomainStyle {
  switch (domain) {
    case 'system':
      return { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-muted-foreground/50', label: 'SYS' };
    case 'broadcast':
      return { bg: 'bg-primary/20', text: 'text-primary', border: 'border-primary/50', label: 'BROADCAST' };
    case 'obs':
      return { bg: 'bg-secondary/20', text: 'text-secondary', border: 'border-secondary/50', label: 'OBS' };
    case 'communication':
      return { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-400/50', label: 'COMMS' };
    case 'youtube':
      return { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-400/50', label: 'YT' };
    case 'discord':
      return { bg: 'bg-indigo-500/20', text: 'text-indigo-400', border: 'border-indigo-400/50', label: 'DISCORD' };
    default:
      return { bg: 'bg-white/5', text: 'text-muted-foreground', border: 'border-border', label: domain.toUpperCase() };
  }
}

/**
 * Convert a camelCase intent action into a human-readable label.
 *
 * Used by the overlay system to display broadcast-friendly text
 * when step.metadata.label is not provided.
 *
 * Examples:
 *   "obs.switchScene"          → "Switch Scene"
 *   "broadcast.muteDrivers"    → "Mute Drivers"
 *   "communication.talkToChat" → "Talk To Chat"
 *   "system.wait"              → "Wait"
 */
export function humanizeIntent(intent: string): string {
  const action = getIntentAction(intent);
  return action
    .replace(/([A-Z])/g, ' $1')  // camelCase → spaced
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

/**
 * Collect de-duplicated domains from a list of steps.
 * Returns domain strings in the order they first appear.
 */
export function getUniqueDomains(steps: Array<{ intent: string }>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const step of steps) {
    const domain = getIntentDomain(step.intent);
    if (!seen.has(domain)) {
      seen.add(domain);
      result.push(domain);
    }
  }
  return result;
}
