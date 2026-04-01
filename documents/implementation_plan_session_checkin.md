# Implementation Plan: Session Check-In & Capability Exchange

**Date:** 2026-03-14  
**Branch:** `feature/session-checkin`  
**Depends On:** `feature_session_claim.md` (RFC), `response_session_checkin.md` (our response)  
**Status:** Ready to implement (Phases A–C have no RC dependency)

---

## Overview

This plan implements the five-phase session lifecycle (Check In → On Standby → Start Agent → Directing → Wrap) from the Session Check-In RFC. Work is organized so that foundational pieces ship first and the full flow is wired up incrementally.

Phases A–C can start immediately — they have **zero dependency on Race Control**. Phase D requires RC's endpoint or a mock server. Phase E is UI polish.

---

## Phase A: Types & Director Instance ID

**Goal:** Lay the type foundation and generate a persistent Director identity.  
**Files touched:** `director-types.ts`, `config-service.ts`  
**No dependencies.**

### A1. Add check-in types to `director-types.ts`

Add after the existing `DirectorState` interface (~line 158):

```typescript
// ── Session Check-In Types ──────────────────────────────────────────────

export type CheckinStatus = 'unchecked' | 'checking-in' | 'standby' | 'directing' | 'wrapping' | 'error';

export interface ConnectionHealth {
  connected: boolean;
  connectedSince?: string;   // ISO8601
  metadata?: Record<string, unknown>;
}

export interface IntentCapability {
  intent: string;
  extensionId: string;
  active: boolean;
  schema?: Record<string, unknown>;
}

export interface DirectorCapabilities {
  intents: IntentCapability[];
  connections: Record<string, ConnectionHealth>;
}

export interface SessionCheckinRequest {
  directorId: string;
  version: string;
  capabilities: DirectorCapabilities;
}

export interface SessionCheckinResponse {
  status: 'standby';
  checkinId: string;
  checkinTtlSeconds: number;
  sessionConfig: SessionOperationalConfig;
  warnings?: string[];
}

export interface SessionOperationalConfig {
  raceSessionId: string;
  name: string;
  status: string;
  simulator: string;
  drivers: SessionDriverMapping[];
  obsScenes: string[];
  obsHost?: string;
  pollingConfig?: {
    idleIntervalMs: number;
    busyIntervalMs: number;
    maxBackoffMs?: number;
  };
}

export interface SessionDriverMapping {
  driverId: string;
  carNumber: string;
  rigId: string;
  obsSceneId: string;
  displayName?: string;
}

export interface SessionCheckinConflict {
  error: string;
  existingCheckin: {
    directorId: string;
    checkedInAt: string;
    expiresAt: string;
    displayName?: string;
  };
}
```

### A2. Expand `DirectorState` to include check-in status

Current `DirectorState` (line 151):
```typescript
export interface DirectorState {
  isRunning: boolean;
  status: DirectorStatus;
  sessionId: string | null;
  // ...
}
```

Add fields:
```typescript
export interface DirectorState {
  isRunning: boolean;
  status: DirectorStatus;
  sessionId: string | null;
  currentSequenceId?: string | null;
  totalCommands?: number;
  processedCommands?: number;
  lastError?: string;
  // NEW: Check-in lifecycle
  checkinStatus: CheckinStatus;
  checkinId?: string | null;
  sessionConfig?: SessionOperationalConfig | null;
  checkinWarnings?: string[];
}
```

### A3. Add `directorId` to `ConfigService`

In `config-service.ts`, add to the schema:
```typescript
director: {
  type: 'object',
  properties: {
    id: { type: 'string' }
  },
  default: {}
}
```

Add a method:
```typescript
getOrCreateDirectorId(): string {
  let id = this.store.get('director.id' as any) as string | undefined;
  if (!id) {
    id = `d_inst_${randomUUID()}`;
    this.store.set('director.id' as any, id);
  }
  return id;
}
```

### A4. Add check-in endpoint to `auth-config.ts`

In `apiConfig.endpoints`, add:
```typescript
checkin: (sessionId: string) => `/api/director/v1/sessions/${sessionId}/checkin`,
```

### Acceptance criteria (Phase A)
- [ ] All check-in types compile.
- [ ] `DirectorState.checkinStatus` is returned by `getStatus()` (defaults to `'unchecked'`).
- [ ] `configService.getOrCreateDirectorId()` returns the same UUID across restarts.
- [ ] `apiConfig.endpoints.checkin(id)` resolves to correct URL.

---

## Phase B: Connection Health API

**Goal:** Build a unified `getConnectionHealth()` method on `ExtensionHostService` so the check-in payload can include real-time hardware state.  
**Files touched:** `extension-host.ts`, `extension-types.ts`, extension `index.ts` files  
**No RC dependency.**

### B1. Add `reportConnectionState()` to `ExtensionAPI`

In `extension-types.ts`, add to the `ExtensionAPI` interface:
```typescript
reportConnectionState(connected: boolean, metadata?: Record<string, unknown>): void;
```

### B2. Track connection health in `ExtensionHostService`

Add a private field:
```typescript
private connectionHealth: Map<string, ConnectionHealth> = new Map();
```

Handle a new `REPORT_CONNECTION_STATE` IPC message from the child process:
```typescript
case 'REPORT_CONNECTION_STATE':
  this.connectionHealth.set(msg.payload.extensionId, {
    connected: msg.payload.connected,
    connectedSince: msg.payload.connected ? new Date().toISOString() : undefined,
    metadata: msg.payload.metadata,
  });
  break;
```

Add public method:
```typescript
public getConnectionHealth(): Record<string, ConnectionHealth> {
  const health: Record<string, ConnectionHealth> = {};
  for (const [id] of this.scannedExtensions) {
    const reported = this.connectionHealth.get(id);
    health[id] = reported ?? { connected: false };
  }
  return health;
}
```

### B3. Update `extension-process.ts` to handle `reportConnectionState`

In the child-process `ExtensionApiImpl`, implement:
```typescript
reportConnectionState(connected: boolean, metadata?: Record<string, unknown>): void {
  parentPort.postMessage({
    type: 'REPORT_CONNECTION_STATE',
    payload: { extensionId: this.extensionId, connected, metadata },
  });
}
```

### B4. Call `reportConnectionState()` in each extension

**OBS** (`src/extensions/obs/index.ts`):
```typescript
// In ConnectionOpened handler:
director.reportConnectionState(true, { host, version: obsVersion });

// In ConnectionClosed handler:
director.reportConnectionState(false);
```

**iRacing** (`src/extensions/iracing/index.ts`):
```typescript
// When shared memory opens:
director.reportConnectionState(true, { sessionNum });

// When shared memory closes/disconnects:
director.reportConnectionState(false);
```

**Discord** (`src/extensions/discord/index.ts`):

Discord's connection is managed by `DiscordService` in the main process, not the extension. Two options:
1. Have `DiscordService` call `extensionHost.setConnectionHealth('discord', ...)` directly.
2. Have the extension query via `director.invoke('discordGetStatus')` on activate.

**Prefer option 1** — add a `setConnectionHealth(extensionId, health)` public method on `ExtensionHostService` for main-process integrations that don't run in the child process.

**YouTube** (`src/extensions/youtube/index.ts`):
```typescript
// When scraper opens successfully:
director.reportConnectionState(true, { monitoring: true, broadcastId });

// When scraper closes:
director.reportConnectionState(false);
```

### Acceptance criteria (Phase B)
- [ ] `extensionHost.getConnectionHealth()` returns state for all 4 extensions.
- [ ] OBS reports `connected: true` with host metadata when WebSocket connects.
- [ ] OBS reports `connected: false` when WebSocket disconnects.
- [ ] iRacing reports connection state changes.
- [ ] YouTube reports connection state changes.
- [ ] Discord health is reported from `DiscordService` via `setConnectionHealth()`.
- [ ] `getConnectionHealth()` returns `{ connected: false }` for extensions that haven't reported yet.

---

## Phase C: Check-In & Wrap Service Methods

**Goal:** Implement `checkinSession()`, `wrapSession()`, and `buildCapabilities()` in `DirectorService`. Wire auto-wrap into `setSession()` and `will-quit`.  
**Files touched:** `director-service.ts`, `main.ts`, `preload.ts`  
**Can be built against a mock — no live RC endpoint needed.**

### C1. Add check-in state fields to `DirectorService`

```typescript
// New fields
private checkinId: string | null = null;
private checkinStatus: CheckinStatus = 'unchecked';
private sessionConfig: SessionOperationalConfig | null = null;
private checkinWarnings: string[] = [];
private checkinTtlSeconds: number = 120;
```

### C2. Implement `buildCapabilities()`

```typescript
private buildCapabilities(): DirectorCapabilities {
  const catalog = this.extensionHost.getCapabilityCatalog();
  const allIntents = catalog.getAllIntents();

  return {
    intents: [
      ...allIntents.map(entry => ({
        intent: entry.intent.intent,
        extensionId: entry.extensionId,
        active: entry.enabled && this.extensionHost.hasActiveHandler(entry.intent.intent),
        schema: entry.intent.schema as Record<string, unknown> | undefined,
      })),
      { intent: 'system.wait', extensionId: 'built-in', active: true },
      { intent: 'system.log', extensionId: 'built-in', active: true },
    ],
    connections: this.extensionHost.getConnectionHealth(),
  };
}
```

### C3. Implement `checkinSession()`

```typescript
async checkinSession(raceSessionId: string): Promise<SessionCheckinResponse> {
  this.checkinStatus = 'checking-in';

  const token = await this.authService.getAccessToken();
  if (!token) throw new Error('No auth token available for check-in');

  const capabilities = this.buildCapabilities();
  const url = `${apiConfig.baseUrl}${apiConfig.endpoints.checkin(raceSessionId)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      directorId: configService.getOrCreateDirectorId(),
      version: app.getVersion(),
      capabilities,
    }),
  });

  if (response.status === 409) {
    this.checkinStatus = 'error';
    const conflict: SessionCheckinConflict = await response.json();
    throw Object.assign(new Error(conflict.error), { conflict, statusCode: 409 });
  }

  if (response.status === 410) {
    this.checkinStatus = 'error';
    throw Object.assign(new Error('Session has ended'), { statusCode: 410 });
  }

  if (!response.ok) {
    this.checkinStatus = 'error';
    throw new Error(`Check-in failed: ${response.status} ${await response.text()}`);
  }

  const checkin: SessionCheckinResponse = await response.json();
  this.checkinId = checkin.checkinId;
  this.checkinStatus = 'standby';
  this.sessionConfig = checkin.sessionConfig;
  this.checkinWarnings = checkin.warnings ?? [];

  this.applySessionConfig(checkin.sessionConfig);

  telemetryService.trackEvent('Director.CheckedIn', {
    sessionId: raceSessionId,
    checkinId: checkin.checkinId,
    intentCount: String(capabilities.intents.length),
  });

  return checkin;
}
```

### C4. Implement `wrapSession()`

```typescript
async wrapSession(): Promise<void> {
  if (!this.checkinId || !this.currentRaceSessionId) return;

  this.checkinStatus = 'wrapping';

  try {
    const token = await this.authService.getAccessToken();
    if (!token) {
      console.warn('[Director] No token for wrap — check-in will expire via TTL.');
      return;
    }

    const url = `${apiConfig.baseUrl}${apiConfig.endpoints.checkin(this.currentRaceSessionId)}`;
    await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Checkin-Id': this.checkinId,
      },
    });

    telemetryService.trackEvent('Director.Wrapped', {
      sessionId: this.currentRaceSessionId,
      checkinId: this.checkinId,
    });
  } catch (err) {
    console.warn('[Director] Wrap request failed (check-in will TTL-expire):', (err as Error).message);
  } finally {
    this.checkinId = null;
    this.checkinStatus = 'unchecked';
    this.sessionConfig = null;
    this.checkinWarnings = [];
  }
}
```

### C5. Implement `applySessionConfig()`

```typescript
private applySessionConfig(config: SessionOperationalConfig): void {
  // Apply OBS host override (session-scoped, not persisted)
  if (config.obsHost) {
    console.log(`[Director] Applying session OBS host: ${config.obsHost}`);
    // Emit event so OBS extension can reconnect to session-specific host
    this.extensionHost.getEventBus()?.emit('director.sessionConfig', {
      obsHost: config.obsHost,
      obsScenes: config.obsScenes,
    });
  }

  // Apply polling config (use session values if provided, fallback to defaults)
  if (config.pollingConfig) {
    console.log(`[Director] Applying session polling config:`, config.pollingConfig);
    // Note: polling intervals are used dynamically in loop(), so we read from sessionConfig
  }

  console.log(`[Director] Session config applied: ${config.drivers?.length ?? 0} drivers, ${config.obsScenes?.length ?? 0} scenes`);
}
```

### C6. Update `setSession()` to wrap-then-checkin

Replace existing `setSession()`:
```typescript
async setSession(raceSessionId: string): Promise<DirectorState> {
  console.log(`[DirectorService] Setting active session: ${raceSessionId}`);
  const wasRunning = this.isRunning;

  if (wasRunning) {
    this.stop();
  }

  // Wrap previous session if checked in
  if (this.checkinId && this.currentRaceSessionId) {
    await this.wrapSession().catch(err =>
      console.warn('[Director] Failed to wrap previous session:', err.message)
    );
  }

  // Check in to the new session
  const checkin = await this.checkinSession(raceSessionId);
  this.currentRaceSessionId = raceSessionId;
  this.lastCompletedSequenceId = null;
  this.lastError = undefined;

  // Do NOT auto-restart — user must click "Start Agent" from standby
  return this.getStatus();
}
```

**Important design change:** After check-in, the Director enters **standby** — it does NOT auto-start polling. The user explicitly starts the agent (Phase 3 of the lifecycle). This matches the RFC's five-phase model.

### C7. Add `X-Checkin-Id` header to polling (with query param fallback)

In `fetchAndExecuteNextSequence()`, update the fetch headers:
```typescript
const headers: Record<string, string> = {
  'Authorization': `Bearer ${token}`,
};
if (this.checkinId) {
  headers['X-Checkin-Id'] = this.checkinId;
}

// Fallback: also send as query param in case SWA strips custom headers
if (this.checkinId) {
  params.set('checkinId', this.checkinId);
}

const response = await fetch(url, { method: 'GET', headers });
```

### C8. Update `start()` to transition from standby to directing

```typescript
async start() {
  if (this.isRunning) return;

  // Must be checked in before starting
  if (this.checkinStatus !== 'standby' && this.checkinStatus !== 'unchecked') {
    console.warn(`[Director] Cannot start: checkin status is '${this.checkinStatus}'`);
    return;
  }

  console.log('Starting Director Agent...');
  this.isRunning = true;

  if (this.checkinStatus === 'standby') {
    this.checkinStatus = 'directing';
  }

  // Store TTL for heartbeat floor rate calculation
  this.checkinTtlSeconds = this.sessionConfig?.pollingConfig 
    ? Math.floor((this.sessionConfig.pollingConfig.idleIntervalMs * 24) / 1000)  // fallback
    : 120;

  // Use pre-selected session if set, otherwise discover
  if (!this.currentRaceSessionId) {
    const sessions = await this.listSessions();
    if (!sessions || sessions.length === 0) {
      console.log('No active sessions found. Director will not start.');
      this.isRunning = false;
      return;
    }
    const session = sessions[0];
    this.currentRaceSessionId = session.raceSessionId;
    console.log(`Auto-selected session: ${session.name} (${session.raceSessionId})`);
  }

  this.loop();
}
```

### C9. Update `stop()` to transition back to standby

```typescript
stop() {
  console.log('Stopping Director Agent...');
  this.isRunning = false;
  if (this.loopInterval) {
    clearTimeout(this.loopInterval);
    this.loopInterval = null;
  }
  this.status = 'IDLE';

  // Return to standby (still checked in) rather than unchecked
  if (this.checkinStatus === 'directing') {
    this.checkinStatus = 'standby';
  }
}
```

### C10. Update `getStatus()` to include check-in fields

```typescript
getStatus(): DirectorState {
  return {
    isRunning: this.isRunning,
    status: this.status,
    sessionId: this.currentRaceSessionId,
    currentSequenceId: this.currentSequenceId,
    totalCommands: this.totalCommands,
    processedCommands: this.processedCommands,
    lastError: this.lastError,
    // Check-in lifecycle
    checkinStatus: this.checkinStatus,
    checkinId: this.checkinId,
    sessionConfig: this.sessionConfig,
    checkinWarnings: this.checkinWarnings,
  };
}
```

### C11. Update `loop()` for session-ended auto-wrap and heartbeat floor rate

In the `loop()` method, when `sessionEnded` error is caught:
```typescript
if ((error as any)?.sessionEnded) {
  console.log('[Director] Session has ended. Wrapping and stopping.');
  await this.wrapSession().catch(() => {});
  this.stop();
  return;
}
```

And when computing the next poll interval, enforce the heartbeat floor rate:
```typescript
// Heartbeat floor rate contract: poll at min(Retry-After, checkinTtlSeconds / 4)
// to prevent check-in TTL from lapsing during long Retry-After intervals.
if (this.checkinId && this.checkinTtlSeconds) {
  const maxIntervalMs = (this.checkinTtlSeconds * 1000) / 4;
  interval = Math.min(interval, maxIntervalMs);
}
```

### C12. Wire auto-wrap on exit in `main.ts`

Update the `will-quit` handler:
```typescript
app.on('will-quit', async () => {
  // Gracefully wrap any active session
  if (directorService) {
    await directorService.wrapSession().catch(() => {});
  }
  if (overlayServer) {
    await overlayServer.stop();
  }
  if (extensionHost) {
    await extensionHost.stop();
  }
});
```

### C13. Add IPC handlers for check-in / wrap

In `main.ts`:
```typescript
ipcMain.handle('director:checkin-session', async (_, raceSessionId: string) => {
  return await directorService.setSession(raceSessionId);
});

ipcMain.handle('director:wrap-session', async () => {
  await directorService.wrapSession();
  return directorService.getStatus();
});
```

### C14. Expose in `preload.ts`

```typescript
directorCheckinSession: (raceSessionId: string) => ipcRenderer.invoke('director:checkin-session', raceSessionId),
directorWrapSession: () => ipcRenderer.invoke('director:wrap-session'),
```

### C15. Handle 410 Gone on check-in in `loop()` and polling

The polling loop already handles `410 Gone`. The check-in `409 Conflict` error needs to surface to the renderer. The `setSession()` call will throw — the IPC handler in `main.ts` should let the error propagate so the renderer can display the conflict dialog.

### Acceptance criteria (Phase C)
- [ ] `setSession(id)` calls `wrapSession()` on previous session, then `checkinSession()` on new session.
- [ ] `getStatus()` returns `checkinStatus`, `checkinId`, `sessionConfig`, `checkinWarnings`.
- [ ] `start()` transitions `checkinStatus` from `standby` to `directing`.
- [ ] `stop()` transitions `checkinStatus` from `directing` back to `standby`.
- [ ] `wrapSession()` sends `DELETE .../checkin` with `X-Checkin-Id` header.
- [ ] `fetchAndExecuteNextSequence()` sends `X-Checkin-Id` header on every poll.
- [ ] `will-quit` handler calls `wrapSession()`.
- [ ] `409 Conflict` thrown from `setSession()` includes conflict details.
- [ ] Polling loop on `410 Gone` calls `wrapSession()` before stopping.
- [ ] IPC `director:checkin-session` and `director:wrap-session` are registered and exposed to renderer.

---

## Phase D: Integration Testing with Mock / Staging

**Goal:** Verify end-to-end flow without waiting for RC production endpoint.  
**Approach:** Add a local mock handler or use RC staging.

### D1. Option: Local mock for `POST .../checkin` and `DELETE .../checkin`

Create `src/main/mock-checkin.ts` — a simple Express-like mock or intercept in `director-service.ts` behind a feature flag:

```typescript
if (apiConfig.baseUrl.includes('localhost') || process.env.MOCK_CHECKIN === 'true') {
  // Return mock response
}
```

Mock response:
```json
{
  "status": "standby",
  "checkinId": "mock_checkin_001",
  "checkinTtlSeconds": 120,
  "sessionConfig": {
    "raceSessionId": "sess_mock",
    "name": "Mock Race — Integration Test",
    "status": "ACTIVE",
    "simulator": "iracing",
    "drivers": [],
    "obsScenes": ["Race Cam", "Onboard 1"],
    "pollingConfig": { "idleIntervalMs": 5000, "busyIntervalMs": 100 }
  },
  "warnings": ["Mock mode — no RC endpoint"]
}
```

### D2. End-to-end test script

Create `scripts/test-session-checkin.ts`:
1. Start Director service.
2. Call `setSession(mockSessionId)` — verify check-in fires, status becomes `standby`.
3. Call `start()` — verify status becomes `directing`, polling sends `X-Checkin-Id`.
4. Call `stop()` — verify status returns to `standby`.
5. Call `wrapSession()` — verify `DELETE` fires, status becomes `unchecked`.

### Acceptance criteria (Phase D)
- [ ] Full lifecycle works end-to-end with mock or staging.
- [ ] Check-in → standby → start agent → directing → stop → standby → wrap → unchecked.
- [ ] `X-Checkin-Id` header present on every poll request.
- [ ] Session config applied after check-in (logged to console).

---

## Phase E: UI — Session Lifecycle Display

**Goal:** Update `DirectorPanel.tsx` and `DirectorDashboardCard.tsx` to show the five-phase lifecycle. Handle 409 Conflict.  
**Files touched:** `DirectorPanel.tsx`, `DirectorDashboardCard.tsx`, `Dashboard.tsx`

### E1. Update DirectorPanel status display

Replace the current IDLE/BUSY/ERROR indicator with a lifecycle status badge:

| `checkinStatus` | Badge Color | Label | Button |
|:---|:---|:---|:---|
| `unchecked` | Gray | NO SESSION | – |
| `checking-in` | Yellow (pulsing) | CHECKING IN... | – |
| `standby` | Green | ON STANDBY | "Start Agent" |
| `directing` | Apex Orange (pulsing) | DIRECTING | "Stop Agent" |
| `wrapping` | Yellow | WRAPPING... | – |
| `error` | Red | ERROR | "Retry" / "Force Check-In" |

### E2. "Start Agent" / "Stop Agent" button logic

Change the toggle button:
- **Standby → Start Agent:** Calls `window.electronAPI.directorStart()`
- **Directing → Stop Agent:** Calls `window.electronAPI.directorStop()`
- **Unchecked:** Button disabled (must select session first)

### E3. Session selection triggers check-in

In `Dashboard.tsx`, when user selects a session:
```typescript
const handleSelectSession = async (sessionId: string) => {
  try {
    const status = await window.electronAPI.directorCheckinSession(sessionId);
    // Navigate to DirectorPanel or update state
  } catch (err: any) {
    if (err.conflict) {
      // Show 409 Conflict dialog
      setConflictInfo(err.conflict.existingCheckin);
      setShowConflictDialog(true);
    } else {
      // Show error toast
    }
  }
};
```

### E4. 409 Conflict dialog

When another Director already holds the session, show a dialog:
- **Title:** "SESSION IN USE"
- **Body:** "This session is currently being directed by {displayName || directorId}. Checked in at {checkedInAt}. Expires at {expiresAt}."
- **Actions:**
  - "Wait" — dismiss dialog
  - "Force Check-In" — re-call with `X-Force-Checkin: true` (if user has admin role)

### E5. Check-in warnings display

If `checkinWarnings` is non-empty after check-in, show a yellow banner on the DirectorPanel during standby:
```
⚠ Race Control warnings:
• Primary camera intent not available
• Discord TTS is offline
```

### E6. Session config display

Show session config from check-in on the DirectorPanel:
- **Drivers:** List of driver name + car number + rig + OBS scene
- **OBS Scenes:** List of expected scenes (with validation against live OBS scene list)
- **Polling Config:** Show idle/busy intervals

### E7. Dashboard card status

Update `DirectorDashboardCard.tsx` to show `checkinStatus` instead of just `isRunning`. Show a small colored dot:
- Green = standby
- Orange (pulsing) = directing
- Red = error
- Gray = unchecked

### Acceptance criteria (Phase E)
- [ ] DirectorPanel shows lifecycle status badge (unchecked/standby/directing/etc).
- [ ] "Start Agent" button appears in standby; "Stop Agent" appears while directing.
- [ ] Session selection triggers check-in (not auto-start).
- [ ] 409 Conflict dialog shown with existing check-in info.
- [ ] Check-in warnings displayed during standby.
- [ ] Dashboard card reflects lifecycle status.
- [ ] Session config (drivers, scenes) visible on DirectorPanel.

---

## Phase F: OpenAPI Spec Update

**Goal:** Add check-in schemas and endpoints to `openapi.yaml`.  
**Depends on:** Schema agreement with RC (Phase 1 of RFC §9).

Add the following from RFC Section 4:
- Schemas: `DirectorCapabilities`, `IntentCapability`, `ConnectionHealth`, `SessionCheckinRequest`, `SessionCheckinResponse`, `SessionOperationalConfig`, `SessionDriverMapping`
- Endpoints: `POST /api/director/v1/sessions/{raceSessionId}/checkin`, `DELETE /api/director/v1/sessions/{raceSessionId}/checkin`
- Modified: `X-Checkin-Id` header on `GET .../sequences/next`

This is a direct copy from the RFC Section 4.1–4.3. No interpretation needed.

---

## Implementation Order

```
Phase A: Types & Director ID          ← START HERE (no dependencies)
    │
    ├── Phase B: Connection Health     ← START HERE in parallel (no dependencies)
    │
    ▼
Phase C: Check-In Service Methods     ← Depends on A + B
    │
    ├── Phase D: Integration Testing   ← Depends on C
    │
    ├── Phase E: UI Lifecycle Display  ← Depends on C (can overlap with D)
    │
    └── Phase F: OpenAPI Spec Update   ← Depends on schema agreement
```

**Phases A and B can be done in parallel with zero RC dependency.**  
**Phase C wires everything together.**  
**Phases D and E are validation and polish.**

---

## File Change Summary

| File | Changes |
|:---|:---|
| `src/main/director-types.ts` | Add 8 new interfaces, expand `DirectorState` |
| `src/main/config-service.ts` | Add `director.id` to schema, add `getOrCreateDirectorId()` |
| `src/main/auth-config.ts` | Add `checkin` endpoint function |
| `src/main/extension-host/extension-types.ts` | Add `reportConnectionState()` to `ExtensionAPI`, add `REPORT_CONNECTION_STATE` IPC type |
| `src/main/extension-host/extension-host.ts` | Add `connectionHealth` map, `getConnectionHealth()`, `setConnectionHealth()`, handle new IPC message |
| `src/main/extension-host/extension-process.ts` | Implement `reportConnectionState()` in `ExtensionApiImpl` |
| `src/extensions/obs/index.ts` | Call `director.reportConnectionState()` on connect/disconnect |
| `src/extensions/iracing/index.ts` | Call `director.reportConnectionState()` on connect/disconnect |
| `src/extensions/youtube/index.ts` | Call `director.reportConnectionState()` on monitor start/stop |
| `src/main/director-service.ts` | Add check-in fields, `checkinSession()`, `wrapSession()`, `buildCapabilities()`, `applySessionConfig()`. Update `setSession()`, `start()`, `stop()`, `getStatus()`, `fetchAndExecuteNextSequence()`, `loop()` |
| `src/main/main.ts` | Add `director:checkin-session` and `director:wrap-session` IPC handlers. Update `will-quit` handler. |
| `src/main/preload.ts` | Add `directorCheckinSession()`, `directorWrapSession()` |
| `src/renderer/pages/DirectorPanel.tsx` | Lifecycle status badge, start/stop agent buttons, warnings display, session config display |
| `src/renderer/components/director/DirectorDashboardCard.tsx` | Lifecycle status dot |
| `src/renderer/pages/Dashboard.tsx` | Session selection triggers check-in, 409 dialog |
| `openapi.yaml` | New schemas and endpoints per RFC §4 |

---

## Risk Register

| Risk | Impact | Mitigation |
|:---|:---|:---|
| RC endpoint not ready when Director ships | Director can't check in for real | Feature-flag the check-in call. Fallback: skip check-in, poll as before (backward-compat). |
| Connection health not reported by all extensions | Incomplete `capabilities.connections` in check-in | Default to `{ connected: false }` — RC treats missing data as disconnected. |
| `will-quit` fires before `wrapSession()` completes | Stale check-in blocks session | TTL auto-expiry (120s) is the safety net. |
| 409 Conflict UX confusing for operators | User can't start session | Show clear human-readable info + force-check-in button for admins. |
| `SessionOperationalConfig` schema changes mid-development | Type mismatches | Pin to the RFC schema. If RC changes it, update types per "Code to the Spec" policy. |
