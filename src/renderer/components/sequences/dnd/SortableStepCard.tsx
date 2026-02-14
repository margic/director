/**
 * Sortable Step Card
 *
 * Individual step card rendered in the BuilderCanvas.
 * Uses @dnd-kit/sortable for drag-to-reorder behavior.
 *
 * Features:
 * - Drag handle (≡) on left
 * - Domain icon + intent name
 * - Payload preview (collapsed JSON)
 * - Selected state when clicked
 * - Delete button (×) on hover
 * - Animated position changes on reorder
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 4.3
 */

import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from 'lucide-react';
import { getIntentDomain, getIntentDomainIcon, getIntentAction, getDomainStyle } from '@/renderer/lib/intent-utils';
import type { SequenceStep } from '@/renderer/types';

export interface SortableStepCardProps {
  step: SequenceStep;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

export const SortableStepCard: React.FC<SortableStepCardProps> = ({
  step,
  index,
  isSelected,
  onSelect,
  onDelete,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id });

  const domain = getIntentDomain(step.intent);
  const action = getIntentAction(step.intent);
  const Icon = getIntentDomainIcon(domain);
  const style = getDomainStyle(domain);

  // Format action name
  const displayName = step.metadata?.label || action
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();

  // Payload preview (first 3 keys)
  const payloadKeys = Object.keys(step.payload);
  const payloadPreview = payloadKeys.length > 0
    ? payloadKeys.slice(0, 3).join(', ') + (payloadKeys.length > 3 ? '...' : '')
    : 'No payload';

  const transformStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={transformStyle}
      onClick={onSelect}
      className={`
        group relative flex items-center gap-3 p-3 rounded-lg border
        transition-all duration-150 cursor-pointer
        ${isDragging ? 'opacity-40 z-50' : 'opacity-100'}
        ${isSelected ? 'border-primary bg-primary/5 shadow-lg' : 'border-border bg-card hover:border-border/70'}
        hover:shadow-md
      `}
    >
      {/* Drag Handle */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors"
      >
        <GripVertical className="w-4 h-4" />
      </div>

      {/* Step Number */}
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-background border border-border flex items-center justify-center">
        <span className="text-xs font-jetbrains font-bold text-muted-foreground">
          {index + 1}
        </span>
      </div>

      {/* Domain Icon */}
      <div className={`flex-shrink-0 p-2 rounded ${style.bg}`}>
        <Icon className={`w-4 h-4 ${style.text}`} />
      </div>

      {/* Step Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-rajdhani font-semibold text-foreground truncate">
            {displayName}
          </span>
          <span className={`text-[10px] font-rajdhani font-bold uppercase tracking-wider ${style.text} ${style.bg} px-1.5 py-0.5 rounded`}>
            {style.label}
          </span>
        </div>
        <div className="text-xs font-jetbrains text-muted-foreground truncate mt-0.5">
          {payloadPreview}
        </div>
      </div>

      {/* Delete Button (visible on hover or when selected) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className={`
          flex-shrink-0 p-1.5 rounded-full hover:bg-destructive/20 text-muted-foreground hover:text-destructive
          transition-all duration-150
          ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
        `}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
