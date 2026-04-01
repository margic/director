# Director Loop v2 — Implementation Plan

**Date:** 2026-02-22
**Status:** Ready for implementation
**Prerequisite:** [Director Loop v2 RFC](feature_director_loop_v2.md) agreed; [RC formal response](rc-response-to-director-proposal.md) accepted.

---

## 0. Scope & Goals

Decompose the monolithic `DirectorService` into a clean three-layer architecture:

```
CloudPoller → SequenceScheduler → SequenceExecutor → Extensions
     ↑                                    ↑
SessionManager                    ExtensionHostService
     ↑
DirectorOrchestrator (mode controller)
```

**End state:**
- Director-loop sequences flow through the same Scheduler that manual/UI sequences use.
- Session discovery is a first-class service with its own state and IPC.
- The Director has stopped/manual/auto operating modes with typed config.
- All legacy normalization code is deleted once RC ships the PortableSequence-native API.
- Priority sequences use cancel-and-replace (not parallel execution).

**Non-goals for this plan:**
- Visual Sequence Editor improvements (separate feature).
- Replay intent support (deferred by both teams).
- Cloud library write endpoints (Phase 5, depends on RC).

---

## Phase 1 — Extract CloudPoller & Route Through Scheduler

> **Dependency:** None (Director-only). Can start immediately.
> **Branch:** `feature/director-loop-v2-phase1`

### Problem

`DirectorService.loop()` creates its own `SequenceExecutor` instance, bypassing the `SequenceScheduler` entirely. This means:
- Director-loop sequences don't appear in the execution queue or history.
- No progress events fire for director-loop sequences (the overlay never shows them).
- Manual sequences can't queue behind or interrupt director-loop sequences.
- Two executor instances exist at runtime.

### 1.1 Create `src/main/cloud-poller.ts`

Extract the sequence request loop and API fetch logic from `DirectorService` into a focused, single-responsibility class.

**Responsibilities:**
- Request sequences from `GET /api/director/v1/sessions/{id}/sequences/next` on a timer.
- Normalize API responses to `PortableSequence` (delegates to shared normalizer).
- Emit received sequences to a callback (the Orchestrator wires this to the Scheduler).
- Respect `Retry-After` header when present (fall back to default 5s).
- Handle `204 No Content` (no sequence) and `410 Gone` (session ended).
- Report active intents via the `intents` query parameter.
- Track API telemetry (dependency calls, errors).

**Interface:**

```typescript
interface CloudPollerOptions {
  idleRetryMs: number;   // Default: 5000 (retry interval when RC returns 204)
}

interface CloudPollerCallbacks {
  onSequence: (sequence: PortableSequence) => void;
  onSessionEnded: () => void;
  onError: (error: Error) => void;
}

class CloudPoller {
  constructor(
    authService: AuthService,
    callbacks: CloudPollerCallbacks,
    options?: Partial<CloudPollerOptions>
  );

  start(raceSessionId: string, activeIntents?: string[]): void;
  stop(): void;
  isRunning(): boolean;
  updateIntents(intents: string[]): void;
}
```

**Code to extract from `DirectorService`:**
- `fetchAndExecuteNextSequence()` → becomes `CloudPoller.fetchNextSequence()` (returns `PortableSequence | null` instead of executing)
- `IDLE_RETRY_MS` → constructor option
- `loop()` timer logic → `CloudPoller.poll()` private method
- API telemetry tracking → stays in CloudPoller

**New behavior:**
- On `200 OK`: parse response, normalize to `PortableSequence`, call `callbacks.onSequence(seq)`. Schedule next sequence request immediately (execution consumes the time).
- On `204 No Content`: read `Retry-After` header (seconds → ms). Schedule next sequence request after `Retry-After` value or `idleRetryMs`.
- On `410 Gone`: call `callbacks.onSessionEnded()`. Stop requesting sequences.
- On network error or 5xx: call `callbacks.onError(err)`. Schedule retry with exponential backoff (5s → 10s → 20s → 60s max).

### 1.2 Create `src/main/normalizer.ts`

Consolidate all three normalization implementations into one canonical location.

**What exists today (the problem):**
1. `DirectorService.normalizeApiResponse()` — private method, handles `commandType`, `target`, `LEGACY_INTENT_MAP` (lines 253-322 of director-service.ts).
2. `normalizeApiSequence()` — exported from `director-types.ts`, handles typed `DirectorCommand` union (lines 374-395).
3. `normalizeNextSequenceResponse()` — exported from `director-types.ts`, wraps `normalizeApiSequence` for `GetNextSequenceResponse` shape (lines 401-410).

**Action:**
- Create `src/main/normalizer.ts` with a single exported function: `normalizeApiResponse(raw: unknown): PortableSequence`.
- This function handles both the legacy `{ commands: DirectorCommand[] }` format AND the new `PortableSequence` format (passthrough if `steps` array is present).
- Import and use in `CloudPoller`.
- Delete `DirectorService.normalizeApiResponse()` (private method).
- Delete `normalizeApiSequence()` and `normalizeNextSequenceResponse()` from `director-types.ts`.
- Update `SequenceExecutor.executeLegacy()` to import from `normalizer.ts` (or delete if unused).

**Detection logic for format:**
```typescript
function normalizeApiResponse(raw: unknown): PortableSequence {
  const data = raw as any;
  
  // New format: already has `steps` array
  if (Array.isArray(data.steps)) {
    return data as PortableSequence;
  }
  
  // Legacy format: has `commands` array
  if (Array.isArray(data.commands)) {
    return normalizeLegacy(data);
  }
  
  throw new Error('Unrecognized API response format');
}
```

### 1.3 Wire CloudPoller → Scheduler in `main.ts`

**Current wiring (to be replaced):**
```
directorService = new DirectorService(authService, extensionHost)
  └── creates its own SequenceExecutor
  └── calls this.executor.execute() directly
```

**New wiring:**
```
cloudPoller = new CloudPoller(authService, {
  onSequence: (seq) => sequenceScheduler.enqueue(seq, {}, {
    source: 'director-loop',
    priority: seq.priority,
  }),
  onSessionEnded: () => { /* orchestrator.handleSessionEnded() — Phase 3 */ },
  onError: (err) => { console.error('[CloudPoller]', err); },
}, { idleRetryMs: 5000 });
```

**Changes to `main.ts`:**
- Import `CloudPoller`.
- Create `cloudPoller` instance after `sequenceScheduler`.
- Keep `directorService` temporarily for `listSessions()` and `getStatus()` (Phase 2 extracts these).
- Update `director:start` handler to call `cloudPoller.start(sessionId, activeIntents)`.
- Update `director:stop` handler to call `cloudPoller.stop()`.
- `director:status` handler returns a combined state (CloudPoller running + Scheduler executing + session).

### 1.4 Update `SequenceScheduler.executePriority()` — Cancel-and-Replace

**Current behavior (broken):** Priority sequences fire-and-forget in parallel.

```typescript
private async executePriority(...): Promise<void> {
  // Fire and don't block the queue
  this.executeSequence(executionId, sequence, variables, source, true);
}
```

**New behavior:** Cancel current execution, then run the priority sequence as the new current.

```typescript
private async executePriority(
  executionId: string,
  sequence: PortableSequence,
  variables: Record<string, unknown>,
  source: string
): Promise<void> {
  // Cancel-and-replace: stop the current sequence first
  if (this.currentExecution) {
    this.currentExecution.cancel();
    this.currentExecution = null;
  }

  // Clear the queue — priority means "everything before this is obsolete"
  this.queue = [];
  this.emit('queueChanged', this.queue);

  // Execute as the new current
  await this.executeSequence(executionId, sequence, variables, source, true);
}
```

### 1.5 Collect Active Intents from ExtensionHost

The `intents` query parameter tells RC which handlers are live. CloudPoller needs this list.

**Add helper to `ExtensionHostService` (or use existing `CapabilityCatalog`):**

```typescript
// Already has: capabilityCatalog.getIntents(): IntentCatalogEntry[]
// Filter to active only:
const activeIntents = capabilityCatalog
  .getIntents()
  .filter(e => e.active)
  .map(e => e.intentId);
// Always include built-ins:
activeIntents.push('system.wait', 'system.log');
```

CloudPoller appends `?intents=broadcast.showLiveCam,obs.switchScene,...` to the poll URL.

### 1.6 Files Changed

| File | Action |
|:---|:---|
| `src/main/cloud-poller.ts` | **Create** |
| `src/main/normalizer.ts` | **Create** |
| `src/main/director-service.ts` | **Modify** — Remove `loop()`, `fetchAndExecuteNextSequence()`, `normalizeApiResponse()`, `LEGACY_INTENT_MAP`, `executor` field. Keep `listSessions()`, `start()` (temporarily), `getStatus()`. |
| `src/main/director-types.ts` | **Modify** — Remove `normalizeApiSequence()`, `normalizeNextSequenceResponse()`, `normalizeCommand()`, module-level `LEGACY_INTENT_MAP`. Keep all type definitions. |
| `src/main/sequence-scheduler.ts` | **Modify** — Rewrite `executePriority()` for cancel-and-replace semantics. |
| `src/main/sequence-executor.ts` | **Modify** — Remove or update `executeLegacy()` to use new normalizer import. |
| `src/main/main.ts` | **Modify** — Create CloudPoller, wire to Scheduler, update director IPC handlers. |

### 1.7 Acceptance Criteria

- [ ] `director:start` → CloudPoller requests sequences from RC API → sequences appear in Scheduler queue/history.
- [ ] `sequence:progress` events fire for director-loop sequences (overlay + SequencesPanel show them).
- [ ] `sequence:history` shows director-loop entries with `source: 'director-loop'`.
- [ ] Priority sequences cancel the current execution and clear the queue.
- [ ] `Retry-After` header is respected on 204 responses.
- [ ] `410 Gone` stops the sequence request loop.
- [ ] `intents` query parameter is sent on every sequence request.
- [ ] No duplicate `SequenceExecutor` instances exist at runtime.
- [ ] Manual `sequence:execute` from SequencesPanel still queues correctly behind director-loop sequences.

---

## Phase 2 — Extract SessionManager

> **Dependency:** Phase 1 complete.
> **Branch:** `feature/director-loop-v2-phase2`

### Problem

Session discovery lives inside `DirectorService.listSessions()` and is also polled separately by the Dashboard component (every 5s with exponential backoff). There is no shared session state — the Dashboard and DirectorService fetch independently.

### 2.1 Create `src/main/session-manager.ts`

**Responsibilities:**
- Discover sessions via `GET /api/director/v1/sessions?centerId=X&status=ACTIVE`.
- Maintain session state: `'none' | 'searching' | 'discovered' | 'selected'`.
- Emit state transitions for the UI.
- Provide the selected `raceSessionId` to the CloudPoller.
- Handle `410 Gone` from CloudPoller (transition to `'none'`, trigger re-discovery).

**Interface:**

```typescript
type SessionState = 'none' | 'searching' | 'discovered' | 'selected';

interface SessionManagerState {
  state: SessionState;
  sessions: RaceSession[];
  selectedSession: RaceSession | null;
  lastError?: string;
}

class SessionManager extends EventEmitter {
  constructor(authService: AuthService);

  getState(): SessionManagerState;
  discover(): Promise<void>;
  selectSession(raceSessionId: string): void;
  clearSession(): void;
  
  // Events: 'stateChanged' → SessionManagerState
}
```

### 2.2 Migrate `listSessions()` from DirectorService

- Move all session fetch logic (including centerId resolution from user profile) into `SessionManager.discover()`.
- Move telemetry tracking for session discovery.
- Dashboard uses `session:state` IPC instead of polling `director:list-sessions` directly.

### 2.3 New IPC Channels

| Channel | Handler | Returns |
|:---|:---|:---|
| `session:state` | `sessionManager.getState()` | `SessionManagerState` |
| `session:discover` | `sessionManager.discover()` | `void` (state change fires event) |
| `session:select` | `sessionManager.selectSession(id)` | `void` |
| `session:clear` | `sessionManager.clearSession()` | `void` |

**Push events to renderer:**
```typescript
sessionManager.on('stateChanged', (state) => {
  mainWindow.webContents.send('session:stateChanged', state);
});
```

### 2.4 Update Dashboard Component

- Replace `directorListSessions()` polling with `session:state` IPC + `session:stateChanged` listener.
- Add session selection UI (dropdown or card list) instead of auto-selecting `sessions[0]`.
- Show session state badge: Searching → Discovered (N sessions) → Selected (session name).

### 2.5 Update Preload

Add to `window.electronAPI`:
```typescript
sessions: {
  getState: () => ipcRenderer.invoke('session:state'),
  discover: () => ipcRenderer.invoke('session:discover'),
  select: (id: string) => ipcRenderer.invoke('session:select'),
  clear: () => ipcRenderer.invoke('session:clear'),
  onStateChanged: (cb: (state: any) => void) => {
    ipcRenderer.on('session:stateChanged', (_, state) => cb(state));
    return () => ipcRenderer.removeAllListeners('session:stateChanged');
  },
}
```

### 2.6 Files Changed

| File | Action |
|:---|:---|
| `src/main/session-manager.ts` | **Create** |
| `src/main/director-service.ts` | **Modify** — Remove `listSessions()`. This file is now nearly empty. |
| `src/main/main.ts` | **Modify** — Create SessionManager, register IPC handlers, forward state events. |
| `src/main/preload.ts` | **Modify** — Add `sessions` namespace. |
| `src/renderer/pages/Dashboard.tsx` | **Modify** — Use session IPC instead of director IPC for sessions. Add session selector. |

### 2.7 Acceptance Criteria

- [ ] Dashboard shows live session state via push events (no more polling sessions separately).
- [ ] Session selection is explicit (user picks from discovered sessions, not `sessions[0]`).
- [ ] CloudPoller receives `raceSessionId` from SessionManager.
- [ ] `410 Gone` from CloudPoller triggers SessionManager to clear and re-discover.
- [ ] `director:list-sessions` IPC channel is deprecated/removed.

---

## Phase 3 — DirectorOrchestrator Shell

> **Dependency:** Phase 2 complete.
> **Branch:** `feature/director-loop-v2-phase3`

### Problem

There is no coordination between SessionManager, CloudPoller, and the Scheduler. The user can only start/stop. There is no concept of manual mode (session selected but not auto-requesting) vs auto mode (sequence request loop active).

### 3.1 Create `src/main/director-orchestrator.ts`

The Orchestrator is a thin state machine that wires the three subsystems together.

**Mode model:**

```
     ┌──────────┐    select session    ┌──────────┐    start auto    ┌──────────┐
     │  STOPPED  │ ──────────────────→  │  MANUAL   │ ─────────────→  │   AUTO    │
     └──────────┘                       └──────────┘                  └──────────┘
           ↑          clear session          │ ↑      stop auto           │
           └─────────────────────────────────┘ └──────────────────────────┘
                                                        410 Gone
                                                         ↓
                                                    ┌──────────┐
                                                    │  STOPPED  │
                                                    └──────────┘
```

**Interface:**

```typescript
type DirectorMode = 'stopped' | 'manual' | 'auto';

interface DirectorOrchestratorState {
  mode: DirectorMode;
  session: SessionManagerState;
  poller: { isRunning: boolean; lastPollAt?: string; nextPollAt?: string };
  scheduler: { isExecuting: boolean; queueLength: number };
}

class DirectorOrchestrator extends EventEmitter {
  constructor(
    sessionManager: SessionManager,
    cloudPoller: CloudPoller,
    scheduler: SequenceScheduler,
    capabilityCatalog: CapabilityCatalog
  );

  getState(): DirectorOrchestratorState;
  setMode(mode: DirectorMode): void;
  
  // Events: 'stateChanged' → DirectorOrchestratorState
}
```

**Internal wiring:**
- `setMode('manual')` → requires `sessionManager.state === 'selected'`. Enables manual sequence execution against the selected session.
- `setMode('auto')` → starts `cloudPoller.start(sessionId, activeIntents)`. Sequences route through Scheduler.
- `setMode('stopped')` → stops CloudPoller. Clears session.
- `onSessionEnded` (from CloudPoller 410) → automatically transitions to `stopped`.
- Extension status changes → re-collect active intents, update CloudPoller via `updateIntents()`.

### 3.2 Delete `DirectorService`

At this point, all `DirectorService` responsibilities have been extracted:
- Polling → `CloudPoller`
- Session discovery → `SessionManager`
- State management → `DirectorOrchestrator`
- Execution → `SequenceScheduler` + `SequenceExecutor`
- `executeSequenceById()` → becomes an Orchestrator method or moves to Scheduler (fetch from library, enqueue)

**Delete `src/main/director-service.ts`.**

### 3.3 Add Typed Director Config

**Add to `config-service.ts` schema:**

```typescript
director: {
  type: 'object',
  properties: {
    defaultMode: { type: 'string', enum: ['stopped', 'manual', 'auto'], default: 'stopped' },
    idleRetryMs: { type: 'number', default: 5000 },
    autoStartOnSessionSelect: { type: 'boolean', default: false },
  },
  default: {}
}
```

### 3.4 Replace Director IPC Channels

| Old Channel | New Channel | Handler |
|:---|:---|:---|
| `director:start` | `director:set-mode` | `orchestrator.setMode(mode)` |
| `director:stop` | *(same as above with `'stopped'`)* | — |
| `director:status` | `director:state` | `orchestrator.getState()` |
| `director:list-sessions` | **(Removed)** — use `session:*` | — |

**Push event:** `director:stateChanged` → `DirectorOrchestratorState`

### 3.5 Update Dashboard Component

- Replace start/stop toggle with mode selector: Stopped / Manual / Auto.
- Show combined state: session info + poller status + scheduler activity.
- Mode selector is disabled when no session is selected.

### 3.6 Update EventMapper

`EventMapper` currently depends on `DirectorService.executeSequenceById()`.

**Change:** Wire `EventMapper` to use `sequenceScheduler.enqueue()` instead:

```typescript
// Old:
this.directorService.executeSequenceById(sequenceId);

// New:
const sequence = await sequenceLibrary.getSequence(sequenceId);
if (sequence) {
  sequenceScheduler.enqueue(sequence, eventPayload, { source: 'webhook' });
}
```

### 3.7 Files Changed

| File | Action |
|:---|:---|
| `src/main/director-orchestrator.ts` | **Create** |
| `src/main/director-service.ts` | **Delete** |
| `src/main/config-service.ts` | **Modify** — Add `director` config schema. |
| `src/main/event-mapper.ts` | **Modify** — Depend on SequenceScheduler + SequenceLibraryService instead of DirectorService. |
| `src/main/main.ts` | **Modify** — Create Orchestrator, replace DirectorService references, update IPC. |
| `src/main/preload.ts` | **Modify** — Update director namespace (setMode, getState, onStateChanged). |
| `src/renderer/pages/Dashboard.tsx` | **Modify** — Mode selector, combined state display. |

### 3.8 Acceptance Criteria

- [ ] Mode transitions work: stopped ↔ manual ↔ auto.
- [ ] Auto mode starts CloudPoller; stopped mode stops it.
- [ ] Manual mode allows UI-triggered sequence execution against the selected session without auto-requesting.
- [ ] `DirectorService` is deleted — no references remain.
- [ ] `director:set-mode` IPC works from renderer.
- [ ] `director:stateChanged` push events update the Dashboard in real time.
- [ ] EventMapper uses Scheduler instead of DirectorService.
- [ ] Director config persists across restarts.

---

## Phase 4 — API Contract (Joint — Requires RC Spec Update)

> **Dependency:** Phase 3 complete + RC ships updated `openapi.yaml`.
> **Blocking on:** RC commits per their Phase 4 deliverables.
> **Branch:** `feature/director-loop-v2-phase4`

### Problem

Once RC ships `PortableSequence` as the sole wire format, all normalization code in the Director becomes dead weight. Additionally, new API features (`intents` param, `Retry-After`, `410 Gone`) need final integration.

### 4.1 Delete All Legacy Normalization

| File | What to Delete |
|:---|:---|
| `src/main/normalizer.ts` | Delete the `normalizeLegacy()` path. Keep only the passthrough for `PortableSequence`. The normalizer becomes a simple validator/type-guard. |
| `src/main/director-types.ts` | Delete: `CommandType`, `DirectorStatus` (replace with `DirectorMode`), `DirectorState` (replaced by `DirectorOrchestratorState`), all legacy command interfaces (`WaitCommand`, `LogCommand`, `SwitchCameraCommand`, etc.), `DirectorCommand` union, `DirectorSequence`, `GetNextSequenceResponse`, `SequencePriority` enum, module-level `LEGACY_INTENT_MAP`, `normalizeCommand()`. |
| `src/main/sequence-executor.ts` | Delete `executeLegacy()` method and its `DirectorSequence`/`normalizeApiSequence` imports. |

### 4.2 Register Built-In Intents

`system.executeSequence` — when the executor encounters this intent, it fetches the referenced sequence from the library and enqueues it in the Scheduler.

**Add to `SequenceExecutor.executeStep()`:**

```typescript
if (intent === 'system.executeSequence') {
  const { sequenceId, variables } = payload as any;
  const sequence = await this.sequenceLibrary.getSequence(sequenceId);
  if (!sequence) {
    console.warn(`[Executor] system.executeSequence: sequence '${sequenceId}' not found`);
    return;
  }
  // Execute inline (not enqueue — we're already in an execution context)
  await this.execute(sequence);
  return;
}
```

`overlay.show` / `overlay.hide` — dispatch to `OverlayBus`:

```typescript
if (intent === 'overlay.show') {
  const { overlayId, data } = payload as any;
  overlayBus.showOverlay('sequences', overlayId, data);
  return;
}
if (intent === 'overlay.hide') {
  const { overlayId } = payload as any;
  overlayBus.hideOverlay('sequences', overlayId);
  return;
}
```

**SequenceExecutor dependency change:** Constructor takes `OverlayBus` and `SequenceLibraryService` in addition to `ExtensionHostService`.

### 4.3 Update `openapi.yaml` Locally

Once RC ships their updated spec, pull it into the repo:
```bash
curl -o openapi.yaml https://simracecenter.com/api/openapi.yaml
```

Verify:
- `DirectorSequence`, `DirectorCommand`, `DirectorCommandType` schemas are gone.
- `GET .../sequences/next` returns `PortableSequence` only.
- `intents` query parameter exists.
- 204 and 410 response codes documented.

### 4.4 Files Changed

| File | Action |
|:---|:---|
| `src/main/normalizer.ts` | **Modify** — Remove legacy path, become a validator. |
| `src/main/director-types.ts` | **Modify** — Mass deletion of legacy types (est. ~180 lines removed). |
| `src/main/sequence-executor.ts` | **Modify** — Delete `executeLegacy()`, add `system.executeSequence` + `overlay.*` handlers, update constructor. |
| `src/main/main.ts` | **Modify** — Update SequenceExecutor construction (pass OverlayBus, SequenceLibraryService). |
| `openapi.yaml` | **Replace** — Pull updated spec from RC. |

### 4.5 Acceptance Criteria

- [ ] Director works end-to-end with RC's new native `PortableSequence` responses.
- [ ] No legacy type imports remain anywhere in `src/main/`.
- [ ] `system.executeSequence` steps work (fetch from library + inline execute).
- [ ] `overlay.show` / `overlay.hide` steps work (display on overlay).
- [ ] `openapi.yaml` in repo matches RC's production spec.

---

## Phase 5 — Cloud Sequence Library

> **Dependency:** Phase 4 complete + RC ships library write endpoints.
> **Branch:** `feature/director-loop-v2-phase5`

### 5.1 Implement Cloud Tier in SequenceLibraryService

`SequenceLibraryService` currently has an empty cloud tier. Implement:

```typescript
private async loadCloud(): Promise<void> {
  const token = await this.authService.getAccessToken();
  const url = `${apiConfig.baseUrl}/api/director/v1/sequences`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (response.ok) {
    this.cloudCache = await response.json();
    this.cloudCache.forEach(s => s.category = 'cloud');
  }
}
```

Add cloud sequences to `listSequences()` return. Cache with TTL (5 minutes).

### 5.2 `system.executeSequence` Fetch from Cloud

When the executor encounters `system.executeSequence` and the sequence isn't in local library, fetch from:
```
GET /api/director/v1/sequences/{sequenceId}
```

### 5.3 Files Changed

| File | Action |
|:---|:---|
| `src/main/sequence-library-service.ts` | **Modify** — Implement `loadCloud()`, add `AuthService` dependency, TTL cache. |
| `src/main/main.ts` | **Modify** — Pass `AuthService` to `SequenceLibraryService`. |

### 5.4 Acceptance Criteria

- [ ] Cloud sequences appear in the library list.
- [ ] `system.executeSequence` can fetch cloud-hosted sequences.
- [ ] Cloud tier degrades gracefully when offline (serves cached, logs warning).

---

## Phase 6 — Overlay Intents & Cleanup

> **Dependency:** Phases 4-5 complete.
> **Branch:** `feature/director-loop-v2-phase6`

### 6.1 Report Overlay Capabilities

Once `overlay.show` and `overlay.hide` are built-in handlers, the CloudPoller includes them in the `intents` parameter. RC will then start emitting overlay steps in auto-director sequences.

### 6.2 Command Buffer Support (If Needed)

If RC's updated command buffer is used by external tools (stream deck, web dashboard), ensure the Director handles sequences that contain interlaced pending commands correctly. No Director changes expected — these arrive as normal `PortableSequence` steps.

### 6.3 Final Cleanup

- Remove `SequenceExecutor.executeLegacy()` if not already done.
- Remove any remaining `DirectorService` references in comments/docs.
- Update `documents/feature_director_loop.md` to point to v2 as canonical.
- Archive or delete `documents/feature_director_loop_v2.md` negotiation sections.

---

## Dependency Graph

```
Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5
   (Director-only)          │         (Joint)      (Joint)
                            │            │
                            └────────────┼──→ Phase 6
                                         │     (Joint)
                                         │
                              RC: openapi.yaml update
                              RC: generator rewrite
                              RC: command buffer migration
```

**Critical path:** Phases 1-3 are Director-only and can proceed immediately. Phase 4 is the joint integration point and is blocked on RC shipping their spec update.

---

## Risk Register

| Risk | Impact | Mitigation |
|:---|:---|:---|
| RC spec update delayed | Phase 4 blocked | Normalizer in Phase 1 handles both formats. Director works with legacy API indefinitely. |
| Cancel-and-replace causes sequence loss | User-visible — manual sequence cancelled by auto | Log cancelled sequences in history with `status: 'cancelled'`. Show toast notification. Allow "manual mode" to disable auto-requesting. |
| `intents` parameter missing handlers | RC emits intents Director can't handle | Soft failure — SequenceExecutor skips unknown intents. But `intents` param prevents this. |
| Dashboard polling removed too early | UI breaks during Phase 2 | Keep deprecated IPC channels with console.warn until Phase 3 is merged. |
| `Retry-After` header not present | Sequence requests fall back to default | Already handled — CloudPoller defaults to 5s if header absent. |

---

## Testing Strategy

No test framework is currently configured. Each phase should include:

1. **Manual integration test** — Start the app, connect to RC dev API, verify sequences flow through Scheduler.
2. **Console verification** — Check `[CloudPoller]`, `[SequenceScheduler]`, `[SequenceExecutor]` log prefixes in DevTools.
3. **UI verification** — SequencesPanel shows director-loop history entries; overlay displays progress.
4. **Script test** — Update `scripts/test-director-loop.ts` for each phase to verify the new classes directly.

**Recommended future work:** Add Vitest with mocked Electron APIs for unit-testing CloudPoller, SessionManager, and Orchestrator state transitions.

---

## Estimated Effort

| Phase | Effort | Calendar (1 dev) |
|:---|:---|:---|
| Phase 1 — CloudPoller + Scheduler | Medium | 2-3 days |
| Phase 2 — SessionManager | Small | 1-2 days |
| Phase 3 — Orchestrator + Delete DirectorService | Medium | 2-3 days |
| Phase 4 — API Contract + Legacy Deletion | Small-Medium | 1-2 days (after RC ships) |
| Phase 5 — Cloud Library | Small | 1 day |
| Phase 6 — Cleanup | Small | 0.5 day |
| **Total** | | **~8-11 days** |

Phase 4 start date depends on RC's delivery of the updated `openapi.yaml`.

---

## Summary

| Phase | Creates | Deletes | Modifies |
|:---|:---|:---|:---|
| 1 | `cloud-poller.ts`, `normalizer.ts` | — | `director-service.ts`, `director-types.ts`, `sequence-scheduler.ts`, `sequence-executor.ts`, `main.ts` |
| 2 | `session-manager.ts` | — | `director-service.ts`, `main.ts`, `preload.ts`, `Dashboard.tsx` |
| 3 | `director-orchestrator.ts` | `director-service.ts` | `config-service.ts`, `event-mapper.ts`, `main.ts`, `preload.ts`, `Dashboard.tsx` |
| 4 | — | ~180 lines of legacy types | `normalizer.ts`, `director-types.ts`, `sequence-executor.ts`, `main.ts`, `openapi.yaml` |
| 5 | — | — | `sequence-library-service.ts`, `main.ts` |
| 6 | — | Legacy references | Docs, comments |
