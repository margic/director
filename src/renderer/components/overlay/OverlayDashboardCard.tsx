/**
 * OverlayDashboardCard — Dashboard widget for the Broadcast Overlay system.
 *
 * Shows overlay server status, registered overlay count, and a quick-action
 * button to open the Overlay management page.
 * Follows the same h-64 card pattern as SequencesDashboardCard.
 *
 * See: documents/feature_overlay_system.md §Dashboard Widget
 */

import React, { useState, useEffect } from 'react';
import { Layers, Wifi, WifiOff } from 'lucide-react';
import type { OverlaySlot } from '@/src/main/overlay/overlay-types';

interface OverlayDashboardCardProps {
  onClick: () => void;
}

export const OverlayDashboardCard: React.FC<OverlayDashboardCardProps> = ({ onClick }) => {
  const [overlayUrl, setOverlayUrl] = useState<string>('');
  const [overlaySlots, setOverlaySlots] = useState<OverlaySlot[]>([]);
  const [serverReachable, setServerReachable] = useState<boolean | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!window.electronAPI?.overlay) return;
      try {
        const [url, slots] = await Promise.all([
          window.electronAPI.overlay.getUrl(),
          window.electronAPI.overlay.getOverlays(),
        ]);
        setOverlayUrl(url);
        setOverlaySlots(slots);

        // Quick health check — can we reach the overlay server?
        try {
          const resp = await fetch(url, { method: 'HEAD', mode: 'no-cors' });
          setServerReachable(true);
        } catch {
          setServerReachable(false);
        }
      } catch (e) {
        console.error('Failed to load overlay data', e);
      }
    };

    load();
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, []);

  const visibleCount = overlaySlots.filter((s) => s.visible).length;

  // Status
  let dotColor = 'bg-muted-foreground/40';
  let statusText = 'OFFLINE';
  if (serverReachable === true) {
    dotColor = visibleCount > 0 ? 'bg-green-500 animate-pulse' : 'bg-green-500';
    statusText = visibleCount > 0 ? 'BROADCASTING' : 'READY';
  } else if (serverReachable === false) {
    dotColor = 'bg-destructive';
    statusText = 'UNREACHABLE';
  }

  return (
    <div
      className="bg-card border border-border rounded-xl p-6 h-64 flex flex-col justify-between hover:border-secondary/50 transition-colors group relative overflow-hidden cursor-pointer"
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex justify-between items-center z-10">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-muted-foreground group-hover:text-secondary transition-colors" />
          <h3 className="text-muted-foreground text-sm font-bold uppercase tracking-wider font-rajdhani">
            Broadcast Overlay
          </h3>
        </div>
        <div className={`w-3 h-3 rounded-full ${dotColor}`} />
      </div>

      {/* Body */}
      <div className="z-10">
        <div className="text-2xl font-jetbrains font-bold text-white mb-1">
          {statusText}
        </div>
        <div className="text-xs text-muted-foreground font-rajdhani flex items-center gap-2">
          {serverReachable ? (
            <Wifi className="w-3 h-3 text-green-400" />
          ) : (
            <WifiOff className="w-3 h-3 text-muted-foreground" />
          )}
          <span>
            {overlaySlots.length} overlays · {visibleCount} visible
          </span>
        </div>
      </div>

      {/* Footer */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="z-10 w-full py-3 rounded-lg font-bold flex items-center justify-center gap-2 bg-secondary text-black hover:bg-secondary/90 shadow-[0_0_20px_rgba(0,163,224,0.3)] transition-all"
      >
        <Layers className="w-4 h-4" />
        <span className="font-rajdhani uppercase tracking-wider">Open Overlay</span>
      </button>

      {/* Background effect when broadcasting */}
      {visibleCount > 0 && serverReachable && (
        <div className="absolute inset-0 bg-secondary/5 animate-pulse pointer-events-none" />
      )}
    </div>
  );
};
