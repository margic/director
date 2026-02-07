/**
 * SequenceBuilderVariableManager — CRUD for variable definitions.
 *
 * Allows adding, editing, and removing runtime variables for a sequence.
 *
 * See: documents/feature_sequence_executor_ux.md §10.1
 */

import React from 'react';
import { SequenceVariable } from '../../types';
import { Plus, X } from 'lucide-react';

interface SequenceBuilderVariableManagerProps {
  variables: SequenceVariable[];
  onChange: (variables: SequenceVariable[]) => void;
}

const VARIABLE_TYPES: Array<{ value: SequenceVariable['type']; label: string }> = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'select', label: 'Select' },
  { value: 'sessionTime', label: 'Session Time' },
  { value: 'sessionTick', label: 'Session Tick' },
];

export const SequenceBuilderVariableManager: React.FC<SequenceBuilderVariableManagerProps> = ({
  variables,
  onChange,
}) => {
  const inputClasses =
    'bg-card border border-border rounded px-2 py-1 text-xs font-jetbrains text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors';

  const handleAdd = () => {
    const newVar: SequenceVariable = {
      name: `var${variables.length + 1}`,
      label: `Variable ${variables.length + 1}`,
      type: 'string',
      required: false,
      source: 'user',
    };
    onChange([...variables, newVar]);
  };

  const handleUpdate = (index: number, updates: Partial<SequenceVariable>) => {
    const updated = [...variables];
    updated[index] = { ...updated[index], ...updates };
    onChange(updated);
  };

  const handleRemove = (index: number) => {
    onChange(variables.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {variables.map((v, i) => (
        <div
          key={i}
          className="flex items-start gap-2 bg-background border border-border rounded-lg p-2"
        >
          <div className="flex-1 grid grid-cols-2 gap-2">
            <input
              type="text"
              value={v.name}
              onChange={(e) => handleUpdate(i, { name: e.target.value })}
              className={inputClasses}
              placeholder="name (camelCase)"
            />
            <input
              type="text"
              value={v.label}
              onChange={(e) => handleUpdate(i, { label: e.target.value })}
              className={inputClasses}
              placeholder="Label"
            />
            <select
              value={v.type}
              onChange={(e) => handleUpdate(i, { type: e.target.value as SequenceVariable['type'] })}
              className={inputClasses}
            >
              {VARIABLE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <select
              value={v.source ?? 'user'}
              onChange={(e) => handleUpdate(i, { source: e.target.value as 'user' | 'context' })}
              className={inputClasses}
            >
              <option value="user">User Input</option>
              <option value="context">Context</option>
            </select>
            <input
              type="text"
              value={v.default !== undefined ? String(v.default) : ''}
              onChange={(e) => handleUpdate(i, { default: e.target.value || undefined })}
              className={inputClasses}
              placeholder="default"
            />
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={v.required}
                onChange={(e) => handleUpdate(i, { required: e.target.checked })}
                className="rounded border-border bg-card text-primary"
              />
              <span className="text-muted-foreground">Required</span>
            </label>
          </div>
          <button
            onClick={() => handleRemove(i)}
            className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors mt-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      <button
        onClick={handleAdd}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-border text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors text-xs font-rajdhani uppercase tracking-wider"
      >
        <Plus className="w-3.5 h-3.5" />
        Add Variable
      </button>
    </div>
  );
};
