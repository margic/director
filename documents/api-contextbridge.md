# `window.electronAPI` — ContextBridge Surface

> STATUS: IMPLEMENTED. Source of truth: `src/main/preload.ts`.
>
> The renderer talks to the main process **only** through this object.
> `nodeIntegration` is off and `contextIsolation` is on, so this is the
> entire attack/integration surface visible to React code.

The preload file uses `contextBridge.exposeInMainWorld('electronAPI', …)`.
Every method invokes a corresponding `ipcMain.handle(...)` registered in
`src/main/main.ts`. Channels that push data to the renderer use
`mainWindow.webContents.send(channel, payload)` and are exposed as
`onXxx(callback)` methods that return an unsubscribe function.

## TypeScript shape

```ts
interface ElectronAPI {
  config: ConfigAPI;
  login(): Promise<AuthLoginResult | null>;
  getAccount(): Promise<MsalAccount | null>;
  getUserProfile(): Promise<UserProfile | null>;
  logout(): Promise<boolean>;

  // --- Director (FSM) ---
  directorSetMode(mode: 'stopped' | 'manual' | 'auto'): Promise<DirectorOrchestratorState>;
  directorState(): Promise<DirectorOrchestratorState>;
  /** @deprecated use directorSetMode('auto') */ directorStart(): Promise<DirectorOrchestratorState>;
  /** @deprecated use directorSetMode('stopped') */ directorStop(): Promise<DirectorOrchestratorState>;
  /** @deprecated use directorState() */ directorStatus(): Promise<DirectorOrchestratorState>;
  /** @deprecated use session.discover() */ directorListSessions(centerId?: string): Promise<RaceSession[]>;
  /** @deprecated use session.select() */ directorSetSession(raceSessionId: string): Promise<DirectorOrchestratorState>;
  directorCheckinSession(raceSessionId: string, options?: { forceCheckin?: boolean }): Promise<DirectorOrchestratorState>;
  directorWrapSession(reason?: string): Promise<DirectorOrchestratorState>;

  // --- Session ---
  session: SessionAPI;

  // --- OBS (legacy direct controls — extension is preferred) ---
  obsGetStatus(): Promise<ObsStatus>;
  obsGetScenes(): Promise<string[]>;
  obsSetScene(sceneName: string): Promise<void>;
  obsConnect(): Promise<void>;
  obsDisconnect(): Promise<void>;
  obsGetConfig(): Promise<{ host?: string; password?: string; autoConnect?: boolean }>;
  obsSaveSettings(s: { host: string; password?: string; autoConnect: boolean }): Promise<true>;

  // --- Discord (singleton service) ---
  discordGetStatus(): Promise<DiscordStatus>;
  discordConnect(token: string, channelId: string): Promise<void>;
  discordDisconnect(): Promise<void>;
  discordSendTest(text: string): Promise<void>;
  discordUpdateVoicePreference(voice: string): Promise<unknown>;

  // --- Publisher helpers (used by the iRacing renderer pages) ---
  publisher: {
    lookupConfig(publisherCode: string): Promise<PublisherConfigResponse>;
    listDrivers(): Promise<DriverDirectoryEntry[]>;
  };

  // --- Telemetry (Application Insights pass-through) ---
  telemetry: TelemetryAPI;

  // --- Extensions ---
  extensions: ExtensionsAPI;

  // --- Sequence library + execution ---
  sequences: SequencesAPI;

  // --- Capability catalog (intent + event listings) ---
  catalog: { intents(): Promise<IntentCatalogEntry[]>; events(): Promise<EventCatalogEntry[]> };

  // --- Overlay server / region assignment ---
  overlay: {
    getUrl(): Promise<string>;
    getOverlays(): Promise<OverlaySlot[]>;
    getRegionAssignments(): Promise<Record<OverlayRegion, string | null>>;
    setRegionOwner(region: OverlayRegion, extensionId: string): Promise<true>;
  };
}
```

## Namespaces in detail

### `config`

Persistent settings and secrets via `electron-store` + `safeStorage`.

| Method | Main handler | Description |
|---|---|---|
| `config.get(key)` | `config:get` | Returns `AppConfig[key]` (`youtube`, `obs`, `iracing`, `discord`, `director`). |
| `config.set(key, value)` | `config:set` | Persists value. Side-effects: `obs.enabled` toggles the `director-obs` extension; `iracing.enabled` is a no-op (extensions own the flag). |
| `config.saveSecure(key, value)` | `config:save-secure` | Encrypts via `safeStorage` if available; falls back to `plain:` prefix on Linux dev. |
| `config.isSecureSet(key)` | `config:is-secure-set` | True if a value exists at `secure.{key}`. |

The full `AppConfig` schema is in `src/main/config-service.ts:5..30`.

### Auth (top-level)

| Method | Main handler | Notes |
|---|---|---|
| `login()` | `auth:login` | Opens MSAL interactive flow against the main window. Tracks `Auth.LoginAttempt` + `Auth.LoginSuccess` telemetry. |
| `getAccount()` | `auth:get-account` | Returns the cached MSAL `AccountInfo` or `null`. Used at startup to render either the dashboard or the login screen. |
| `getUserProfile()` | `auth:get-user-profile` | GETs `/api/auth/user` with a silently-acquired token. Returns `UserProfile`. |
| `logout()` | `auth:logout` | Clears the MSAL cache. |

### Director (mode FSM, top-level)

The director namespace is intentionally flat (no `director.*` object) for
historical reasons. The non-deprecated members are:

| Method | Description |
|---|---|
| `directorSetMode(mode)` | Drives `DirectorOrchestrator.setMode`. Returns the new state (see `data-models.md`). |
| `directorState()` | Returns current `DirectorOrchestratorState`. |
| `directorCheckinSession(id, opts?)` | Delegates to `SessionManager.checkinSession`. `forceCheckin: true` adds the `X-Force-Checkin` header. |
| `directorWrapSession(reason?)` | Stops auto mode (if running) and wraps the active check-in. |

The five `@deprecated` methods are kept for backward compatibility but
just delegate to the corresponding `session.*` or `directorSetMode`
calls; new renderer code MUST NOT use them.

### `session`

```ts
interface SessionAPI {
  getState(): Promise<SessionManagerState>;
  discover(centerId?: string): Promise<SessionManagerState>;
  select(raceSessionId: string): Promise<SessionManagerState>;
  clear(): Promise<SessionManagerState>;
  checkin(options?: { forceCheckin?: boolean }): Promise<SessionManagerState>;
  wrap(reason?: string): Promise<SessionManagerState>;
  /** Subscribe to push updates from `session:stateChanged`. Returns unsubscribe. */
  onStateChanged(cb: (state: SessionManagerState) => void): () => void;
}
```

`SessionManagerState` is documented in `data-models.md`.

### `extensions`

```ts
interface ExtensionsAPI {
  getStatus(): Promise<Record<string, { active: boolean; version?: string }>>;
  setEnabled(id: string, enabled: boolean): Promise<true>;
  getViews(type?: 'panel' | 'dashboard' | 'sidebar' | 'widget' | 'dialog' | 'overlay'):
    Promise<ViewContribution[]>;
  /** Fire an intent into the host. Used by Stream Deck-style UI affordances. */
  executeIntent(intent: string, data: any): Promise<void>;
  /** Returns the most recent payload seen for an event name (or null). */
  getLastEvent(eventName: string): Promise<{ extensionId: string; eventName: string; payload: any } | null>;
  /** Subscribe to ALL extension events (incl. internal). Returns unsubscribe. */
  onExtensionEvent(cb: (data: { extensionId: string; eventName: string; payload: any }) => void): () => void;
}
```

`setEnabled` has lifecycle side-effects: enabling/disabling
`director-obs` connects/stops `ObsService`; enabling/disabling
`director-discord` connects/disconnects `DiscordService` (using the
`secure.discord.token` and `discord.channelId` config).

### `sequences`

```ts
interface SequencesAPI {
  list(filter?: { category?: 'builtin' | 'cloud' | 'custom'; search?: string }): Promise<PortableSequence[]>;
  get(id: string): Promise<PortableSequence | null>;
  save(seq: PortableSequence): Promise<PortableSequence>;
  delete(id: string): Promise<void>;
  export(id: string): Promise<string>;          // JSON string
  import(json: string): Promise<PortableSequence>;
  /** Enqueue for execution. Returns the executionId (uuid). */
  execute(id: string, variables?: Record<string, unknown>,
          options?: { source?: ExecutionSource; priority?: boolean }): Promise<string>;
  cancel(): Promise<void>;                       // cancel the currently running execution
  cancelQueued(executionId: string): Promise<void>;
  queue(): Promise<QueuedSequence[]>;
  history(): Promise<ExecutionResult[]>;         // ring buffer, default size 25
  /** Returns the live PortableSequence even if not in the library (cloud/agent). */
  getExecuting(sequenceId: string): Promise<PortableSequence | null>;
  /** Per-step progress events. Returns unsubscribe. */
  onProgress(cb: (p: SequenceProgress) => void): () => void;
  /** Library mutated server-side (e.g. cloud templates landed). Returns unsubscribe. */
  onLibraryUpdated(cb: () => void): () => void;
}
```

The `ExecutionSource` enum is `'manual' | 'director-loop' | 'ai-agent'
| 'stream-deck' | 'webhook' | 'event-mapper'`.

### `catalog`

| Method | Description |
|---|---|
| `catalog.intents()` | List of `IntentCatalogEntry` from `SequenceLibraryService.getRegisteredIntents()` (used by the Sequence Editor to render the intent picker). |
| `catalog.events()` | List of `EventCatalogEntry` for the Event Mapper UI. |

### `overlay`

| Method | Description |
|---|---|
| `overlay.getUrl()` | Returns `http://localhost:9100/{overlay.html}` (use as OBS Browser Source). |
| `overlay.getOverlays()` | All registered `OverlaySlot` instances. |
| `overlay.getRegionAssignments()` | Map from `OverlayRegion` → owning `extensionId` (or `null`). |
| `overlay.setRegionOwner(region, extId)` | Operator override of the default highest-priority owner. |

### Push channels (raw)

Only the four documented above are surfaced. For completeness, the
underlying IPC channels are:

| Channel | Carried by | Payload |
|---|---|---|
| `session:stateChanged` | `session.onStateChanged` | `SessionManagerState` |
| `extension:event` | `extensions.onExtensionEvent` | `{ extensionId, eventName, payload }` |
| `sequence:progress` | `sequences.onProgress` | `SequenceProgress` |
| `sequence:library-updated` | `sequences.onLibraryUpdated` | `void` |

There are **no other** `webContents.send` channels in the main process.
If you find one, the preload is out of date.

## Adding a new IPC method

1. Define the type in `data-models.md` (or extend an existing one).
2. Add an `ipcMain.handle` in `src/main/main.ts`.
3. Add the corresponding wrapper in `src/main/preload.ts`.
4. Add the type to the renderer's ambient declaration in
   `src/renderer/types.d.ts`.
5. Update this document with the new entry.

The preload **must remain pure forwarding** — no business logic, no
caching, no transformation. The renderer must remain unable to call
`ipcRenderer` directly (do not expose it).
