/**
 * Properties Panel
 *
 * Right panel of the sequence builder showing:
 * - Sequence metadata (name, description, version, priority) when no step selected
 * - Step configuration (intent, payload fields, metadata) when step selected
 * - Variables manager (always visible in a collapsed section)
 * - JSON preview (collapsible raw JSON)
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 4.4
 */

import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Code2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { getIntentDomain, getIntentAction } from '@/lib/intent-utils';
import type { SequenceStep, SequenceVariable, PortableSequence, IntentCatalogEntry } from '@/types';

/** JSON Schema property descriptor (subset we support). */
interface SchemaProperty {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

/** Parsed intent schema with properties and required list. */
interface ParsedSchema {
  properties: Record<string, SchemaProperty>;
  required: string[];
}

export interface PropertiesPanelProps {
  sequence: PortableSequence;
  selectedStep: SequenceStep | null;
  selectedStepIndex: number | null;
  intents?: IntentCatalogEntry[];
  onSequenceChange: (updates: Partial<PortableSequence>) => void;
  onStepChange: (index: number, updates: Partial<SequenceStep>) => void;
  onVariableChange: (variables: SequenceVariable[]) => void;
  readonly?: boolean;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  sequence,
  selectedStep,
  selectedStepIndex,
  intents = [],
  onSequenceChange,
  onStepChange,
  onVariableChange,
  readonly = false,
}) => {
  const [variablesExpanded, setVariablesExpanded] = useState(false);
  const [jsonExpanded, setJsonExpanded] = useState(false);
  const [metadataExpanded, setMetadataExpanded] = useState(false);

  const variables = sequence.variables || [];

  // Resolve the JSON Schema for the currently selected step's intent
  const resolvedSchema = useMemo((): ParsedSchema | null => {
    if (!selectedStep) return null;
    const entry = intents.find((i) => i.intentId === selectedStep.intent);
    const raw = entry?.inputSchema as { properties?: Record<string, SchemaProperty>; required?: string[] } | undefined;
    if (!raw?.properties) return null;
    return {
      properties: raw.properties,
      required: raw.required ?? [],
    };
  }, [selectedStep, intents]);

  // Handlers for metadata changes
  const handleMetadataChange = (field: keyof PortableSequence, value: unknown) => {
    if (readonly) return;
    onSequenceChange({ [field]: value });
  };

  // Handlers for step changes
  const handleStepMetadataChange = (field: 'label' | 'timeout', value: unknown) => {
    if (readonly || selectedStepIndex === null || !selectedStep) return;
    const metadata = { ...selectedStep.metadata, [field]: value };
    onStepChange(selectedStepIndex, { metadata });
  };

  const handlePayloadChange = (key: string, value: unknown) => {
    if (readonly || selectedStepIndex === null || !selectedStep) return;
    const payload = { ...selectedStep.payload, [key]: value };
    onStepChange(selectedStepIndex, { payload });
  };

  return (
    <div className="flex flex-col h-full bg-card border-l border-border overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <h3 className="text-xs font-rajdhani font-bold uppercase tracking-widest text-muted-foreground">
          Properties
        </h3>
      </div>

      <div className="flex-1 p-4 space-y-6">
        {/* Sequence Name — always visible */}
        <div className="space-y-3">
          <div>
            <Label htmlFor="seq-name" className="text-xs font-rajdhani uppercase">
              Sequence Name *
            </Label>
            <Input
              id="seq-name"
              value={sequence.name || ''}
              onChange={(e) => handleMetadataChange('name', e.target.value)}
              disabled={readonly}
              className="mt-1 font-jetbrains text-sm"
              placeholder="My Sequence"
            />
          </div>
        </div>

        {/* Additional Sequence Metadata (collapsible) */}
        <div className="border-t border-border pt-4">
          <button
            onClick={() => setMetadataExpanded(!metadataExpanded)}
            className="w-full flex items-center gap-2 mb-3 text-sm font-rajdhani font-bold uppercase tracking-wider text-foreground hover:text-primary transition-colors"
          >
            {metadataExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Sequence Details
          </button>

          {metadataExpanded && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="seq-desc" className="text-xs font-rajdhani uppercase">
                  Description
                </Label>
                <Textarea
                  id="seq-desc"
                  value={sequence.description || ''}
                  onChange={(e) => handleMetadataChange('description', e.target.value)}
                  disabled={readonly}
                  className="mt-1 font-jetbrains text-sm"
                  rows={3}
                  placeholder="Describe what this sequence does..."
                />
              </div>

              <div>
                <Label htmlFor="seq-version" className="text-xs font-rajdhani uppercase">
                  Version
                </Label>
                <Input
                  id="seq-version"
                  value={sequence.version || ''}
                  onChange={(e) => handleMetadataChange('version', e.target.value)}
                  disabled={readonly}
                  className="mt-1 font-jetbrains text-sm"
                  placeholder="1.0.0"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="seq-priority" className="text-xs font-rajdhani uppercase">
                  Priority Execution
                </Label>
                <Switch
                  id="seq-priority"
                  checked={sequence.priority || false}
                  onCheckedChange={(checked) => handleMetadataChange('priority', checked)}
                  disabled={readonly}
                />
              </div>
            </div>
          )}
        </div>

        {/* Step Configuration (when step selected) */}
        {selectedStep && (
          <div className="space-y-4">
            <h4 className="text-sm font-rajdhani font-bold uppercase tracking-wider text-foreground">
              Step {selectedStepIndex !== null ? selectedStepIndex + 1: ''}: {getIntentAction(selectedStep.intent)}
            </h4>

            <div className="space-y-3">
              <div>
                <Label className="text-xs font-rajdhani uppercase text-muted-foreground">
                  Intent
                </Label>
                <div className="mt-1 p-2 bg-background border border-border rounded font-jetbrains text-xs text-foreground">
                  {selectedStep.intent}
                </div>
              </div>

              <div>
                <Label htmlFor="step-label" className="text-xs font-rajdhani uppercase">
                  Display Label
                </Label>
                <Input
                  id="step-label"
                  value={selectedStep.metadata?.label || ''}
                  onChange={(e) => handleStepMetadataChange('label', e.target.value)}
                  disabled={readonly}
                  className="mt-1 font-jetbrains text-sm"
                  placeholder={getIntentAction(selectedStep.intent)}
                />
              </div>

              <div>
                <Label htmlFor="step-timeout" className="text-xs font-rajdhani uppercase">
                  Timeout (ms)
                </Label>
                <Input
                  id="step-timeout"
                  type="number"
                  value={selectedStep.metadata?.timeout || ''}
                  onChange={(e) => handleStepMetadataChange('timeout', parseInt(e.target.value) || undefined)}
                  disabled={readonly}
                  className="mt-1 font-jetbrains text-sm"
                  placeholder="30000"
                />
              </div>

              {/* Payload Editor — schema-driven */}
              <div>
                <Label className="text-xs font-rajdhani uppercase text-muted-foreground mb-2 block">
                  Payload
                </Label>
                {(() => {
                  // Merge schema properties with any existing payload keys
                  const schemaProps = resolvedSchema?.properties ?? {};
                  const requiredKeys = new Set(resolvedSchema?.required ?? []);
                  const allKeys = new Set([
                    ...Object.keys(schemaProps),
                    ...Object.keys(selectedStep.payload),
                  ]);

                  if (allKeys.size === 0) {
                    return (
                      <p className="text-xs text-muted-foreground italic">
                        No payload fields — this intent takes no parameters.
                      </p>
                    );
                  }

                  return (
                    <div className="space-y-3">
                      {[...allKeys].map((key) => {
                        const prop = schemaProps[key];
                        const propType = prop?.type ?? 'string';
                        const isRequired = requiredKeys.has(key);
                        const description = prop?.description;
                        const currentValue = selectedStep.payload[key];

                        // Boolean → Switch
                        if (propType === 'boolean') {
                          return (
                            <div key={key} className="flex items-center justify-between">
                              <div>
                                <Label htmlFor={`payload-${key}`} className="text-xs font-jetbrains">
                                  {key}
                                  {isRequired && <span className="text-destructive ml-0.5">*</span>}
                                </Label>
                                {description && (
                                  <p className="text-[10px] text-muted-foreground">{description}</p>
                                )}
                              </div>
                              <Switch
                                id={`payload-${key}`}
                                checked={!!currentValue}
                                onCheckedChange={(checked) => handlePayloadChange(key, checked)}
                                disabled={readonly}
                              />
                            </div>
                          );
                        }

                        // Enum → Select
                        if (prop?.enum && prop.enum.length > 0) {
                          return (
                            <div key={key}>
                              <Label htmlFor={`payload-${key}`} className="text-xs font-jetbrains">
                                {key}
                                {isRequired && <span className="text-destructive ml-0.5">*</span>}
                              </Label>
                              {description && (
                                <p className="text-[10px] text-muted-foreground">{description}</p>
                              )}
                              <select
                                id={`payload-${key}`}
                                value={String(currentValue ?? '')}
                                onChange={(e) => handlePayloadChange(key, e.target.value)}
                                disabled={readonly}
                                className="mt-1 w-full rounded border border-border bg-background px-3 py-2 font-jetbrains text-sm text-foreground"
                              >
                                <option value="">Select…</option>
                                {prop.enum.map((v) => (
                                  <option key={String(v)} value={String(v)}>
                                    {String(v)}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        }

                        // Number → Input type=number
                        if (propType === 'number' || propType === 'integer') {
                          return (
                            <div key={key}>
                              <Label htmlFor={`payload-${key}`} className="text-xs font-jetbrains">
                                {key}
                                {isRequired && <span className="text-destructive ml-0.5">*</span>}
                              </Label>
                              {description && (
                                <p className="text-[10px] text-muted-foreground">{description}</p>
                              )}
                              <Input
                                id={`payload-${key}`}
                                type="number"
                                value={currentValue !== undefined && currentValue !== null ? String(currentValue) : ''}
                                onChange={(e) => {
                                  const num = parseFloat(e.target.value);
                                  handlePayloadChange(key, isNaN(num) ? undefined : num);
                                }}
                                disabled={readonly}
                                className="mt-1 font-jetbrains text-sm"
                                placeholder={description ?? key}
                              />
                            </div>
                          );
                        }

                        // Default: String → Input type=text
                        return (
                          <div key={key}>
                            <Label htmlFor={`payload-${key}`} className="text-xs font-jetbrains">
                              {key}
                              {isRequired && <span className="text-destructive ml-0.5">*</span>}
                            </Label>
                            {description && (
                              <p className="text-[10px] text-muted-foreground">{description}</p>
                            )}
                            <Input
                              id={`payload-${key}`}
                              value={String(currentValue ?? '')}
                              onChange={(e) => handlePayloadChange(key, e.target.value)}
                              disabled={readonly}
                              className="mt-1 font-jetbrains text-sm"
                              placeholder={description ?? key}
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Variables Section (collapsible) */}
        <div className="border-t border-border pt-4">
          <button
            onClick={() => setVariablesExpanded(!variablesExpanded)}
            className="w-full flex items-center gap-2 mb-3 text-sm font-rajdhani font-bold uppercase tracking-wider text-foreground hover:text-primary transition-colors"
          >
            {variablesExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Variables ({variables.length})
          </button>

          {variablesExpanded && (
            <div className="space-y-2">
              {variables.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No variables defined</p>
              ) : (
                variables.map((v, i) => (
                  <div key={i} className="p-2 bg-background border border-border rounded">
                    <div className="text-xs font-jetbrains font-semibold text-foreground">{v.name}</div>
                    <div className="text-[10px] font-jetbrains text-muted-foreground">{v.label} • {v.type}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* JSON Preview (collapsible) */}
        <div className="border-t border-border pt-4">
          <button
            onClick={() => setJsonExpanded(!jsonExpanded)}
            className="w-full flex items-center gap-2 mb-3 text-sm font-rajdhani font-bold uppercase tracking-wider text-foreground hover:text-primary transition-colors"
          >
            {jsonExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <Code2 className="w-4 h-4" />
            JSON Preview
          </button>

          {jsonExpanded && (
            <pre className="p-3 bg-background border border-border rounded overflow-x-auto text-[10px] font-jetbrains text-foreground">
              {JSON.stringify(selectedStep || sequence, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
