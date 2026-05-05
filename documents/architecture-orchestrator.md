# Architecture — `DirectorOrchestrator` and the Main-Process Composition

> STATUS: IMPLEMENTED. Source of truth: `src/main/main.ts`,
> `src/main/director-orchestrator.ts`, `src/main/session-manager.ts`,
> `src/main/cloud-poller.ts`, `src/main/sequence-scheduler.ts`.

This document describes the main-process orchestration: the
`DirectorOrchestrator` class, its dependencies, the mode FSM, and the
exact wiring done at startup. It is the missing piece referenced —
but never named — in the older `overview.md`.

## Module dependency graph

```
                                   ┌─────────────────┐
                                   │   AuthService   │  (MSAL + safeStorage cache)
                                   └────────┬────────┘
                                            │
        ┌──────────────────┬────────────────┼────────────────┬──────────────────┐
        │                  │                │                │                  │
        ▼                  ▼                ▼                ▼                  ▼
┌───────────────┐  ┌───────────────┐ ┌───────────────┐ ┌──────────────┐ ┌─────────────┐
│ ConfigService │  │SessionManager │ │  CloudPoller  │ │ DiscordSvc   │ │  ObsService │
│ (electron-    │  │ (state ↔ RC   │ │ (long-poll    │ │ (TTS, voice) │ │ (legacy &   │
│  store +      │  │  /checkin)    │ │  /sequences/  │ │              │ │  extension) │
│  safeStorage) │  │               │ │   next)       │ │              │ │             │
└───────────────┘  └───────┬───────┘ └───────┬───────┘ └──────────────┘ └─────────────┘
                           │                 │
                           │ stateChanged    │ onSequence
                           ▼                 ▼
                    ┌──────────────────────────────────┐
                    │      DirectorOrchestrator        │
                    │  mode FSM: stopped ↔ manual ↔ auto│
                    └─────────────┬────────────────────┘
                                  │ enqueue
                                  ▼
                       ┌──────────────────────┐
                       │  SequenceScheduler   │  (queue, history, $var(), priority)
                       └──────────┬───────────┘
                                  │ executeStep
                                  ▼
                       ┌──────────────────────┐    ┌────────────────────────┐
                       │  SequenceExecutor    │───▶│ ExtensionHostService   │
                       │  (built-ins + intent │    │  (utility process,     │
                       │   dispatch)          │    │   two-tier registry)   │
                       └──────────────────────┘    └────────────────────────┘
                                                              │
                                                              ▼
                                                ┌──────────────────────────┐
                                                │  Built-in extensions:    │
                                                │  iracing / obs / discord │
                                                │  / youtube               │
                                                └──────────────────────────┘
```

`OverlayBus`, `OverlayServer`, `EventMapper`, `RaceAnalyzer`,
`SequenceLibraryService`, `TelemetryService` are also constructed at
startup but are leaves of the graph (no further dependents).

## The mode FSM

`DirectorMode = 'stopped' | 'manual' | 'auto'`. Defined in
`src/main/director-orchestrator.ts:34`.

```
                  selectSession                start (auto)
   ┌────────────┐──────────▶┌────────────┐──────────▶┌────────────┐
   │  stopped   │            │   manual   │            │    auto    │
   └────────────┘◀──────────└────────────┘◀──────────└────────────┘
        ▲          clearSession              stop                 │
        │              or 410 Gone                                │
        └────────────────────────────────────────────────────────┘
                          410 Gone (session ended)
```

### Transition rules (enforced in `setMode`)

| From → To | Guard | Side-effect |
|---|---|---|
| `stopped → manual` | A `selectedSession` exists in `SessionManager`. | None (executor stays idle, ready for manual `sequences.execute`). |
| `stopped → auto`   | A `selectedSession` exists **and** `SessionManager.getCheckinId()` is non-null. | Construct `CloudPoller` and call `start()`. |
| `manual → auto`    | `getCheckinId()` non-null. | Same as above. |
| `auto → manual`    | None. | `cloudPoller.stop()`, drop reference. |
| `auto → stopped`   | None. | `cloudPoller.stop()`, then clear `currentRaceSessionId`. |
| `manual → stopped` | None. | None. |
| Any 410 from RC    | Triggered by `CloudPoller.onSessionEnded`. | `sessionManager.wrapSession('session-ended')`, `clearSession()`, `setMode('stopped')`. |

### Session-driven transitions

`DirectorOrchestrator` subscribes to
`sessionManager.on('stateChanged', …)` (constructor, line ~119). On
`selected` or `checked-in`:

- If the orchestrator is currently `stopped`, it auto-transitions to
  `manual` or `auto` based on `configService.get('director')
  .autoStartOnSessionSelect`.
- If `checked-in`, it calls
  `extensionHost.executeInternalDirective('iracing.publisher.bindSession',
  { raceSessionId })` to tag publisher events with the confirmed
  session ID.
- If already in a non-stopped mode and an active `CloudPoller` exists,
  it propagates the new `checkinId` and TTL via
  `cloudPoller.updateCheckin(...)`.

On `discovered` or `none` (cleared), the orchestrator drops to
`stopped` and resets `RaceAnalyzer`.

## `RaceContext` assembly

`buildRaceContext()` (lines 173..273) is called from two places:

1. `cloudPoller.getRaceContext` — sent in the body of every
   `POST /sequences/next`.
2. `sessionManager.getRaceContext` (via the wired callback) — included
   in the body of `POST /sessions/{id}/checkin` so the Planner can
   weight templates against the current race phase.

It transforms the latest `iracing.raceStateChanged` payload into the
`RaceContext` shape (see `data-models.md`). Key transformations:

- iRacing `SessionFlags` bitmask → `'green' | 'caution' | 'red' | 'disconnected'`
  (`FLAG_RED=0x0010`, `FLAG_YELLOW=0x0008`, `FLAG_CAUTION=0x4000`).
- `sessionLapsRemain > 32000` → `-1` (iRacing's sentinel for unlimited).
- Top 20 cars only (size cap to keep the payload small).
- Active battles: pairs of consecutive cars within `gapToCarAhead < 1.0s`.
- `recentEvents` and `stintLaps` come from `RaceAnalyzer` (synthesised
  locally — never round-trips to the cloud).

If `lastIRacingState` is `null`, a minimal disconnected context is
returned (`sessionType: 'Race'`, `sessionFlags: 'disconnected'`,
`lapsRemain: -1`, `carCount: 0`).

## `CloudPoller` lifecycle and state machine

Owned by `DirectorOrchestrator`; constructed only in `auto` mode.

```
            start()
   IDLE ──────────────▶ POLLING
     ▲                     │
     │                     ├── 200 + sequence ──▶ onSequence(seq) ──▶ scheduler.enqueue ──▶ POLLING
     │                     ├── 204 No Content   ──▶ wait idleRetryMs ──▶ POLLING
     │                     ├── 5xx / network    ──▶ ERROR (backoff) ──▶ POLLING
     │                     └── 410 Gone         ──▶ onSessionEnded() ──▶ STOPPED
     │
   STOPPED ◀── stop()
```

- `idleRetryMs` defaults to 5000 ms but is overridden by the server's
  `sessionConfig.timingConfig.idleRetryIntervalMs` returned from
  check-in.
- The `Retry-After` response header overrides the next interval when
  present.
- The poller honours the check-in TTL: it polls at least every
  `checkinTtlSeconds / 4` seconds to keep the heartbeat alive.
- When a sequence is enqueued, the poller is informed via
  `cloudPoller.onSequenceStarted(id, estimatedDurationMs)` so it can
  pre-fetch the next sequence and avoid dead air.
- When the scheduler emits `historyChanged` for that sequence id, the
  orchestrator calls `cloudPoller.onSequenceCompleted(id)` to release
  any pending pre-fetched response.

## Capability-change re-check-in

`DirectorOrchestrator.listenForConnectionEvents()` subscribes to:

- `obs.connectionStateChanged`
- `iracing.connectionStateChanged`
- `youtube.status`
- `extension.capabilitiesChanged` (synthetic event emitted by the
  ExtensionHost when scenes/cameras/drivers change or when an
  extension is enabled/disabled)

If the orchestrator is currently checked in (`checkinStatus === 'standby'`),
each event triggers `sessionManager.refreshCheckin()` which re-POSTs the
check-in body so Race Control sees the updated capability set.

## Active-intents filter

`DirectorOrchestrator.getActiveIntents()` returns the list of intent
ids sent in the `intents` query parameter of
`POST /sequences/next`. It is built from the `CapabilityCatalog`:

- Always includes the built-ins `system.wait` and `system.log`.
- Includes only intents whose owning extension is currently `enabled`.
- Filters out intents whose `category` is `operational` or `query`
  (issue #112). Only `broadcast` intents are valid as planner output.

The same filter is applied to `DirectorCapabilities.intents` when the
check-in body is built in `main.ts:setCapabilitiesBuilder`.

## Internal directives vs. broadcast intents

There are two ways to invoke a handler in an extension:

| Mechanism | Visibility | Use |
|---|---|---|
| `extensionHost.executeIntent(intent, data)` | Public — appears in `CapabilityCatalog`, executable from sequences. | Broadcast actions (e.g. `obs.switchScene`). |
| `extensionHost.executeInternalDirective(directive, data)` | Private — bypasses the catalog check. | Lifecycle plumbing (e.g. `iracing.publisher.bindSession`, `iracing.publisher.initiateDriverSwap`). |

An internal directive must still be registered by the extension via
`api.registerIntentHandler(...)`; it just isn't exposed as a capability
to the cloud planner.

## Manual sequence execution

`DirectorOrchestrator.executeSequenceById(id)` is the legacy path used
by some renderer surfaces. It fetches the sequence from
`GET /api/director/v1/sequences/{id}`, normalises it via
`normalizeApiResponse`, and enqueues it with `source: 'manual'`. The
preferred path is `window.electronAPI.sequences.execute(id, vars)`
which goes through `SequenceLibraryService.getSequence` and the same
scheduler.

## Renderer notifications

The orchestrator emits `stateChanged` events with
`DirectorOrchestratorState`. `main.ts` does **not** wire this directly
to a renderer push channel; instead, the renderer polls
`directorState()` and subscribes to `session.onStateChanged` (which
covers most state transitions because the orchestrator's interesting
fields — `mode` aside — derive from the session manager). If you need
real-time mode updates, add a `mainWindow.webContents.send('director:stateChanged',
…)` channel and surface it on the preload — none exists today.

## Lifecycle: shutdown

`app.on('will-quit')` (main.ts:829):

1. `sessionManager.wrapSession('app-quit')` — best-effort release of
   the active check-in.
2. `overlayServer.stop()` — close HTTP + WebSocket listeners.
3. `extensionHost.stop()` — terminate the utility process and call
   `deactivate()` on each loaded extension.

The `DirectorOrchestrator` and `CloudPoller` do not need explicit
teardown beyond `setMode('stopped')` (which `wrapSession` triggers via
`SessionManager`).
