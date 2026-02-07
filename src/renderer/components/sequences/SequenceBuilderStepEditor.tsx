/**
 * SequenceBuilderStepEditor — Per-step intent + payload form.
 *
 * Allows selecting an intent from the catalog and filling payload fields.
 *
 * See: documents/feature_sequence_executor_ux.md §10.1
 */

import React from 'react';
import { SequenceStep, IntentCatalogEntry } from '../../types';
import { GripVertical, X } from 'lucide-react';

interface SequenceBuilderStepEditorProps {
  step: SequenceStep;
  index: number;
  intents: IntentCatalogEntry[];
  onChange: (step: SequenceStep) => void;
  onRemove: () => void;
}

export const SequenceBuilderStepEditor: React.FC<SequenceBuilderStepEditorProps> = ({
  step,
  index,
  intents,
  onChange,
  onRemove,
}) => {
  const inputClasses =
    'w-full bg-card border border-border rounded px-3 py-1.5 text-sm font-jetbrains text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors';

  const handleIntentChange = (intentId: string) => {
    onChange({ ...step, intent: intentId });
  };

  const handlePayloadChange = (key: string, value: string) => {
    onChange({
      ...step,
      payload: { ...step.payload, [key]: value },
    });
  };

  const handleAddPayloadField = () => {
    const key = `field_${Object.keys(step.payload).length + 1}`;
    onChange({
      ...step,
      payload: { ...step.payload, [key]: '' },
    });
  };

  const handleRemovePayloadField = (key: string) => {
    const newPayload = { ...step.payload };
    delete newPayload[key];
    onChange({ ...step, payload: newPayload });
  };

  const handleLabelChange = (label: string) => {
    onChange({
      ...step,
      metadata: { ...step.metadata, label },
    });
  };

  // Group intents by domain for dropdown
  const intentOptions = intents.map((i) => ({
    value: i.intentId,
    label: `${i.intentId}${i.label ? ` — ${i.label}` : ''}`,
  }));

  // Add system intents that aren't in the catalog
  const systemIntents = [
    { value: 'system.wait', label: 'system.wait — Wait (delay)' },
    { value: 'system.log', label: 'system.log — Log message' },
  ];

  const allIntents = [
    ...systemIntents.filter((s) => !intentOptions.some((i) => i.value === s.value)),
    ...intentOptions,
  ];

  return (
    <div className="bg-background border border-border rounded-lg p-3 group">
      <div className="flex items-center gap-2 mb-3">
        {/* Drag handle */}
        <GripVertical className="w-4 h-4 text-muted-foreground/40 cursor-grab" />

        <span className="text-xs font-jetbrains text-muted-foreground w-6">
          {index + 1}.
        </span>

        {/* Intent selector */}
        <select
          value={step.intent}
          onChange={(e) => handleIntentChange(e.target.value)}
          className={`${inputClasses} flex-1`}
        >
          <option value="">Select intent...</option>
          {allIntents.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Remove button */}
        <button
          onClick={onRemove}
          className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
          title="Remove step"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Label */}
      <div className="ml-8 mb-2">
        <input
          type="text"
          value={step.metadata?.label ?? ''}
          onChange={(e) => handleLabelChange(e.target.value)}
          placeholder="Step label (optional)..."
          className={`${inputClasses} text-xs`}
        />
      </div>

      {/* Payload fields */}
      <div className="ml-8 space-y-2">
        {Object.entries(step.payload).map(([key, value]) => (
          <div key={key} className="flex items-center gap-2">
            <input
              type="text"
              value={key}
              onChange={(e) => {
                const newPayload = { ...step.payload };
                delete newPayload[key];
                newPayload[e.target.value] = value;
                onChange({ ...step, payload: newPayload });
              }}
              className={`${inputClasses} w-32 text-xs`}
              placeholder="key"
            />
            <span className="text-muted-foreground text-xs">:</span>
            <input
              type="text"
              value={String(value)}
              onChange={(e) => handlePayloadChange(key, e.target.value)}
              className={`${inputClasses} flex-1 text-xs`}
              placeholder="value (use $var(name) for variables)"
            />
            <button
              onClick={() => handleRemovePayloadField(key)}
              className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        <button
          onClick={handleAddPayloadField}
          className="text-xs text-muted-foreground hover:text-primary transition-colors font-rajdhani uppercase tracking-wider"
        >
          + Add Field
        </button>
      </div>
    </div>
  );
};
