# Director — Overview

> STATUS: IMPLEMENTED. Reflects code as of `src/main/main.ts`.

## What Director is

Director is an **Electron desktop application** that runs on a Sim
RaceCenter PC or simulator rig. It bridges:

- the local **iRacing simulator** (via shared-memory FFI),
- local **broadcast tooling** (OBS via OBS-WebSocket, Discord voice for
  TTS),
- the **Race Control cloud** (https://simracecenter.com), which provides
  AI-generated broadcast sequences and session orchestration.

It has two operating modes:

- **Director Loop** — the cloud is in charge: every few seconds the
  Director polls Race Control for the next broadcast sequence to
  execute, sending live telemetry as `RaceContext`. Sequences come
  back as `PortableSequence` JSON and are executed locally.
- **Control Deck** — the operator is in charge: sequences are
  triggered manually from the Sequence Library UI or imported from
  files.

Both modes use the **same execution pipeline** (`SequenceScheduler` →
`SequenceExecutor` → `ExtensionHost`).

## Two-tier product model

| Tier | What it is | Where it lives |
|---|---|---|
| **Open-source core** | Electron app, extension host, executor, OBS/iRacing/Discord/YouTube extensions, overlay server | This repo |
| **Premium cloud intelligence** | AI Planner + Executor models, sequence template generation, session orchestration, identity & roster | Race Control cloud (`margic/racecontrol`, separate repo) |

The core can run standalone in Control Deck mode. The Director Loop
requires a Race Control account and an active session.

## Key actors and where they live

```
┌────────────────────────────────── Renderer (React) ──────────────────────────────────┐
│  src/renderer/  — pages, components, contexts (PageHeader, Telemetry)                │
│  Talks to main only via window.electronAPI (see api-contextbridge.md).               │
└──────────────────────────────────────┬───────────────────────────────────────────────┘
                                       │  IPC (contextBridge → ipcRenderer.invoke)
┌──────────────────────────────────────▼─── Main process ──────────────────────────────┐
│  AuthService            – MSAL/Entra ID, token cache (safeStorage)                   │
│  ConfigService          – electron-store + safeStorage for secrets                   │
│  SessionManager         – session discovery, selection, check-in, wrap               │
│  DirectorOrchestrator   – mode FSM: stopped ↔ manual ↔ auto                          │
│  CloudPoller            – polls /sequences/next while in auto mode                   │
│  SequenceScheduler      – queue + history, $var() resolution, priority preemption    │
│  SequenceExecutor       – dispatches each step (built-ins or extension intent)       │
│  SequenceLibraryService – built-in / cloud / custom sequence storage                 │
│  ExtensionHostService   – owns the utility process, two-tier registry, event bus     │
│  OverlayBus + OverlayServer – HTTP+WS server (port 9100) for OBS Browser Source      │
│  ObsService, DiscordService, TelemetryService, RaceAnalyzer                          │
└──────────────────────────────────────┬───────────────────────────────────────────────┘
                                       │  utilityProcess + MessageChannelMain
┌──────────────────────────────────────▼─── Extension Host (utility process) ──────────┐
│  Loads built-in extensions from src/extensions/{iracing,obs,discord,youtube}         │
│  Each extension calls back to main via the `invoke` bridge for privileged ops.       │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## The Director Loop, in one paragraph

When the operator selects a session and transitions to **auto** mode,
`DirectorOrchestrator` starts a `CloudPoller`. The poller POSTs
`POST /api/director/v1/sessions/{id}/sequences/next` with the current
`RaceContext` (built from the latest `iracing.raceStateChanged` event)
and the active broadcast intents. Race Control replies with either
`200` + a `PortableSequence`, `204` (try again later), or `410` (the
session has ended). On `200`, the poller hands the sequence to
`SequenceScheduler`, which resolves `$var()` placeholders and walks the
steps via `SequenceExecutor`. `system.wait` and `system.log` execute
in-process; everything else is dispatched as an intent into the
extension host, where the appropriate extension (OBS, iRacing, Discord,
…) carries it out. Progress is mirrored to the renderer over the
`sequence:progress` IPC channel and to OBS Browser Source over the
overlay WebSocket.

## App startup sequence

The full sequence is in `src/main/main.ts:79..344`. In short:

1. `app.on('ready')` fires.
2. `telemetryService.initialize()` — Application Insights.
3. `AuthService` is constructed; `discordService` is given a reference.
4. `SessionManager`, `ObsService`, `IntentRegistry`,
   `CapabilityCatalog`, `ExtensionEventBus`, `ViewRegistry`,
   `OverlayBus` are instantiated.
5. `OverlayServer` starts on `configService.getAny('overlay.port') || 9100`.
6. `ExtensionHostService` is instantiated with the two-tier registry
   and the overlay bus.
7. `registerInvokeHandler('discordPlayTts', …)` is registered so the
   `director-discord` extension can delegate to the singleton
   `DiscordService`.
8. `SequenceExecutor`, `SequenceLibraryService`, `SequenceScheduler`
   are instantiated in that order (the executor needs the library; the
   scheduler needs the executor).
9. `DirectorOrchestrator` is instantiated.
10. `SessionManager` is wired with three callbacks:
    - `setCapabilitiesBuilder` — assembles `DirectorCapabilities` from
      the catalog + cached event payloads (scenes, camera groups,
      drivers) when a check-in is sent.
    - `setLocalSequencesGetter` — supplies the operator's local
      sequence library (max 50) for Planner training.
    - `setRaceContextGetter` — bridges to
      `directorOrchestrator.getRaceContext()` so check-in includes a
      live `raceContext` snapshot.
11. `EventMapper` is instantiated (binds extension events to
    sequences).
12. `extensionHost.start()` is invoked asynchronously. When it
    resolves, the sequence library is initialised, then OBS and
    Discord auto-connect (if their extension is enabled and
    `autoConnect` is set in config).
13. All `ipcMain.handle` channels are registered.
14. `createWindow()` opens the main `BrowserWindow` (preload =
    `dist-electron/main/preload.js`, contextIsolation on, nodeIntegration off).

On quit (`app.on('will-quit')`), the current session is auto-wrapped
(`sessionManager.wrapSession('app-quit')`), the overlay server is
stopped, and the extension host is stopped.

## Where to look next

- For the FSM and module composition: **`architecture-orchestrator.md`**.
- For the renderer ↔ main API surface: **`api-contextbridge.md`**.
- For the data shapes that flow over the wire: **`data-models.md`**.
- For how extensions plug in: **`feature_extension_system.md`**.
