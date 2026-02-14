/**
 * Draggable Intent Chip
 *
 * Individual draggable intent item for the IntentPalette.
 * Uses @dnd-kit/core's useDraggable hook.
 *
 * Renders:
 * - Domain icon (from intent-utils)
 * - Intent name (humanized from intentId)
 * - Domain label badge
 *
 * Drag behavior:
 * - Semi-transparent preview follows cursor (handled by DndContext overlay)
 * - Payload: { type: 'intent', intentId, domain, extensionId }
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 4.2
 */

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { getIntentDomain, getIntentDomainIcon, getIntentAction, getDomainStyle } from '@/renderer/lib/intent-utils';
import type { IntentCatalogEntry } from '@/renderer/types';

export interface DraggableIntentChipProps {
  intent: IntentCatalogEntry;
  onClick?: () => void;
}

export const DraggableIntentChip: React.FC<DraggableIntentChipProps> = ({
  intent,
  onClick,
}) => {
  const domain = getIntentDomain(intent.intentId);
  const action = getIntentAction(intent.intentId);
  const Icon = getIntentDomainIcon(domain);
  const style = getDomainStyle(domain);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `intent-${intent.intentId}`,
    data: {
      type: 'intent',
      intentId: intent.intentId,
      domain,
      extensionId: intent.extensionId,
      label: intent.label,
    },
  });

  // Format action name: "switchScene" → "Switch Scene"
  const displayName = intent.label || action
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`
        group flex items-center gap-2 p-2 rounded-lg border cursor-grab
        transition-all duration-150
        ${isDragging ? 'opacity-40' : 'opacity-100'}
        ${style.bg} ${style.border} hover:scale-105
        bg-background/50 hover:bg-background
      `}
      style={{ touchAction: 'none' }}
    >
      {/* Domain Icon */}
      <div className={`p-1.5 rounded ${style.bg}`}>
        <Icon className={`w-4 h-4 ${style.text}`} />
      </div>

      {/* Intent Name */}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-rajdhani font-semibold text-foreground truncate">
          {displayName}
        </div>
        <div className="text-[10px] font-jetbrains text-muted-foreground truncate">
          {style.label}
        </div>
      </div>

      {/* Inactive indicator */}
      {!intent.active && (
        <div className="text-[10px] text-muted-foreground opacity-60">
          ⚠️
        </div>
      )}
    </div>
  );
};
