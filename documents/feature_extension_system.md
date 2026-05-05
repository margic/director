# Extension System

> STATUS: IMPLEMENTED. Source of truth: `src/main/extension-host/`,
> `src/extensions/*/`.

This document is the regeneration spec for the extension host: how
extensions are discovered, loaded, isolated, and given a privileged
API. It supersedes all previous documents that referred to a
"`Command`" or "`EXECUTE_COMMAND`" mechanism — those have been removed
in favour of intents.

## What an extension is

A first-party folder under `src/extensions/{id}/` containing:

```
src/extensions/foo/
├── package.json     # ExtensionManifest (see data-models.md)
├── index.ts         # exports `activate(api)` and optionally `deactivate()`
└── renderer/        # optional React contributions (loaded by the renderer)
```

At build time, `scripts/copy-extension-assets.js` copies the compiled
JS and the `package.json` into `dist-electron/extensions/{id}/`.

There is currently **no third-party extension support** (no install
flow, no signing, no marketplace). All extensions live in this repo.

## Process model

```
Main process (privileged)
└── ExtensionHostService            ← src/main/extension-host/extension-host.ts
    └── utilityProcess              ← single child process for ALL extensions
        └── extension-process.js    ← the host runtime; loads each extension
            ├── activate(api)       ← extension foo
            ├── activate(api)       ← extension bar
            └── …
```

- One **utility process** is spawned per app launch
  (`utilityProcess.fork(extension-process.js, { stdio: 'pipe' })`).
- All extensions share that process — they are **not** isolated from
  each other.
- IPC between main and the utility process uses a `MessageChannelMain`
  with the typed messages defined in
  `src/main/extension-host/extension-types.ts`.

## Extension lifecycle

1. **Scan.** `ExtensionScanner.scan()` walks `dist-electron/extensions/`
   and reads each `package.json`.
2. **Catalog (Phase 1).** Every scanned extension is registered in
   the `CapabilityCatalog` regardless of enabled state. This is the
   **static tier**.
3. **Load (Phase 2).** For each extension whose config has not been
   explicitly disabled (`config.{extensionId}.enabled !== false`):
   - Its `IntentContribution`s are added to the `IntentRegistry`
     (the **dynamic tier**).
   - Its `ViewContribution`s are added to the `ViewRegistry`.
   - Its `OverlayContribution`s are registered with the `OverlayBus`.
   - Settings (declared in `contributes.settings`) are hydrated:
     keys whose name contains `token`, `password`, or `secret` are
     read from `configService.getSecure(key)`; all others from
     `configService.getAny(key)`.
   - A `LOAD_EXTENSION` message is sent to the utility process with
     `{ extensionId, entryPoint, settings }`.
   - The utility process `require()`s the entry point and calls
     `module.activate(api)` with a fresh `ExtensionApiImpl`.
4. **Enable / disable at runtime.**
   `extensionHost.setExtensionEnabled(id, enabled)`:
   - Persists the new value in `configService`.
   - Toggles the `enabled` flag in the `CapabilityCatalog`.
   - Loads or unloads the extension (sends `LOAD_EXTENSION` /
     `UNLOAD_EXTENSION`).
   - Emits `extension.capabilitiesChanged` so the orchestrator can
     re-check-in.
5. **Unload.** `UNLOAD_EXTENSION` causes the utility process to call
   `module.deactivate()` (if exported) and remove the extension's
   intent/scraper handlers. The main process unregisters intents,
   views, and overlays.
6. **Shutdown.** `app.on('will-quit')` calls
   `extensionHost.stop()`, which terminates the utility process.

## The two-tier registry

The system maintains **two parallel data structures** for intents.
This is critical and was the source of much past confusion.

### `CapabilityCatalog` — static, all-installed

`src/main/extension-host/capability-catalog.ts`.

- Populated at scan time from **every** installed extension,
  regardless of enabled state.
- Used to:
  - Render the Sequence Editor intent picker (so the user can build
    sequences referencing intents from disabled extensions).
  - Build the `DirectorCapabilities.intents` payload sent to Race
    Control at check-in.
  - Hold per-extension `aiContext` prose for the Planner prompt.
- Carries an `enabled: boolean` flag per entry that mirrors the
  extension's load state.
- **Never** dispatches anything.

### `IntentRegistry` — dynamic, currently-loaded

`src/main/extension-host/intent-registry.ts`.

- Populated only when an extension is **loaded** (active).
- Used by `SequenceExecutor` to decide whether an intent has an active
  handler. Missing handlers cause the step to be **skipped** with a
  warning (soft failure).
- Cleared on `unloadExtension`.

A regenerating agent **must** model these as two separate classes.
Merging them would break the Sequence Editor (which needs disabled
intents) or break soft-failure (which needs to know what is currently
live).

## The `ExtensionAPI` interface

The single object passed to `activate(api)` in the utility process.
Defined in `src/main/extension-host/extension-types.ts` and implemented
in `src/main/extension-host/extension-process.ts`.

```ts
interface ExtensionAPI {
  /** Hydrated from manifest contributes.settings, with secure keys auto-resolved. */
  settings: Record<string, any>;

  // ----- Intents -----
  /** Register a handler for a manifest-declared intent. */
  registerIntentHandler(intent: string, handler: (payload: any) => Promise<void>): void;

  /** Emit an event onto the bus. Cached for `extensions.getLastEvent`. */
  emitEvent(event: string, payload: any): void;

  // ----- Auth & main-process delegation -----
  /** Fetch a Race Control bearer token; null if not signed in. */
  getAuthToken(): Promise<string | null>;

  /** Generic call into a main-process invoke handler.
   *  Used by extensions that need access to singletons (e.g. DiscordService). */
  invoke(method: string, ...args: any[]): Promise<any>;

  // ----- Logging & settings -----
  log(level: 'info' | 'warn' | 'error', message: string): void;
  /** Persist via configService.set; secure keys (token/password/secret) routed through safeStorage. */
  updateSetting(key: string, value: any): Promise<void>;

  // ----- Scraper (hidden BrowserWindow with preload-scraper.js) -----
  openScraper(url: string, script?: string): Promise<string>;   // returns windowId
  closeScraper(windowId: string): void;
  registerScraperMessageHandler(handler: (payload: any) => void): void;

  // ----- System -----
  openExternal(url: string): Promise<void>;

  // ----- Overlay (per overlay declared in contributes.overlays) -----
  updateOverlay(overlayId: string, data: Record<string, unknown>): void;
  showOverlay(overlayId: string): void;
  hideOverlay(overlayId: string): void;
}
```

### Notes on individual methods

- **`registerIntentHandler`** — also sends a `REGISTER_INTENT` IPC
  message back to the host. The host treats this as informational; the
  catalog already knows the intent from the manifest.
- **`invoke`** — round-trips an `INVOKE` message to the main process,
  which dispatches to a handler registered via
  `extensionHost.registerInvokeHandler(method, fn)`. Today the only
  registered method is `discordPlayTts` (used by `director-discord` to
  delegate to the singleton `DiscordService`). The handlers in
  `ExtensionApiImpl` for `getAuthToken`, `openScraper`, `closeScraper`,
  `openExternal`, `updateSetting`, `updateOverlay`, `showOverlay`,
  `hideOverlay` all use this same `invoke` plumbing under the hood.
- **`emitEvent`** — fan-outs to:
  1. `ExtensionEventBus` (in main) — used by `EventMapper`,
     `ExtensionHostService.listenForConnectionEvents`, and the
     `extension:event` renderer push channel.
  2. The cache used by `extensions.getLastEvent`.
- **`log`** — writes to the main-process `console` prefixed
  `[Ext:{id}] [LEVEL]`. There is no dedicated log file.

## IPC protocol (utility process ↔ main)

All messages match `IpcMessage = { type: IpcMessageType; payload: any }`.
Defined in `src/main/extension-host/extension-types.ts:127..201`.

### Main → child

| Type | Payload | When sent |
|---|---|---|
| `LOAD_EXTENSION` | `{ extensionId, entryPoint, settings }` | When an extension is enabled. |
| `UNLOAD_EXTENSION` | `{ extensionId }` | When an extension is disabled. |
| `EXECUTE_INTENT` | `{ requestId, intent, data }` | When the executor or `extensionHost.executeInternalDirective` runs an intent. |
| `INVOKE_RESULT` | `{ id, result?, error? }` | Reply to an `INVOKE` from the child. |
| `SCRAPER_MESSAGE` | `{ extensionId, data }` | When a hidden scraper window posts via `youtube-scraper:message`. |

### Child → main

| Type | Payload | When sent |
|---|---|---|
| `EMIT_EVENT` | `{ extensionId, event, data }` | `api.emitEvent(...)`. |
| `LOG` | `{ level, message, extensionId? }` | `api.log(...)` and internal errors. |
| `REGISTER_INTENT` | `{ intent }` | `api.registerIntentHandler(...)` (informational). |
| `INVOKE` | `{ id, method, args, extensionId }` | `api.invoke(...)` and the per-method shims (`getAuthToken`, scrapers, overlays, …). |

The `EXECUTE_COMMAND` / `REGISTER_COMMAND` / `COMMAND_RESULT` types
exist in the `IpcMessageType` union for backward compatibility but
are no longer sent or handled. The `CommandContribution` manifest
field is similarly inert.

## Internal directives (lifecycle plumbing)

`extensionHost.executeInternalDirective(directive, data)` sends an
`EXECUTE_INTENT` message **without** consulting the
`CapabilityCatalog`. The target extension must still register a handler
via `api.registerIntentHandler(directive, …)`.

Used today only by:

| Directive | Caller | Purpose |
|---|---|---|
| `iracing.publisher.bindSession` | `DirectorOrchestrator` after check-in | Tag publisher events with the cloud-assigned `raceSessionId`. |
| `iracing.publisher.initiateDriverSwap` | `SessionManager` (driver-swap flow) | Stop publishing as the outgoing driver and re-handshake as the incoming one. |

These intents intentionally never appear in `DirectorCapabilities.intents`
and so cannot be selected by the Planner.

## Self-managed state

Each extension is responsible for:

- Calling `api.registerIntentHandler` for every intent it declared in
  its manifest. Missing registrations are not validated; the intent
  will simply be skipped at runtime.
- Storing connection / auth state in module-level variables (each
  extension gets a fresh `require()` evaluation per `LOAD_EXTENSION`).
- Reading credentials from `api.settings[...]` (auto-hydrated, with
  secure-key resolution).
- Calling `api.updateSetting(key, value)` to persist mutated settings
  (e.g. an OAuth refresh token).
- Emitting `*.connectionStateChanged` events when its underlying
  connection toggles, so the orchestrator's connection-health map
  stays accurate.

The host does **not** restart extensions on settings changes. If a
setting requires a reconnect, the extension itself must observe the
change (typically via its own UI panel triggering a `disconnect`/
`connect` intent or via `api.invoke('settingsChanged', …)`).

## Adding a new extension

1. Create `src/extensions/{id}/` with `package.json` and `index.ts`.
2. Declare intents (and optionally events, settings, views, overlays)
   in the manifest.
3. Export `activate(api)` (and `deactivate()` if you hold resources).
4. Call `api.registerIntentHandler(intent, handler)` for each declared
   intent.
5. Add the extension's renderer (if any) to `src/renderer/extensions/{id}/`
   and reference its component name in `contributes.views`.
6. The build step (`scripts/copy-extension-assets.js`) will pick it up
   automatically; restart the dev server.

If your extension needs to call a privileged main-process service:

1. Add a method to `src/main/extension-host/extension-host.ts`'s
   `customInvokeHandlers` map by calling
   `extensionHost.registerInvokeHandler('myMethod', async (args) => …)`
   in `main.ts`.
2. Call it from the extension as
   `await api.invoke('myMethod', arg1, arg2)`.

Do not bypass `invoke` and reach for `electron` APIs directly — the
utility process does not have access to them.
