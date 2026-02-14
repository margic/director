/**
 * OverlayHost — Root component for the overlay SPA.
 *
 * Renders a 1920×1080 fixed canvas with named regions.
 * Connects to the OverlayServer via WebSocket for real-time updates.
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 2.4
 */

import React, { useMemo } from 'react';
import { useOverlaySocket, OverlaySlot } from './useOverlaySocket';
import { OverlayRegion } from './OverlayRegion';

const ALL_REGIONS = [
  'top-bar',
  'lower-third',
  'ticker',
  'center-popup',
  'corner-top-left',
  'corner-top-right',
] as const;

export interface OverlayHostProps {
  /** Only render these regions (undefined = all) */
  filterRegions?: string[];
  /** WebSocket URL */
  wsUrl: string;
}

export const OverlayHost: React.FC<OverlayHostProps> = ({ filterRegions, wsUrl }) => {
  const { overlays, connected } = useOverlaySocket(wsUrl);

  // Group overlays by region
  const byRegion = useMemo(() => {
    const map = new Map<string, OverlaySlot[]>();
    for (const region of ALL_REGIONS) {
      map.set(region, []);
    }
    for (const overlay of overlays.values()) {
      const existing = map.get(overlay.region);
      if (existing) {
        existing.push(overlay);
      }
    }
    return map;
  }, [overlays]);

  // Filter regions if specified
  const regions = filterRegions
    ? ALL_REGIONS.filter((r) => filterRegions.includes(r))
    : [...ALL_REGIONS];

  return (
    <div className="overlay-canvas">
      {regions.map((region) => (
        <OverlayRegion
          key={region}
          region={region}
          overlays={byRegion.get(region) ?? []}
        />
      ))}

      {/* Connection indicator (only visible in dev/debug) */}
      {!connected && (
        <div className="overlay-connection-indicator">
          Connecting...
        </div>
      )}
    </div>
  );
};
