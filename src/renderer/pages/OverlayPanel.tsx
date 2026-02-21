/**
 * OverlayPanel — Dedicated management page for the Broadcast Overlay system.
 *
 * Provides server status, URL copy/preview, OBS Browser Source setup instructions,
 * registered overlay listing, and a visual region map.
 *
 * Mirrors the layout conventions of SequencesPanel (two-column, full-height).
 *
 * See: documents/feature_overlay_system.md
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Layers, Copy, ExternalLink, CheckCircle2, Wifi, WifiOff, Eye, EyeOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { OverlaySlot } from '@/src/main/overlay/overlay-types';
import { useSetPageHeader } from '../contexts/PageHeaderContext';

/** All supported overlay regions (matches overlay-types.ts). */
const REGIONS = ['top-bar', 'lower-third', 'ticker', 'center-popup', 'corner-top-left', 'corner-top-right'] as const;

export const OverlayPanel: React.FC = () => {
  useSetPageHeader({ title: 'Broadcast Overlay', icon: Layers });

  const [overlayUrl, setOverlayUrl] = useState<string>('');
  const [overlaySlots, setOverlaySlots] = useState<OverlaySlot[]>([]);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [serverReachable, setServerReachable] = useState<boolean | null>(null);

  const loadData = useCallback(async () => {
    if (!window.electronAPI?.overlay) return;
    try {
      const [url, slots] = await Promise.all([
        window.electronAPI.overlay.getUrl(),
        window.electronAPI.overlay.getOverlays(),
      ]);
      setOverlayUrl(url);
      setOverlaySlots(slots);

      // Health check
      try {
        await fetch(url, { method: 'HEAD', mode: 'no-cors' });
        setServerReachable(true);
      } catch {
        setServerReachable(false);
      }
    } catch (e) {
      console.error('Failed to load overlay data', e);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  const copyOverlayUrl = async () => {
    if (overlayUrl) {
      await navigator.clipboard.writeText(overlayUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  };

  const openOverlayPreview = () => {
    if (overlayUrl) {
      window.open(overlayUrl, '_blank');
    }
  };

  const visibleCount = overlaySlots.filter((s) => s.visible).length;

  // Build region → overlays map
  const regionMap: Record<string, OverlaySlot[]> = {};
  for (const r of REGIONS) regionMap[r] = [];
  for (const slot of overlaySlots) {
    if (regionMap[slot.region]) {
      regionMap[slot.region].push(slot);
    }
  }

  return (
    <div className="w-full h-full p-6 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
        {/* ─── LEFT COLUMN ─── */}
        <div className="space-y-6 overflow-y-auto">
          {/* Server Status */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest flex items-center justify-between">
                <span>Overlay Server</span>
                <span className="flex items-center gap-2 text-xs">
                  {serverReachable === true ? (
                    <>
                      <Wifi className="w-4 h-4 text-green-400" />
                      <span className="text-green-400 font-jetbrains">RUNNING</span>
                    </>
                  ) : serverReachable === false ? (
                    <>
                      <WifiOff className="w-4 h-4 text-destructive" />
                      <span className="text-destructive font-jetbrains">UNREACHABLE</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground font-jetbrains">CHECKING…</span>
                  )}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Overlay URL */}
              <div className="space-y-2">
                <label className="text-xs font-rajdhani uppercase tracking-wider text-muted-foreground">
                  Overlay URL
                </label>
                <div className="flex gap-2">
                  <div className="flex-1 font-jetbrains text-sm bg-background border border-border rounded px-4 py-2 truncate">
                    {overlayUrl || 'http://localhost:9100/overlay'}
                  </div>
                  <Button onClick={copyOverlayUrl} variant="secondary" size="sm" className="gap-2 shrink-0">
                    {copiedUrl ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copy
                      </>
                    )}
                  </Button>
                  <Button onClick={openOverlayPreview} variant="outline" size="sm" className="gap-2 shrink-0">
                    <ExternalLink className="w-4 h-4" />
                    Preview
                  </Button>
                </div>
              </div>

              {/* Quick Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-background/50 border border-border/50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-jetbrains font-bold text-white">{overlaySlots.length}</div>
                  <div className="text-xs text-muted-foreground font-rajdhani uppercase tracking-wider">Registered</div>
                </div>
                <div className="bg-background/50 border border-border/50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-jetbrains font-bold text-green-400">{visibleCount}</div>
                  <div className="text-xs text-muted-foreground font-rajdhani uppercase tracking-wider">Visible</div>
                </div>
                <div className="bg-background/50 border border-border/50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-jetbrains font-bold text-secondary">{REGIONS.length}</div>
                  <div className="text-xs text-muted-foreground font-rajdhani uppercase tracking-wider">Regions</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Registered Overlays */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest">
                Registered Overlays ({overlaySlots.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {overlaySlots.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No overlays registered yet. Overlays are contributed by extensions and the sequence executor.
                </p>
              ) : (
                <div className="space-y-2">
                  {overlaySlots.map((slot) => (
                    <div
                      key={`${slot.extensionId}.${slot.id}`}
                      className="flex items-center justify-between p-3 border border-border/50 rounded-lg bg-background/50 hover:border-border transition-colors"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {slot.visible ? (
                            <Eye className="w-4 h-4 text-green-400 shrink-0" />
                          ) : (
                            <EyeOff className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                          )}
                          <h4 className="font-rajdhani font-bold text-sm truncate">
                            {slot.title}
                          </h4>
                          {slot.visible && (
                            <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded font-jetbrains shrink-0">
                              LIVE
                            </span>
                          )}
                        </div>
                        <div className="flex gap-3 text-xs text-muted-foreground font-jetbrains flex-wrap">
                          <span>Region: <strong>{slot.region}</strong></span>
                          <span>•</span>
                          <span>Template: <strong>{slot.template}</strong></span>
                          <span>•</span>
                          <span>Extension: <strong>{slot.extensionId}</strong></span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ─── RIGHT COLUMN ─── */}
        <div className="space-y-6 overflow-y-auto">
          {/* OBS Setup Instructions */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest">
                OBS Browser Source Setup
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="text-sm space-y-3 list-decimal list-inside text-muted-foreground">
                <li>In OBS, add a new <strong className="text-foreground">Browser</strong> source</li>
                <li>Paste the Overlay URL from the left panel</li>
                <li>
                  Set Width:{' '}
                  <code className="font-jetbrains bg-background px-2 py-0.5 rounded text-secondary">1920</code>,
                  Height:{' '}
                  <code className="font-jetbrains bg-background px-2 py-0.5 rounded text-secondary">1080</code>
                </li>
                <li>
                  Check{' '}
                  <strong className="text-foreground">"Shutdown source when not visible"</strong> and{' '}
                  <strong className="text-foreground">"Refresh browser when scene becomes active"</strong>
                </li>
                <li>Click OK — overlay graphics will appear during sequences / races</li>
              </ol>
            </CardContent>
          </Card>

          {/* Visual Region Map */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest">
                Region Map
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="aspect-video bg-background border border-border rounded-lg relative overflow-hidden p-1">
                {/* Top Bar */}
                <RegionBlock
                  name="top-bar"
                  slots={regionMap['top-bar']}
                  className="absolute top-1 left-1 right-1 h-[12%] rounded"
                />
                {/* Corner Top-Left */}
                <RegionBlock
                  name="corner-top-left"
                  slots={regionMap['corner-top-left']}
                  className="absolute top-[16%] left-1 w-[18%] h-[12%] rounded"
                />
                {/* Corner Top-Right */}
                <RegionBlock
                  name="corner-top-right"
                  slots={regionMap['corner-top-right']}
                  className="absolute top-[16%] right-1 w-[18%] h-[12%] rounded"
                />
                {/* Center Popup */}
                <RegionBlock
                  name="center-popup"
                  slots={regionMap['center-popup']}
                  className="absolute top-[35%] left-[25%] right-[25%] h-[22%] rounded"
                />
                {/* Lower Third */}
                <RegionBlock
                  name="lower-third"
                  slots={regionMap['lower-third']}
                  className="absolute bottom-[14%] left-[10%] right-[10%] h-[14%] rounded"
                />
                {/* Ticker */}
                <RegionBlock
                  name="ticker"
                  slots={regionMap['ticker']}
                  className="absolute bottom-1 left-1 right-1 h-[10%] rounded"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-3 italic">
                Regions light up when overlays are registered. Green indicates a visible overlay.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  RegionBlock — Mini region indicator inside the visual map          */
/* ------------------------------------------------------------------ */
interface RegionBlockProps {
  name: string;
  slots: OverlaySlot[];
  className?: string;
}

const RegionBlock: React.FC<RegionBlockProps> = ({ name, slots, className }) => {
  const hasSlots = slots.length > 0;
  const hasVisible = slots.some((s) => s.visible);

  let bg = 'bg-border/30';
  let border = 'border-border/50';
  if (hasVisible) {
    bg = 'bg-green-500/20';
    border = 'border-green-500/50';
  } else if (hasSlots) {
    bg = 'bg-secondary/10';
    border = 'border-secondary/30';
  }

  return (
    <div
      className={`${bg} border ${border} flex items-center justify-center transition-colors ${className}`}
      title={`${name}: ${slots.length} overlay(s)`}
    >
      <span className="text-[9px] font-jetbrains text-muted-foreground uppercase truncate px-1">
        {name.replace('-', ' ')}
      </span>
    </div>
  );
};
