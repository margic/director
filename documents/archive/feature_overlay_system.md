# Broadcast Overlay System — Feature Specification

## Overview
The Broadcast Overlay System provides real-time broadcast graphics for OBS Studio integration. It serves a transparent-background SPA via a local HTTP + WebSocket server on port 9100. Extensions contribute overlay templates (lower-thirds, tickers, race info bars, etc.) through their `package.json` manifests, and the runtime manages visibility, region ownership, and live data updates.

The overlay system runs as a core Director subsystem — always available regardless of which extensions are active.

## Architecture

### 1. Server (Main Process)
- **HTTP Server** on `localhost:9100` serves the overlay SPA at `/overlay` and static assets at `/assets/*`.
- **WebSocket** at `/ws` pushes real-time overlay state changes to connected browser sources.
- All overlay mutations flow through the **OverlayBus** which validates regions, resolves priority conflicts, and broadcasts deltas.

### 2. Overlay Host SPA (Renderer)
- A standalone React application (`src/overlay/`) with fixed 1920×1080 transparent canvas.
- Regions are positioned via CSS grid: `top-bar`, `lower-third`, `ticker`, `center-popup`, `corner-top-left`, `corner-top-right`.
- WebSocket hook (`useOverlaySocket`) maintains connection and processes `OverlayServerMessage` events.
- Built-in templates: `RaceInfoBar`, `ActivityProgress`, `StatusBadge`, `FlagAlert`, `ChatTicker`, `Standings`.

### 3. Extension Contribution
Extensions declare overlays in `package.json`:
```json
{
  "contributes": {
    "overlays": [{
      "id": "race-info",
      "region": "top-bar",
      "title": "Race Info Bar",
      "template": "RaceInfoBar",
      "autoHide": 0,
      "priority": 100
    }]
  }
}
```

At runtime, extensions update overlay data via the extension API:
```typescript
api.overlay.update('race-info', { trackName: 'Spa', lapCount: '12/44' });
api.overlay.show('race-info');
api.overlay.hide('race-info');
```

## Data Types

### OverlayRegion
Six named screen regions:
- `top-bar` — Full-width bar at top of frame
- `lower-third` — Name/info bar in lower third
- `ticker` — Scrolling ticker at bottom
- `center-popup` — Modal/alert in center
- `corner-top-left` / `corner-top-right` — Small badges in corners

### OverlaySlot
Runtime state for each overlay instance:
```typescript
interface OverlaySlot {
  id: string;              // Unique overlay ID
  extensionId: string;     // Owning extension
  region: OverlayRegion;   // Screen region
  title: string;           // Admin display name
  template: string;        // Template component ID
  visible: boolean;        // Current visibility
  data?: Record<string, unknown>;  // Template data payload
  autoHide?: number;       // Auto-hide timeout (ms)
  priority?: number;       // Region conflict resolution
}
```

### WebSocket Protocol
Server → Client messages:
- `connected` — Initial state dump with all overlay slots
- `overlay:registered` — New overlay added
- `overlay:update` — Data payload change
- `overlay:show` / `overlay:hide` — Visibility toggle
- `overlay:unregistered` — Overlay removed

## UI: Overlay Management Panel

### Design Principles
- **Consistent with Sequence Executor** — Same page structure, header hook, card patterns.
- **Control Room aesthetic** — Dark surfaces, data-bright accents, uppercase labels.
- **Operational clarity** — Server status, URL, region map, and overlay list at a glance.

### Information Architecture

```
┌─────────────────────────────────────────────────────┐
│  BROADCAST OVERLAY (page header via useSetPageHeader)│
├────────────────────────┬────────────────────────────┤
│  LEFT COLUMN           │  RIGHT COLUMN              │
│                        │                            │
│  ┌──────────────────┐  │  ┌────────────────────────┐│
│  │ Server Status     │  │  │ OBS Browser Source     ││
│  │ ● RUNNING :9100   │  │  │ Setup Instructions     ││
│  │ [URL] [Copy][Open]│  │  │                        ││
│  └──────────────────┘  │  │ 1. Add Browser source   ││
│                        │  │ 2. Paste URL             ││
│  ┌──────────────────┐  │  │ 3. 1920 × 1080          ││
│  │ Registered        │  │  │ 4. Shutdown when hidden ││
│  │ Overlays (N)      │  │  └────────────────────────┘│
│  │                   │  │                            │
│  │ [overlay row]     │  │  ┌────────────────────────┐│
│  │ [overlay row]     │  │  │ Region Map (visual)    ││
│  │ [overlay row]     │  │  │                        ││
│  └──────────────────┘  │  │  ┌──────────────────┐   ││
│                        │  │  │ top-bar          │   ││
│                        │  │  │                  │   ││
│                        │  │  │  ┌──┐      ┌──┐  │   ││
│                        │  │  │  │TL│      │TR│  │   ││
│                        │  │  │  └──┘      └──┘  │   ││
│                        │  │  │   center-popup    │   ││
│                        │  │  │ lower-third       │   ││
│                        │  │  │ ticker            │   ││
│                        │  │  └──────────────────┘   ││
│                        │  └────────────────────────┘│
└────────────────────────┴────────────────────────────┘
```

### Dashboard Widget
A compact h-64 card on the main Dashboard showing:
- **Header:** Layers icon + "BROADCAST OVERLAY" + status dot
- **Body:** Server status + overlay count
- **Footer:** "Open Overlay" action button (secondary color)

### Sidebar Navigation
- **Icon:** `Layers` (from lucide-react)
- **Position:** Between Sequences and extension nav items
- **View ID:** `overlay`

## Scope

### Phase 1 (Current)
- [x] Overlay server (HTTP + WebSocket) on port 9100
- [x] Overlay Host SPA with region positioning
- [x] Built-in templates (6 templates)
- [x] Extension manifest contribution scanning
- [x] IPC bridge for renderer (getUrl, getOverlays, getRegionAssignments, setRegionOwner)
- [ ] Dedicated Overlay Management page (this feature)
- [ ] Dashboard widget card
- [ ] Sidebar navigation entry

### Phase 2 (Future)
- [ ] Drag-and-drop region assignment
- [ ] Live preview embed in management page
- [ ] Custom template upload
- [ ] Overlay scheduling (show/hide on timer)
- [ ] Multi-client sync status
