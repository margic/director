/**
 * Drop Zone
 *
 * Visual drop indicator rendered between steps in the BuilderCanvas.
 * Expands on drag-over to show "Drop intent here" prompt.
 *
 * Uses @dnd-kit/core's useDroppable hook to detect when a draggable
 * intent is hovering over the zone.
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 4.3
 */

import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Plus } from 'lucide-react';

export interface DropZoneProps {
  id: string;
  position: number; // Insert position in the step array
}

export const DropZone: React.FC<DropZoneProps> = ({ id, position }) => {
  const { isOver, setNodeRef } = useDroppable({
    id,
    data: {
      type: 'dropzone',
      position,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={`
        relative transition-all duration-200
        ${isOver ? 'h-16 my-2' : 'h-1 my-1'}
      `}
    >
      <div
        className={`
          absolute inset-0 rounded-lg border-2 border-dashed
          flex items-center justify-center gap-2
          transition-all duration-200
          ${
            isOver
              ? 'border-primary bg-primary/10 opacity-100'
              : 'border-border/30 bg-transparent opacity-30'
          }
        `}
      >
        {isOver && (
          <div className="flex items-center gap-2 font-rajdhani font-semibold text-sm text-primary animate-in fade-in duration-150">
            <Plus className="w-4 h-4" />
            <span>Drop intent here</span>
          </div>
        )}
      </div>
    </div>
  );
};
