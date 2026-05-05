# OBS Integration

> STATUS: IMPLEMENTED. Source of truth: `src/extensions/obs/index.ts`,
> `src/main/modules/obs-core/obs-service.ts`, `src/main/main.ts`.

OBS Studio is reached through OBS-WebSocket v5 (`obs-websocket-js`).
Director uses **two** consumers of the same connection model:

1. **The `director-obs` extension** — exposes the broadcast intents
   (`obs.switchScene`, `obs.getScenes`) used by sequences. Activated
   by the extension host like any other extension.
2. **The legacy `ObsService` singleton** — predates the extension
   system and is still used by some renderer pages
   (`obsConnect`, `obsGetStatus`, `obsSetScene` on the preload).
   Both can be live simultaneously and each maintains its own
   `OBSWebSocket` connection.

This dual model is intentional for backward compatibility; new code
should use the extension and reach OBS via `obs.switchScene`.

## Extension manifest

`name: "director-obs"`. Contributes:

| Kind | Items |
|---|---|
| **Intents** | `obs.switchScene { sceneName, transition?, duration? }` (broadcast), `obs.getScenes` (operational) |
| **Events** | `obs.connectionStateChanged { connected }`, `obs.scenes { scenes, connected, currentScene? }` |
| **Settings** | `obs.host`, `obs.password` (secure), `obs.autoConnect` |

The extension does NOT contribute overlays, views, or commands.

## Extension state machine and reconnect

Implemented in `src/extensions/obs/index.ts:90..104`:

```
                       ┌────────────┐
       activate ──────▶│ DISCONNECTED│
                       └─────┬──────┘
                             │ host configured? → connect()
                             ▼
                       ┌────────────┐    success     ┌────────────┐
                       │ CONNECTING │───────────────▶│ CONNECTED  │
                       └─────┬──────┘                └─────┬──────┘
                             │ failure                     │ ConnectionClosed
                             ▼                             ▼
                       ┌──────────────────────────────────────────┐
                       │ RECONNECTING (setInterval every 5000 ms) │
                       └──────────────────────────────────────────┘
                                      │ on success → CONNECTED (interval cleared)
```

The interval is **fixed at 5 s** with no jitter or backoff. It clears
itself when `connected === true`. There is no maximum retry count; the
extension reconnects forever until disabled.

## Singleton `ObsService` reconnect

`src/main/modules/obs-core/obs-service.ts:104..126` implements the
**same** 5-second polling reconnect, with one extra guard: a
`stopping: boolean` flag set by `disconnect()`. When `stopping` is
true, the reconnect loop is suppressed — this is what makes "Disable
extension" reliably stop the service rather than instantly reconnect.

`stop()` (called when the operator disables OBS in the UI):

1. Sets `stopping = true`.
2. Clears `reconnectInterval` if running.
3. Disconnects the WebSocket.

Toggling re-enable later requires an explicit `connect()` call, which
clears `stopping` again.

## Auto-connect at startup

In `src/main/main.ts`, after `extensionHost.start()` resolves:

```ts
const obsConfig = configService.get('obs');
if (obsConfig?.autoConnect && obsConfig.host) {
  obsService.connect(obsConfig.host, obsConfig.password);
}
```

The `director-obs` extension is also activated (if `obs.enabled !==
false`) and will connect itself if `obs.host` is set, regardless of
`autoConnect`. The two are independent.

## Capability propagation

When the OBS-WebSocket emits `Identified`, the extension fetches the
scene list via `GetSceneList` and emits:

```ts
director.emitEvent('obs.scenes', {
  scenes: string[],          // array of scene names
  connected: true,
  currentScene: string,
});
```

The `ExtensionHostService` listens for `obs.scenes` and caches the
scene list in `cachedObsScenes`. When this changes, the host emits a
synthetic `extension.capabilitiesChanged` event so the orchestrator
can re-check-in with the updated `DirectorCapabilities.scenes`.

## IPC handlers (legacy preload surface)

`window.electronAPI.obs*` (see `api-contextbridge.md`):

| Method | Main handler | Backed by |
|---|---|---|
| `obsGetStatus()` | `obs:status` | `obsService.getStatus()` |
| `obsGetScenes()` | `obs:get-scenes` | `obsService.getScenes()` |
| `obsSetScene(name)` | `obs:set-scene` | `obsService.setScene(name)` |
| `obsConnect()` | `obs:connect` | `obsService.connect(host, password)` |
| `obsDisconnect()` | `obs:disconnect` | `obsService.stop()` |
| `obsGetConfig()` | `obs:get-config` | reads `obs.host`, `obs.password` (secure), `obs.autoConnect` |
| `obsSaveSettings(s)` | `obs:save-settings` | persists, then triggers `connect()` if `autoConnect` |

These bypass the extension entirely and talk to the singleton.

## Why two parallel connections?

- The **extension** path is what AI-generated sequences use. It must
  go through the extension host because the sequence executor only
  knows how to dispatch intents.
- The **singleton** path is what the OBS Settings page uses to test
  credentials, list scenes, and so on, without forcing a full
  extension load/unload cycle.

The extension and singleton **can both be connected at once** to the
same OBS instance — OBS-WebSocket allows multiple authenticated
clients.

## Removing the singleton (future)

The long-term direction is to remove `ObsService` and route all OBS
calls through the extension. The migration path is:

1. Add `obs.connect`, `obs.disconnect`, `obs.getStatus`,
   `obs.getConfig` as `category: 'operational'` intents on the
   extension.
2. Update the renderer to call them via `extensions.executeIntent`
   plus `extensions.getLastEvent` for the status snapshot.
3. Delete `obs-service.ts` and the `obs:*` preload methods.

This is not currently planned for any release.
