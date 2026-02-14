/**
 * Overlay Template Registry
 *
 * Maps template IDs to React components.
 * Built-in templates are imported directly.
 * Extension-provided templates (Decision Q7) will be loaded as HTML
 * in a future phase — for now only built-in templates are supported.
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 2.4
 */

import React from 'react';
import { ActivityProgress } from './ActivityProgress';
import { RaceInfoBar } from './RaceInfoBar';
import { StatusBadge } from './StatusBadge';
import { FlagAlert } from './FlagAlert';
import { ChatTicker } from './ChatTicker';
import { Standings } from './Standings';

/** Props interface for all overlay templates. */
export interface OverlayTemplateProps {
  data: Record<string, unknown>;
}

/**
 * Placeholder template — shown when a template ID is not yet implemented.
 * Displays the template name and raw data for debugging.
 */
const PlaceholderTemplate: React.FC<OverlayTemplateProps> = ({ data }) => (
  <div style={{
    padding: '12px 20px',
    background: 'rgba(9, 11, 16, 0.85)',
    borderLeft: '3px solid #FF5F1F',
    backdropFilter: 'blur(8px)',
    color: '#fff',
    fontFamily: 'Rajdhani, sans-serif',
    fontSize: '14px',
  }}>
    <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '2px', color: '#888', marginBottom: '4px' }}>
      TEMPLATE PLACEHOLDER
    </div>
    <pre style={{ margin: 0, fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#ccc', whiteSpace: 'pre-wrap' }}>
      {JSON.stringify(data, null, 2)}
    </pre>
  </div>
);

/** Template registry — maps template IDs to React components. */
const templates: Record<string, React.FC<OverlayTemplateProps>> = {
  'ActivityProgress': ActivityProgress,
  'RaceInfoBar': RaceInfoBar,
  'StatusBadge': StatusBadge,
  'FlagAlert': FlagAlert,
  'ChatTicker': ChatTicker,
  'Standings': Standings,
};

/**
 * Look up a template component by ID.
 * Returns the component if found, or a placeholder for unknown templates.
 */
export function getTemplate(templateId: string): React.FC<OverlayTemplateProps> {
  return templates[templateId] ?? PlaceholderTemplate;
}

/**
 * Register a custom template at runtime (used by extension-provided templates).
 */
export function registerTemplate(id: string, component: React.FC<OverlayTemplateProps>): void {
  templates[id] = component;
}
