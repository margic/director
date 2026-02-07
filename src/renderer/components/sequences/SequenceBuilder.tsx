/**
 * SequenceBuilder — Visual sequence creation/editing UI.
 *
 * Structured editor for creating custom sequences without JSON.
 * Includes metadata form, step palette, variable manager, and JSON preview.
 *
 * See: documents/feature_sequence_executor_ux.md §10.1
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  PortableSequence,
  SequenceStep,
  SequenceVariable,
  IntentCatalogEntry,
} from '../../types';
import { SequenceBuilderStepEditor } from './SequenceBuilderStepEditor';
import { SequenceBuilderVariableManager } from './SequenceBuilderVariableManager';
import { Save, X, Plus, Code, ChevronDown, ChevronRight } from 'lucide-react';

interface SequenceBuilderProps {
  /** Existing sequence to edit, or null for new */
  initial?: PortableSequence | null;
  intents: IntentCatalogEntry[];
  onSave: (sequence: PortableSequence) => void;
  onCancel: () => void;
}

export const SequenceBuilder: React.FC<SequenceBuilderProps> = ({
  initial,
  intents,
  onSave,
  onCancel,
}) => {
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [version, setVersion] = useState(initial?.version ?? '1.0.0');
  const [priority, setPriority] = useState(initial?.priority ?? false);
  const [variables, setVariables] = useState<SequenceVariable[]>(initial?.variables ?? []);
  const [steps, setSteps] = useState<SequenceStep[]>(
    initial?.steps ?? []
  );
  const [showPreview, setShowPreview] = useState(false);

  const inputClasses =
    'w-full bg-background border border-border rounded px-3 py-2 text-sm font-jetbrains text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors';

  // Build the sequence object
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

  const handleAddStep = useCallback(() => {
    const newStep: SequenceStep = {
      id: `step_${steps.length + 1}`,
      intent: '',
      payload: {},
    };
    setSteps([...steps, newStep]);
  }, [steps]);

  const handleUpdateStep = useCallback(
    (index: number, updated: SequenceStep) => {
      const newSteps = [...steps];
      newSteps[index] = updated;
      setSteps(newSteps);
    },
    [steps]
  );

  const handleRemoveStep = useCallback(
    (index: number) => {
      setSteps(steps.filter((_, i) => i !== index));
    },
    [steps]
  );

  const handleSave = useCallback(() => {
    if (steps.length === 0) return;
    onSave(builtSequence);
  }, [builtSequence, steps, onSave]);

  // Validation
  const errors: string[] = [];
  if (!name.trim()) errors.push('Name is required');
  if (steps.length === 0) errors.push('At least one step is required');
  if (steps.some((s) => !s.intent)) errors.push('All steps must have an intent');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-rajdhani font-bold uppercase tracking-wider text-white">
          {isEdit ? 'Edit Sequence' : 'Create New Sequence'}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors font-rajdhani uppercase tracking-wider text-sm font-bold"
          >
            <X className="w-4 h-4 inline mr-1" />
            Discard
          </button>
          <button
            onClick={handleSave}
            disabled={errors.length > 0}
            className="px-4 py-2 rounded-lg bg-primary text-black hover:bg-primary/90 transition-all font-rajdhani uppercase tracking-wider text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4 inline mr-1" />
            Save
          </button>
        </div>
      </div>

      {/* Scrollable form */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-2">
        {/* Metadata */}
        <div className="space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClasses}
            placeholder="Sequence Name *"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClasses}
            placeholder="Description"
          />
          <div className="flex gap-3">
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className={`${inputClasses} w-32`}
              placeholder="Version"
            />
            <label className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded border border-border bg-background">
              <input
                type="checkbox"
                checked={priority}
                onChange={(e) => setPriority(e.target.checked)}
                className="rounded border-border bg-card text-primary focus:ring-primary"
              />
              <span className="text-sm text-foreground font-rajdhani uppercase tracking-wider">
                Priority
              </span>
            </label>
          </div>
        </div>

        {/* Variables */}
        <div>
          <h3 className="text-xs font-rajdhani uppercase tracking-widest text-muted-foreground font-bold mb-2">
            Variables
          </h3>
          <SequenceBuilderVariableManager variables={variables} onChange={setVariables} />
        </div>

        {/* Steps */}
        <div>
          <h3 className="text-xs font-rajdhani uppercase tracking-widest text-muted-foreground font-bold mb-2">
            Steps
          </h3>
          <div className="space-y-2">
            {steps.map((step, i) => (
              <SequenceBuilderStepEditor
                key={step.id}
                step={step}
                index={i}
                intents={intents}
                onChange={(updated) => handleUpdateStep(i, updated)}
                onRemove={() => handleRemoveStep(i)}
              />
            ))}
          </div>
          <button
            onClick={handleAddStep}
            className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-border text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors text-sm font-rajdhani uppercase tracking-wider"
          >
            <Plus className="w-4 h-4" />
            Add Step
          </button>
        </div>

        {/* Validation errors */}
        {errors.length > 0 && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
            <ul className="text-xs text-destructive space-y-1">
              {errors.map((err, i) => (
                <li key={i}>• {err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* JSON Preview */}
        <div>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-2 text-xs font-rajdhani uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            {showPreview ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <Code className="w-3.5 h-3.5" />
            Preview JSON
          </button>
          {showPreview && (
            <div className="mt-2 bg-black/30 rounded-lg p-4 overflow-x-auto">
              <pre className="font-jetbrains text-xs text-foreground/80 whitespace-pre-wrap">
                {JSON.stringify(builtSequence, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
