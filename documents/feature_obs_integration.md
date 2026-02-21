# OBS Integration Feature Specification

> **Status: Extension + Core Module (Dual-Layer)**
> This feature is implemented as:
> - **Extension** at `src/extensions/obs` — runs in the Extension Host utility process, registers intent handlers.
> - **Core Module** at `src/main/modules/obs-core` — runs in the Main Process, provides IPC handlers for the Renderer and direct access for the Sequence Executor.
>
> See `feature_extension_system.md` § 2.5 "Core Module Lifecycle Management" for the architectural pattern.

## Overview
This feature integrates **OBS Studio** (Open Broadcaster Software) using the `obs-websocket-js` library. The Director application can control broadcast scenes programmatically, ensuring the correct camera feeds and graphics are displayed during a race event.

## Architecture

### Dual-Layer Design
OBS uses a dual-layer architecture because:
1. The **Core Module (`ObsService`)** must live in the Main Process so IPC handlers can return status synchronously and the Sequence Executor can call `switchScene()` directly.
2. The **Extension** runs in the isolated utility process and registers intent handlers (`obs.switchScene`, `obs.getScenes`) for the Extension API.

### Lifecycle Rules
- The `ObsService` is **instantiated** at app startup but does **NOT** connect automatically.
- Connection is initiated only when:
  1. The user clicks **Connect** in the OBS Panel, OR
  2. The extension is enabled AND `autoConnect` is `true` in config.
- When the extension is **disabled** (via the master toggle), `main.ts` must call `obsService.stop()` to halt the connection and reconnect loop.
- `ObsService.stop()` sets a `stopping` flag to prevent the `ConnectionClosed` event from re-triggering the reconnect loop (see § 2.5 in `feature_extension_system.md`).

## Design Pattern: Module-Based Dashboard
1.  **Sidebar**: Adds an OBS icon (Aperture) to the main navigation.
2.  **Preview Module**: Adds an "OBS Status" card to the main dashboard.
    - Displays connection state (Connected/Disconnected).
    - Displays configuration warnings (e.g., "Missing Scenes").
    - Clicking it navigates to the Detail Page.
3.  **Detail Page**: A dedicated view (`/obs`) with **Status** and **Settings** tabs.

## Scope

### 1. Backend (Main Process — `ObsService`)
- **Library**: `obs-websocket-js`
- **Service**: `ObsService` class at `src/main/modules/obs-core/obs-service.ts`.
    - **Connection**: User-initiated via IPC or auto-connect on startup (if configured).
    - **Reconnect**: Automatic retry every 5 seconds with a `stopping` flag guard.
    - **Validation**: On connection, fetch scene list and compare against session requirements.
    - **Scene Switching**: `switchScene(sceneName)` method.
    - **Config Management**: `saveConfig(host, password, autoConnect)` persists to `configService`.
- **IPC Handlers** (registered in `main.ts`):
    - `obs:get-status`: Returns `{ connected, missingScenes, availableScenes, host, autoConnect }`.
    - `obs:get-scenes`: Returns available scene list.
    - `obs:set-scene`: Switches the active scene.
    - `obs:connect`: Initiates connection using saved credentials.
    - `obs:disconnect`: Stops connection and reconnect loop.
    - `obs:get-config`: Returns `{ host, passwordSet, autoConnect }` for the Settings UI.
    - `obs:save-settings`: Persists `{ host, password, autoConnect }` to config.

### 2. Frontend (Renderer)
- **Navigation**: OBS Panel registered in `extension-views.ts` as a full-page component.
- **Sidebar**: Aperture icon.
- **Dashboard Widget (`DashboardCard.tsx`)**:
    - **Status Indicator**:
        - Green: Connected & Config Valid.
        - Yellow: Connected but Missing Scenes.
        - Red: Disconnected.
    - **Action**: Click → Navigate to OBS Panel.
- **Panel (`Panel.tsx`)**: Two-tab layout:
    - **Status Tab**:
        - Connection banner with ONLINE/OFFLINE badge.
        - **Connect** / **Disconnect** button (user-controlled).
        - Missing scenes warning (if applicable).
        - Scene Control grid — buttons to switch scenes.
        - "Configuration Required" warning if no host is set.
    - **Settings Tab**:
        - WebSocket Host input (e.g., `ws://localhost:4455`).
        - Password input (masked, shows "set" state).
        - **Auto-Connect on Startup** toggle (persisted).
        - Save button.

### 3. Extension (Utility Process — `src/extensions/obs/index.ts`)
- Registers intent handlers:
    - `obs.switchScene` — switches the OBS scene via `obs-websocket-js`.
    - `obs.getScenes` — emits current scene list as an event.
- Manages its own `obs-websocket-js` instance within the utility process.
- Emits `obs.connectionStateChanged` event on connect/disconnect.

### 4. Intent Integration (Sequence Executor)
- **Intent**: `obs.switchScene`
- **Payload**:
    ```json
    {
      "sceneName": "string",
      "transition": "string (optional)",
      "duration": "number (optional, ms)"
    }
    ```
- **Soft Failure**: If the OBS extension is disabled, the Sequence Executor skips the step and logs a warning.

## Configuration
- **Persisted via `configService`** (electron-store):
    - `obs.host`: WebSocket URL (e.g., `ws://localhost:4455`).
    - `obs.password`: WebSocket password.
    - `obs.autoConnect`: Whether to connect automatically on startup (default: `false`).
    - `obs.enabled`: Master extension toggle (managed by Core).
- **No `.env` dependency**: All OBS configuration is managed through the Settings UI and persisted in electron-store. Environment variables (`OBS_WS_PASSWORD`) are supported as fallbacks but not the primary mechanism.

## Validation Logic
1.  **Trigger**: Runs automatically when OBS connects OR when the Race Session data is refreshed.
2.  **Input**:
    - `RaceSession.scenes`: Expected scene names from Race Control API.
    - `OBS.GetSceneList()`: Actual scenes in OBS.
3.  **Output**:
    - `missingScenes`: Scenes expected but not found.
    - Drives the warning UI in the Dashboard Widget and Panel Status tab.

## Lessons Learned

### 1. Unconditional Auto-Connect Causes Log Noise
**Problem**: The original implementation called `obsService.start('ws://localhost:4455')` unconditionally at startup. When OBS was not running, the reconnect loop filled the console with connection errors every 5 seconds, making it difficult to debug other issues.

**Resolution**: Connection is now user-initiated. The `autoConnect` preference defaults to `false`. Users opt in via the Settings tab.

### 2. Disabling Extension Did Not Stop Core Module
**Problem**: The extension master toggle correctly unloaded the extension from the utility process, but the `ObsService` in the main process continued its reconnect loop independently.

**Resolution**: Added lifecycle hooks in `main.ts` — when `extensions:set-enabled` is called for `director-obs` with `enabled=false`, `obsService.stop()` is explicitly called.

### 3. The `stopping` Flag Pattern
**Problem**: `ObsService.stop()` called `obs.disconnect()`, which fired `ConnectionClosed`, which called `startReconnect()` — making the service impossible to stop.

**Resolution**: Added a `stopping` boolean flag. Set to `true` in `stop()`, checked in `ConnectionClosed` handler and reconnect loop. Reset to `false` in `connect()`. This pattern is now documented in `feature_extension_system.md` § 2.5 as a required pattern for all services with reconnect loops.

### 4. Cross-Cutting: Extension "Active" ≠ "Connected"
The same root-cause pattern that affected OBS was later found in iRacing: renderer components using `getStatus().active` as a proxy for connection state. OBS avoided this specific manifestation because it has a dedicated `obs:get-status` IPC handler returning real connection state, but the underlying confusion (extension lifecycle vs. integration connectivity) is a systemic risk.

**Resolution**: Documented as an anti-pattern in `feature_extension_system.md` § 2.4. Added `getLastEvent()` event caching API (§ 2.6) as the canonical solution for extension-only integrations.
