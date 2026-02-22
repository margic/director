/**
 * SequenceBuilder — Three-panel drag-and-drop sequence editor.
 *
 * Three-panel layout using @dnd-kit for drag-and-drop step management:
 * - Left: IntentPalette (w-56) — draggable intent chips grouped by domain
 * - Center: BuilderCanvas (flex-1) — sortable step list with drop zones
 * - Right: PropertiesPanel (w-72) — step/sequence metadata editor
 *
 * Also used in read-only mode (readonly=true) where panels are non-interactive.
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 4.4
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import {
  PortableSequence,
  SequenceStep,
  SequenceVariable,
  IntentCatalogEntry,
} from '../../types';
import { SequenceDndContext } from './dnd/DndContext';
import { IntentPalette } from './dnd/IntentPalette';
import { BuilderCanvas } from './dnd/BuilderCanvas';
import { PropertiesPanel } from './dnd/PropertiesPanel';
import { Save, X } from 'lucide-react';

interface SequenceBuilderProps {
  /** Existing sequence to edit, or null for new */
  initial?: PortableSequence | null;
  intents: IntentCatalogEntry[];
  onSave: (sequence: PortableSequence) => void;
  onCancel: () => void;
  /** Read-only display mode (no editing, no save/cancel) */
  readonly?: boolean;
}

export const SequenceBuilder: React.FC<SequenceBuilderProps> = ({
  initial,
  intents,
  onSave,
  onCancel,
  readonly = false,
}) => {
  const isEdit = !!initial;

  // Sequence metadata state
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [version, setVersion] = useState(initial?.version ?? '1.0.0');
  const [priority, setPriority] = useState(initial?.priority ?? false);
  const [variables, setVariables] = useState<SequenceVariable[]>(initial?.variables ?? []);
  const [steps, setSteps] = useState<SequenceStep[]>(initial?.steps ?? []);
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);

  // Build the full sequence object
  const builtSequence = useMemo((): PortableSequence => {
    const id = initial?.id ?? `seq_custom_${Date.now()}`;
    return {
      id,
      name: name || undefined,
      version: version || undefined,
      description: description || undefined,
      category: 'custom',
      priority: priority || undefined,
      variables: variables.length > 0 ? variables : undefined,
      steps,
    };
  }, [initial?.id, name, version, description, priority, variables, steps]);

  const selectedStep = selectedStepIndex !== null ? steps[selectedStepIndex] ?? null : null;

  // Validation
  const errors: string[] = [];
  if (!name.trim()) errors.push('Name is required');
  if (steps.length === 0) errors.push('At least one step is required');
  if (steps.some((s) => !s.intent)) errors.push('All steps must have an intent');

  const handleSave = useCallback(() => {
    if (errors.length > 0) return;
    onSave(builtSequence);
  }, [builtSequence, errors, onSave]);

  // Keyboard shortcuts: Ctrl+S to save, Escape to cancel
  useEffect(() => {
    if (readonly) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [readonly, handleSave, onCancel]);

  // Create a new step from an intent, pre-populating payload from schema
  const createStepFromIntent = useCallback(
    (intentId: string, atIndex?: number): void => {
      // Scaffold payload keys from intent schema so fields appear immediately
      const catalogEntry = intents.find((i) => i.intentId === intentId);
      const schema = catalogEntry?.inputSchema as
        | { properties?: Record<string, { type?: string; default?: unknown }> }
        | undefined;
      const payload: Record<string, unknown> = {};
      if (schema?.properties) {
        for (const [key, prop] of Object.entries(schema.properties)) {
          if (prop.default !== undefined) {
            payload[key] = prop.default;
          } else if (prop.type === 'number') {
            payload[key] = 0;
          } else if (prop.type === 'boolean') {
            payload[key] = false;
          } else {
            payload[key] = '';
          }
        }
      }

      const newStep: SequenceStep = {
        id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        intent: intentId,
        payload,
      };
      if (atIndex !== undefined && atIndex >= 0) {
        const newSteps = [...steps];
        newSteps.splice(atIndex, 0, newStep);
        setSteps(newSteps);
      } else {
        setSteps([...steps, newStep]);
      }
    },
    [steps]
  );

  // Handle palette intent click — append step
  const handleIntentClick = useCallback(
    (intent: IntentCatalogEntry) => {
      createStepFromIntent(intent.intentId);
    },
    [createStepFromIntent]
  );

  // Handle drag end — either drop from palette or reorder within canvas
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      // Drop from palette → create new step
      if (activeId.startsWith('intent-')) {
        const intentId = activeId.replace('intent-', '');

        // Dropped onto a drop zone (dropzone-N)
        if (overId.startsWith('dropzone-')) {
          const position = parseInt(overId.replace('dropzone-', ''), 10);
          createStepFromIntent(intentId, position);
        }
        // Dropped onto an existing step → insert after it
        else {
          const overIndex = steps.findIndex((s) => s.id === overId);
          if (overIndex >= 0) {
            createStepFromIntent(intentId, overIndex + 1);
          } else {
            createStepFromIntent(intentId);
          }
        }
        return;
      }

      // Reorder within canvas
      if (activeId !== overId) {
        const oldIndex = steps.findIndex((s) => s.id === activeId);
        let newIndex: number;

        if (overId.startsWith('dropzone-')) {
          newIndex = parseInt(overId.replace('dropzone-', ''), 10);
          // Adjust for removal of original item
          if (oldIndex < newIndex) newIndex--;
        } else {
          newIndex = steps.findIndex((s) => s.id === overId);
        }

        if (oldIndex >= 0 && newIndex >= 0) {
          const newSteps = arrayMove(steps, oldIndex, newIndex);
          setSteps(newSteps);

          // Track selection
          if (selectedStepIndex === oldIndex) {
            setSelectedStepIndex(newIndex);
          }
        }
      }
    },
    [steps, createStepFromIntent, selectedStepIndex]
  );

  // Handle sequence metadata changes from properties panel
  const handleSequenceChange = useCallback(
    (updates: Partial<PortableSequence>) => {
      if (readonly) return;
      if ('name' in updates) setName(updates.name ?? '');
      if ('description' in updates) setDescription(updates.description ?? '');
      if ('version' in updates) setVersion(updates.version ?? '');
      if ('priority' in updates) setPriority(!!updates.priority);
    },
    [readonly]
  );

  // Handle step property changes from properties panel
  const handleStepChange = useCallback(
    (index: number, updates: Partial<SequenceStep>) => {
      if (readonly) return;
      const newSteps = [...steps];
      newSteps[index] = { ...newSteps[index], ...updates };
      setSteps(newSteps);
    },
    [steps, readonly]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header Bar */}
      {!readonly && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
          <h2 className="text-lg font-rajdhani font-bold uppercase tracking-wider text-foreground">
            {isEdit ? 'Edit Sequence' : 'Create New Sequence'}
          </h2>
          <div className="flex items-center gap-2">
            {/* Validation Errors */}
            {errors.length > 0 && (
              <span className="text-xs text-destructive font-jetbrains mr-2">
                {errors[0]}
              </span>
            )}
            <button
              onClick={onCancel}
              className="px-4 py-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-background transition-colors font-rajdhani uppercase tracking-wider text-sm font-bold"
              title="Escape"
            >
              <X className="w-4 h-4 inline mr-1" />
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={errors.length > 0}
              className="px-4 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-all font-rajdhani uppercase tracking-wider text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              title="Ctrl+S"
            >
              <Save className="w-4 h-4 inline mr-1" />
              Save
            </button>
          </div>
        </div>
      )}

      {/* Three-Panel Layout */}
      <SequenceDndContext onDragEnd={handleDragEnd}>
        <div className="flex-1 flex min-h-0">
          {/* Left Panel — Intent Palette */}
          <div className="w-56 shrink-0">
            <IntentPalette
              intents={intents}
              onIntentClick={handleIntentClick}
              readonly={readonly}
            />
          </div>

          {/* Center Panel — Builder Canvas */}
          <div className="flex-1 min-w-0">
            <BuilderCanvas
              steps={steps}
              selectedStepIndex={selectedStepIndex}
              onStepsChange={setSteps}
              onSelectStep={setSelectedStepIndex}
              readonly={readonly}
            />
          </div>

          {/* Right Panel — Properties */}
          <div className="w-72 shrink-0">
            <PropertiesPanel
              sequence={builtSequence}
              selectedStep={selectedStep}
              selectedStepIndex={selectedStepIndex}
              intents={intents}
              onSequenceChange={handleSequenceChange}
              onStepChange={handleStepChange}
              onVariableChange={setVariables}
              readonly={readonly}
            />
          </div>
        </div>
      </SequenceDndContext>
    </div>
  );
};
