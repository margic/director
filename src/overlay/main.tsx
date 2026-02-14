/**
 * Overlay SPA Entry Point
 *
 * Renders the overlay host into a transparent 1920×1080 canvas.
 * OBS Browser Source loads this page to display broadcast overlays.
 *
 * URL query params:
 * - ?regions=lower-third,top-bar  → only show specific regions
 * - ?ws=ws://host:port/ws         → custom WebSocket URL
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 2.4
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { OverlayHost } from './OverlayHost';
import './overlay.css';

const params = new URLSearchParams(window.location.search);

// Parse region filter
const regionsParam = params.get('regions');
const filterRegions = regionsParam
  ? regionsParam.split(',').map((r) => r.trim()).filter(Boolean)
  : undefined;

// WebSocket URL (default to same host)
const wsUrl = params.get('ws') ?? `ws://${window.location.hostname}:${window.location.port}/ws`;

const root = createRoot(document.getElementById('overlay-root')!);
root.render(
  <React.StrictMode>
    <OverlayHost filterRegions={filterRegions} wsUrl={wsUrl} />
  </React.StrictMode>
);
