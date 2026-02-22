/**
 * SequenceVariablesForm — Dynamic form for runtime variables.
 *
 * Renders input fields based on SequenceVariable[] definitions.
 * Handles string, number, boolean, select, and temporal scalar types.
 *
 * See: documents/feature_sequence_executor_ux.md §5.6
 */

import React, { useState, useEffect } from 'react';
import { SequenceVariable } from '../../types';

interface SequenceVariablesFormProps {
  variables: SequenceVariable[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  disabled?: boolean;
}

export const SequenceVariablesForm: React.FC<SequenceVariablesFormProps> = ({
  variables,
  values,
  onChange,
  disabled = false,
}) => {
  if (variables.length === 0) {
    return (
      <div className="bg-background border border-border rounded-lg p-4">
        <p className="text-sm text-muted-foreground italic text-center">
          No variables required
        </p>
      </div>
    );
  }

  const handleChange = (name: string, value: unknown) => {
    onChange({ ...values, [name]: value });
  };

  return (
    <div className="bg-background border border-border rounded-lg p-4 space-y-4">
      {variables.map((v) => (
        <VariableField
          key={v.name}
          variable={v}
          value={values[v.name]}
          onChange={(val) => handleChange(v.name, val)}
          disabled={disabled}
        />
      ))}
    </div>
  );
};

interface VariableFieldProps {
  variable: SequenceVariable;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
}

const VariableField: React.FC<VariableFieldProps> = ({
  variable,
  value,
  onChange,
  disabled,
}) => {
  const { name, label, type, required, description, constraints, source } = variable;

  const inputClasses =
    'w-full bg-card border border-border rounded px-3 py-2 text-sm font-jetbrains text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors disabled:opacity-50';

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <label className="font-rajdhani text-sm uppercase tracking-wide text-muted-foreground">
          {label}
        </label>
        {required && <span className="text-destructive text-xs font-bold">*</span>}
        {source === 'context' && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/10 text-secondary font-bold uppercase">
            Context
          </span>
        )}
      </div>

      {description && (
        <p className="text-xs text-muted-foreground mb-1.5">{description}</p>
      )}

      {type === 'string' && (
        <input
          type="text"
          className={inputClasses}
          value={(value as string) ?? ''}
          placeholder={variable.default ? String(variable.default) : ''}
          onChange={(e) => onChange(e.target.value)}
          pattern={constraints?.pattern}
          disabled={disabled}
        />
      )}

      {type === 'number' && (
        <input
          type="number"
          className={inputClasses}
          value={value !== undefined ? Number(value) : ''}
          placeholder={variable.default !== undefined ? String(variable.default) : ''}
          min={constraints?.min}
          max={constraints?.max}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
          disabled={disabled}
        />
      )}

      {type === 'boolean' && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            className="rounded border-border bg-card text-primary focus:ring-primary"
          />
          <span className="text-sm text-foreground">{label}</span>
        </label>
      )}

      {type === 'select' && (
        <select
          className={inputClasses}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        >
          <option value="">Select...</option>
          {constraints?.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}

      {(type === 'sessionTime' || type === 'sessionTick') && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            className={inputClasses}
            value={value !== undefined ? Number(value) : ''}
            placeholder={`Current ${type === 'sessionTime' ? 'session time' : 'tick'}...`}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
            disabled={disabled}
            step={type === 'sessionTime' ? '0.01' : '1'}
          />
          <span className="text-xs text-muted-foreground font-jetbrains whitespace-nowrap">
            {type === 'sessionTime' ? 'seconds' : 'ticks'}
          </span>
        </div>
      )}
    </div>
  );
};
