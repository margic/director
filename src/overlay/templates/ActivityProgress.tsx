/**
 * ActivityProgress — Sequence Executor overlay template.
 *
 * Shows the current sequence being executed with progress state.
 * Appears in the lower-third region during sequence execution.
 *
 * Data shape:
 * - title: string (sequence name)
 * - step: number (current step number)
 * - total: number (total step count)
 * - label: string (current step human-readable label)
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 3.1
 */

import React from 'react';
import { OverlayTemplateProps } from './index';

export const ActivityProgress: React.FC<OverlayTemplateProps> = ({ data }) => {
  const title = (data.title as string) ?? 'Unknown Sequence';
  const step = (data.step as number) ?? 0;
  const total = (data.total as number) ?? 1;
  const label = (data.label as string) ?? '';
  
  const percentage = total > 0 ? Math.round((step / total) * 100) : 0;

  return (
    <div className="overlay-panel overlay-panel-accent" style={{
      maxWidth: '700px',
      margin: '0 auto',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '8px',
      }}>
        <div>
          <div className="overlay-text-muted" style={{ marginBottom: '4px' }}>
            DIRECTOR SEQUENCE
          </div>
          <div className="overlay-text-primary" style={{
            fontSize: '18px',
            lineHeight: '1.2',
          }}>
            {title}
          </div>
        </div>
        <div className="overlay-text-data" style={{
          fontSize: '24px',
          color: '#FF5F1F',
          whiteSpace: 'nowrap',
          marginLeft: '16px',
        }}>
          {step}/{total}
        </div>
      </div>

      {/* Current step label */}
      <div style={{
        fontSize: '13px',
        color: 'rgba(255, 255, 255, 0.7)',
        marginBottom: '8px',
        fontFamily: 'Rajdhani, sans-serif',
        fontWeight: 500,
      }}>
        {label}
      </div>

      {/* Progress bar */}
      <div style={{
        height: '4px',
        background: 'rgba(255, 255, 255, 0.1)',
        borderRadius: '2px',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${percentage}%`,
          background: 'linear-gradient(90deg, #FF5F1F 0%, #FF8F5F 100%)',
          transition: 'width 500ms ease-out',
        }} />
      </div>
    </div>
  );
};
