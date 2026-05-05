# Overlay System

> STATUS: IMPLEMENTED. Source of truth: `src/main/overlay/overlay-bus.ts`,
> `src/main/overlay/overlay-server.ts`, `src/main/overlay/overlay-types.ts`,
> `src/overlay/` (the host SPA).

The overlay system lets extensions render small HTML widgets — a
top-bar race info strip, a center-screen flag alert, a lower-third
caption — over the operator's broadcast. OBS Studio consumes these
via a **Browser Source** pointed at the overlay server URL.

For type definitions (`OverlayRegion`, `OverlaySlot`,
`OverlayServerMessage`), see `data-models.md` § Overlay.

## Components

```
Extension                    Main process                          OBS Browser Source
┌─────────────┐             ┌────────────────────┐                ┌──────────────────┐
│ contributes │ register    │   OverlayBus       │   WebSocket    │ Overlay SPA      │
│  .overlays  │────────────▶│  (in-memory store) │◀──────────────▶│ (src/overlay/)   │
│             │             │                    │  (port 9100)   │                  │
│ api.update  │             │   OverlayServer    │ HTTP /overlay  │ shadcn templates │
│   Overlay() │────────────▶│  HTTP + WS         │◀───────────────│                  │
└─────────────┘             └────────────────────┘                └──────────────────┘
```

- **OverlayBus** is the in-process registry of `OverlaySlot` instances.
  Extensions write to it via the `api.updateOverlay`/`showOverlay`/
  `hideOverlay` shims (which round-trip via `INVOKE` to the main
  process). Static `contributes.overlays` are registered at
  extension-load time by `extensionHost.loadExtension`.
- **OverlayServer** is the public HTTP+WebSocket server on
  `http://localhost:9100`. It serves the SPA from `dist/src/overlay/`
  and broadcasts every bus mutation over WebSocket to all connected
  clients.
- **The overlay SPA** is a separate Vite entry point at
  `src/overlay/index.html`. It connects to `ws://localhost:9100/ws`,
  receives the initial state, and reactively re-renders.

## Port configuration

The default port is **9100**. To change it:

```ts
configService.setAny('overlay.port', 9200);
// restart the app
```

The constructor reads `configService.getAny('overlay.port') || 9100`
in `main.ts`. There is no UI for this today — the operator sets it
directly via `window.electronAPI.config.set('overlay.port', n)`
from a debug console.

### Port-conflict behaviour

If `EADDRINUSE` is raised, the server logs the error and
**resolves** the start promise without throwing. The app continues to
run; overlays will be inert (extensions can still call `api.updateOverlay`
but no one will be listening). Other errors are logged but also
swallowed. This is by design: overlay failure must not crash the app.

## HTTP routes

Served by `OverlayServer.handleRequest`:

| Route | Returns |
|---|---|
| `GET /` | 302 → `/overlay` |
| `GET /overlay`, `GET /overlay/*` | The overlay SPA (with SPA fallback to `index.html`). |
| `GET /assets/*` | Static assets bundled by Vite into `dist/assets/`. |
| `GET /api/overlays` | JSON array of all `OverlaySlot`s. |
| `GET /api/regions` | JSON `Record<OverlayRegion, string \| null>` of region owners. |
| `GET /ws` (HTTP upgrade) | WebSocket connection for live updates. |
| anything else | `404 Not Found`. |

Directory traversal is blocked — `serveFile` checks that the resolved
absolute path stays within `distRoot`.

CORS: `Access-Control-Allow-Origin: *` on the JSON endpoints. The
overlay SPA itself has no CORS constraints because it is served from
the same origin.

## WebSocket protocol

Server-to-client only. The full discriminated union (defined in
`overlay-types.ts`):

```ts
type OverlayServerMessage =
  | { type: 'connected';            overlays: OverlaySlot[] }
  | { type: 'overlay:registered';   overlay: OverlaySlot }
  | { type: 'overlay:update';       id: string; data: Record<string, unknown> }
  | { type: 'overlay:show';         id: string }
  | { type: 'overlay:hide';         id: string }
  | { type: 'overlay:unregistered'; id: string };
```

- `connected` is sent **once** on each new WebSocket connection,
  carrying the full current overlay set so the client can hydrate.
- `overlay:registered` / `overlay:unregistered` track lifecycle.
- `overlay:update` / `overlay:show` / `overlay:hide` track runtime
  mutations from the bus.

There is no client-to-server message in the protocol. The server also
sends a low-level WebSocket `ping` frame every **30 s** to detect
zombie connections; clients must respond with `pong` (most stacks do
this automatically).

## Region model and conflict resolution

Six fixed regions: `top-bar`, `lower-third`, `ticker`, `center-popup`,
`corner-top-left`, `corner-top-right`.

Multiple extensions may contribute overlays for the same region. The
bus picks **one owner per region** based on:

1. Operator override via `overlay.setRegionOwner(region, extensionId)`.
2. Otherwise, the highest-priority overlay registered for that region
   (default `priority: 0`).
3. Ties broken by registration order.

Region assignments are exposed via `GET /api/regions` and the preload
methods `overlay.getRegionAssignments()` / `overlay.setRegionOwner(...)`.

## Auto-hide

If `OverlayRegistration.autoHide` is set (ms), the bus will emit
`overlay:hide` `autoHide` ms after the **most recent** `overlay:show`
or `overlay:update` for that overlay. `autoHide: 0` (the default)
disables the timer — the overlay stays visible until explicitly hidden.

This is implemented in `overlay-bus.ts`; check there for the exact
debounce semantics if you need to reproduce them.

## Built-in templates

Extensions reference templates by string id. Built-in templates are
React components in `src/overlay/templates/` (e.g. `RaceInfoBar`,
`FlagAlert`). The SPA's template registry maps id → component.

Extensions may also reference an HTML file via a relative path; the
SPA loads it into an iframe. This is rare in practice — all current
overlays use built-in templates.

## How an extension uses overlays

In the manifest:

```json
"contributes": {
  "overlays": [
    { "id": "race-info", "region": "top-bar", "title": "Race Info Bar", "template": "RaceInfoBar" },
    { "id": "flag-alert", "region": "center-popup", "title": "Flag Change", "template": "FlagAlert", "autoHide": 5000 }
  ]
}
```

At runtime:

```ts
api.updateOverlay('race-info', { lap: 12, leaderLap: 15, flag: 'green' });
api.showOverlay('race-info');
// later…
api.hideOverlay('race-info');
```

`updateOverlay` does NOT auto-show — call `showOverlay` first (or
configure the SPA template to render whenever data is present).

## Extension API for overlays

All four methods are part of `ExtensionAPI` (see
`feature_extension_system.md`):

```ts
updateOverlay(overlayId: string, data: Record<string, unknown>): void;
showOverlay(overlayId: string): void;
hideOverlay(overlayId: string): void;
```

(There is no `registerOverlay` API — overlays are declared statically
in the manifest, not registered at runtime.)

Sequences can also drive the overlay via the built-in intents
`overlay.show` and `overlay.hide` (see `feature_sequence_executor.md`).

## OBS Browser Source setup

1. In OBS, add a **Browser** source.
2. URL: `http://localhost:9100/overlay` (or the value returned by
   `window.electronAPI.overlay.getUrl()`).
3. Width / height: match the canvas (typically 1920×1080).
4. Disable `Shutdown source when not visible` and `Refresh browser
   when scene becomes active` — the WebSocket re-syncs on connect, but
   the page does not need to reload on every scene change.

The source can be added once per scene that needs overlays, or once at
the top of the scene tree.
