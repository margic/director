/**
 * RaceInfoBar — iRacing race information top bar.
 *
 * Shows key race stats in a horizontal bar: lap, flag, leader, gap.
 * Appears in the top-bar region during iRacing sessions.
 *
 * Data shape:
 * - lap: string (e.g. "12/30")
 * - flag: string ('green' | 'yellow' | 'red' | 'white' | 'checkered')
 * - leader: string (driver name)
 * - leaderCarNum: string (car number)
 * - gap: string (gap to leader, e.g. "+2.4s")
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 3.1
 */

import React from 'react';
import { OverlayTemplateProps } from './index';

const FLAG_COLORS: Record<string, { bg: string; text: string }> = {
  green: { bg: 'rgba(34, 197, 94, 0.9)', text: '#fff' },
  yellow: { bg: 'rgba(234, 179, 8, 0.9)', text: '#000' },
  red: { bg: 'rgba(239, 68, 68, 0.9)', text: '#fff' },
  white: { bg: 'rgba(255, 255, 255, 0.9)', text: '#000' },
  checkered: { bg: 'linear-gradient(45deg, #000 25%, #fff 25%, #fff 50%, #000 50%, #000 75%, #fff 75%, #fff)', text: '#fff' },
};

export const RaceInfoBar: React.FC<OverlayTemplateProps> = ({ data }) => {
  const lap = (data.lap as string) ?? '—';
  const flag = (data.flag as string)?.toLowerCase() ?? 'green';
  const leader = (data.leader as string) ?? 'Unknown';
  const leaderCarNum = (data.leaderCarNum as string) ?? '—';
  const gap = (data.gap as string) ?? '';

  const flagStyle = FLAG_COLORS[flag] ?? FLAG_COLORS.green;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifycontent: 'center',
      background: 'rgba(9, 11, 16, 0.85)',
      backdropFilter: 'blur(12px)',
      borderBottom: '2px solid rgba(40, 42, 48, 0.8)',
      padding: '8px 24px',
      gap: '24px',
    }}>
      {/* Lap counter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span className="overlay-text-muted">LAP</span>
        <span className="overlay-text-data" style={{ fontSize: '18px', color: '#fff' }}>
          {lap}
        </span>
      </div>

      {/* Flag indicator */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: flagStyle.bg,
        padding: '4px 12px',
        borderRadius: '4px',
      }}>
        <span style={{
          fontFamily: 'Rajdhani, sans-serif',
          fontWeight: 700,
          fontSize: '12px',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          color: flagStyle.text,
        }}>
          {flag}
        </span>
      </div>

      {/* Leader */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span className="overlay-text-muted">LEADER</span>
        <span className="overlay-text-data" style={{
          fontSize: '14px',
          color: '#00A3E0',
        }}>
          #{leaderCarNum}
        </span>
        <span style={{
          fontFamily: 'Rajdhani, sans-serif',
          fontSize: '14px',
          color: '#fff',
        }}>
          {leader}
        </span>
      </div>

      {/* Gap (if not leader) */}
      {gap && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="overlay-text-muted">GAP</span>
          <span className="overlay-text-data" style={{ fontSize: '14px', color: '#FF5F1F' }}>
            {gap}
          </span>
        </div>
      )}
    </div>
  );
};
