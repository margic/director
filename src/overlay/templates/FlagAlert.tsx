/**
 * FlagAlert — Full-screen flag change alert.
 *
 * Shows a dramatic flag change notification in the center of the screen.
 * Appears in the center-popup region for critical race control events.
 *
 * Data shape:
 * - flag: string ('green' | 'yellow' | 'red' | 'white' | 'checkered')
 * - message: string (alert message, e.g. "Race Restarted", "Caution")
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 3.1
 */

import React from 'react';
import { OverlayTemplateProps } from './index';

const FLAG_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  green: { bg: 'rgba(34, 197, 94, 0.95)', text: '#fff', label: 'GREEN FLAG' },
  yellow: { bg: 'rgba(234, 179, 8, 0.95)', text: '#000', label: 'CAUTION' },
  red: { bg: 'rgba(239, 68, 68, 0.95)', text: '#fff', label: 'RED FLAG' },
  white: { bg: 'rgba(255, 255, 255, 0.95)', text: '#000', label: 'WHITE FLAG' },
  checkered: { bg: 'rgba(20, 20, 20, 0.95)', text: '#fff', label: 'CHECKERED FLAG' },
};

export const FlagAlert: React.FC<OverlayTemplateProps> = ({ data }) => {
  const flag = (data.flag as string)?.toLowerCase() ?? 'green';
  const message = (data.message as string) ?? 'Race Control';

  const style = FLAG_STYLES[flag] ?? FLAG_STYLES.green;

  return (
    <div style={{
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: style.bg,
      backdropFilter: 'blur(16px)',
      border: `4px solid ${style.text}`,
      borderRadius: '12px',
      padding: '32px 64px',
      minWidth: '400px',
      boxShadow: `0 0 40px ${style.bg}`,
    }}>
      {/* Flag label */}
      <div style={{
        fontFamily: 'Rajdhani, sans-serif',
        fontSize: '48px',
        fontWeight: 900,
        textTransform: 'uppercase',
        letterSpacing: '4px',
        color: style.text,
        lineHeight: '1',
        marginBottom: '16px',
        textShadow: flag === 'checkered' 
          ? '0 0 20px rgba(255, 255, 255, 0.5)' 
          : 'none',
      }}>
        {style.label}
      </div>

      {/* Message */}
      <div style={{
        fontFamily: 'Rajdhani, sans-serif',
        fontSize: '24px',
        fontWeight: 600,
        color: style.text,
        textAlign: 'center',
        opacity: 0.9,
      }}>
        {message}
      </div>
    </div>
  );
};
