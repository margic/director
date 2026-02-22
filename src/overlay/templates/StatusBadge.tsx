/**
 * StatusBadge — Compact corner badge template.
 *
 * Shows a status indicator with icon and label.
 * Appears in corner regions for extensions like Discord, YouTube, OBS.
 *
 * Data shape:
 * - icon: string (emoji or single char, e.g. "🎙️", "👥", "🔴")
 * - label: string (main text)
 * - detail?: string (optional secondary text)
 * - color?: string (optional accent color, defaults to secondary)
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 3.1
 */

import React from 'react';
import { OverlayTemplateProps } from './index';

export const StatusBadge: React.FC<OverlayTemplateProps> = ({ data }) => {
  const icon = (data.icon as string) ?? '📡';
  const label = (data.label as string) ?? 'Status';
  const detail = data.detail as string | undefined;
  const color = (data.color as string) ?? '#00A3E0';

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      background: 'rgba(9, 11, 16, 0.9)',
      backdropFilter: 'blur(8px)',
      border: '1px solid rgba(40, 42, 48, 0.8)',
      borderRadius: '8px',
      padding: '8px 14px',
      minWidth: '120px',
    }}>
      {/* Icon */}
      <div style={{
        fontSize: '18px',
        lineHeight: '1',
        filter: `drop-shadow(0 0 4px ${color})`,
      }}>
        {icon}
      </div>

      {/* Text */}
      <div style={{ flex: 1 }}>
        <div style={{
          fontFamily: 'Rajdhani, sans-serif',
          fontSize: '13px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: '#fff',
          lineHeight: '1.2',
        }}>
          {label}
        </div>
        {detail && (
          <div className="overlay-text-data" style={{
            fontSize: '11px',
            color: color,
            marginTop: '2px',
          }}>
            {detail}
          </div>
        )}
      </div>
    </div>
  );
};
