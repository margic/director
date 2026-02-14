/**
 * Standings — Compact race leaderboard.
 *
 * Displays top N drivers in descending position order with car number and gap.
 * Appears in the lower-third region during race broadcast.
 *
 * Data shape:
 * - title?: string (default: "STANDINGS")
 * - entries: Array<{ position: number, carNum: string, name: string, gap: string }>
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 3.1
 */

import React from 'react';
import { OverlayTemplateProps } from './index';

interface StandingEntry {
  position: number;
  carNum: string;
  name: string;
  gap: string;
}

export const Standings: React.FC<OverlayTemplateProps> = ({ data }) => {
  const title = (data.title as string) ?? 'STANDINGS';
  const entries = (data.entries as StandingEntry[]) ?? [];

  if (entries.length === 0) {
    return null;
  }

  return (
    <div style={{
      background: 'rgba(17, 19, 23, 0.9)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255, 95, 31, 0.3)',
      borderRadius: '8px',
      padding: '16px',
      minWidth: '400px',
      maxWidth: '500px',
    }}>
      {/* Header */}
      <div style={{
        fontFamily: 'Rajdhani, sans-serif',
        fontSize: '14px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '2px',
        color: 'rgba(229, 231, 235, 0.6)',
        marginBottom: '12px',
        borderBottom: '1px solid rgba(255, 95, 31, 0.3)',
        paddingBottom: '8px',
      }}>
        {title}
      </div>

      {/* Standings list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {entries.map((entry, index) => (
          <div
            key={index}
            style={{
              display: 'grid',
              gridTemplateColumns: '40px 60px 1fr 80px',
              alignItems: 'center',
              gap: '12px',
              padding: '6px 8px',
              background: index === 0 
                ? 'rgba(255, 95, 31, 0.15)' 
                : 'rgba(40, 42, 48, 0.5)',
              borderRadius: '4px',
              borderLeft: index === 0 ? '3px solid #FF5F1F' : '3px solid transparent',
            }}
          >
            {/* Position */}
            <div style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '18px',
              fontWeight: 700,
              color: index === 0 ? '#FF5F1F' : '#E5E7EB',
              textAlign: 'center',
            }}>
              {entry.position}
            </div>

            {/* Car number */}
            <div style={{
              fontFamily: 'Rajdhani, sans-serif',
              fontSize: '16px',
              fontWeight: 700,
              color: '#00A3E0',
              textAlign: 'center',
              background: 'rgba(0, 163, 224, 0.15)',
              padding: '4px 8px',
              borderRadius: '4px',
            }}>
              #{entry.carNum}
            </div>

            {/* Driver name */}
            <div style={{
              fontFamily: 'Rajdhani, sans-serif',
              fontSize: '16px',
              fontWeight: 600,
              color: '#E5E7EB',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {entry.name}
            </div>

            {/* Gap */}
            <div style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '14px',
              fontWeight: 500,
              color: 'rgba(229, 231, 235, 0.7)',
              textAlign: 'right',
            }}>
              {entry.gap}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
