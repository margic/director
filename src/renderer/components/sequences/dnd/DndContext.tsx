/**
 * Drag & Drop Context Wrapper
 *
 * Project-specific configuration for @dnd-kit DnD context used by
 * the sequence builder's three-panel layout.
 *
 * Features:
 * - Custom collision detection (closestCenter)
 * - Drag overlay with brand styling
 * - Accessibility announcements
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 4.1
 */

import React from 'react';
import {
  DndContext as DndKitContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

export interface DndContextProps {
  children: React.ReactNode;
  onDragStart?: (event: DragStartEvent) => void;
  onDragOver?: (event: DragOverEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
}

/**
 * Shared DnD context for the sequence builder.
 * Provides collision detection, sensors, and drag overlay.
 */
export const SequenceDndContext: React.FC<DndContextProps> = ({
  children,
  onDragStart,
  onDragOver,
  onDragEnd,
}) => {
  const [activeId, setActiveId] = React.useState<string | null>(null);

  // Configure sensors for mouse/touch + keyboard navigation
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px drag before activating (prevents accidental drags on click)
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    onDragStart?.(event);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    onDragEnd(event);
  };

  const handleDragOver = (event: DragOverEvent) => {
    onDragOver?.(event);
  };

  return (
    <DndKitContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {children}

      {/* Drag Overlay: semi-transparent copy follows cursor */}
      <DragOverlay
        dropAnimation={{
          duration: 200,
          easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
        }}
      >
        {activeId ? (
          <div
            className="opacity-60 bg-card border border-primary rounded-lg shadow-2xl"
            style={{
              cursor: 'grabbing',
              transform: 'rotate(-2deg)',
            }}
          >
            <div className="p-3 font-rajdhani text-sm text-foreground">
              Dragging: {activeId}
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndKitContext>
  );
};
