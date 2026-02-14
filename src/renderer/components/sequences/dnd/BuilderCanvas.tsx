/**
 * Builder Canvas
 *
 * Central panel of the sequence builder where steps are dropped and reordered.
 * Uses @dnd-kit/sortable for sortable list behavior.
 *
 * Features:
 * - Drop target for intents from the palette
 * - Sortable step list with animated reordering
 * - DropZones between steps for precise placement
 * - Empty state with animated arrow
 * - Keyboard navigation (↑↓ to select, Delete to remove)
 * - Selected step highlighting
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 4.3
 */

import React, { useState, useEffect } from 'react';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { ArrowDown } from 'lucide-react';
import { SortableStepCard } from './SortableStepCard';
import { DropZone } from './DropZone';
import type { SequenceStep } from '@/types';

export interface BuilderCanvasProps {
  steps: SequenceStep[];
  selectedStepIndex: number | null;
  onStepsChange: (steps: SequenceStep[]) => void;
  onSelectStep: (index: number | null) => void;
  readonly?: boolean;
}

export const BuilderCanvas: React.FC<BuilderCanvasProps> = ({
  steps,
  selectedStepIndex,
  onStepsChange,
  onSelectStep,
  readonly = false,
}) => {
  // Keyboard navigation
  useEffect(() => {
    if (readonly) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return; // Don't interfere with text input
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (selectedStepIndex === null && steps.length > 0) {
          onSelectStep(0);
        } else if (selectedStepIndex !== null && selectedStepIndex < steps.length - 1) {
          onSelectStep(selectedStepIndex + 1);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (selectedStepIndex !== null && selectedStepIndex > 0) {
          onSelectStep(selectedStepIndex - 1);
        }
      } else if (e.key === 'Delete' && selectedStepIndex !== null) {
        e.preventDefault();
        handleDeleteStep(selectedStepIndex);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedStepIndex, steps.length, readonly]);

  const handleDeleteStep = (index: number) => {
    const newSteps = steps.filter((_, i) => i !== index);
    onStepsChange(newSteps);
    
    // Update selection
    if (selectedStepIndex === index) {
      onSelectStep(null);
    } else if (selectedStepIndex !== null && selectedStepIndex > index) {
      onSelectStep(selectedStepIndex - 1);
    }
  };

  const handleReorder = (oldIndex: number, newIndex: number) => {
    const newSteps = arrayMove(steps, oldIndex, newIndex);
    onStepsChange(newSteps);

    // Update selected index if the selected step moved
    if (selectedStepIndex === oldIndex) {
      onSelectStep(newIndex);
    } else if (selectedStepIndex !== null) {
      if (oldIndex < selectedStepIndex && newIndex >= selectedStepIndex) {
        onSelectStep(selectedStepIndex - 1);
      } else if (oldIndex > selectedStepIndex && newIndex <= selectedStepIndex) {
        onSelectStep(selectedStepIndex + 1);
      }
    }
  };

  // Empty state
  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 bg-background/50">
        <div className="text-center space-y-4 max-w-md animate-in fade-in duration-500">
          <ArrowDown className="w-12 h-12 mx-auto text-muted-foreground/40 animate-bounce" />
          <div>
            <h3 className="text-lg font-rajdhani font-bold text-foreground mb-2">
              No Steps Yet
            </h3>
            <p className="text-sm text-muted-foreground">
              Drag an intent from the palette to begin building your sequence,
              or click an intent to append it to the end.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background/50 p-4">
      <SortableContext
        items={steps.map((s) => s.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-0">
          {/* Drop zone before first step */}
          {!readonly && <DropZone id="dropzone-0" position={0} />}

          {/* Steps with drop zones between them */}
          {steps.map((step, index) => (
            <React.Fragment key={step.id}>
              <SortableStepCard
                step={step}
                index={index}
                isSelected={selectedStepIndex === index}
                onSelect={() => onSelectStep(index)}
                onDelete={() => handleDeleteStep(index)}
              />

              {/* Drop zone after each step */}
              {!readonly && <DropZone id={`dropzone-${index + 1}`} position={index + 1} />}
            </React.Fragment>
          ))}
        </div>
      </SortableContext>

      {/* Keyboard Shortcuts Hint */}
      {!readonly && steps.length > 0 && (
        <div className="mt-6 p-3 bg-card border border-border/50 rounded-lg">
          <p className="text-[10px] font-jetbrains text-muted-foreground text-center">
            <kbd className="px-1.5 py-0.5 bg-background rounded border border-border">↑</kbd>{' '}
            <kbd className="px-1.5 py-0.5 bg-background rounded border border-border">↓</kbd>{' '}
            Navigate •{' '}
            <kbd className="px-1.5 py-0.5 bg-background rounded border border-border">Delete</kbd>{' '}
            Remove Step
          </p>
        </div>
      )}
    </div>
  );
};
