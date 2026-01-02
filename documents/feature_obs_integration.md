# OBS Integration Feature Specification

## Overview
This feature implements the integration with **OBS Studio** (Open Broadcaster Software) using the `obs-websocket-js` library. This allows the Director application to control broadcast scenes programmatically, ensuring the correct camera feeds and graphics are displayed during a race event.

## Design Pattern: Module-Based Dashboard
This feature follows the standard "Module-Based Dashboard" pattern:
1.  **Sidebar**: Adds an OBS icon (Camera/Aperture) to the main navigation.
2.  **Preview Module**: Adds an "OBS Status" card to the main dashboard.
    - Displays connection state (Connected/Disconnected).
    - Displays configuration warnings (e.g., "Missing Scenes").
    - Clicking it navigates to the Detail Page.
3.  **Detail Page**: A dedicated view (`/obs`) displaying connection details, scene lists, and manual controls.

## Scope

### 1. Backend (Main Process)
- **Library**: Use `obs-websocket-js` to communicate with the OBS WebSocket server.
- **Service**: Create `ObsService` class.
    - **Initialization**: Attempt to connect on app startup using credentials from `.env`.
    - **Connection Logic**:
        - Implement a retry mechanism with exponential backoff or fixed interval to handle cases where OBS is started after the Director app.
        - Maintain a persistent connection.
    - **Validation**:
        - Upon connection, fetch the list of available scenes from OBS.
        - Compare available scenes against the `RaceSession` configuration (fetched via `DirectorService`).
        - Identify any scenes required by the session that are missing in OBS.
    - **Command Execution**:
        - Method to switch the current program scene.
- **IPC Handlers**:
    - `obs:get-status`: Returns `{ connected: boolean, missingScenes: string[] }`.
    - `obs:get-scenes`: Returns a list of available scenes in OBS.
    - `obs:set-scene`: Accepts a scene name to switch to.

### 2. Frontend (Renderer)
- **Navigation**: Update `App.tsx` to handle the new view.
- **Sidebar**: Add OBS menu item.
- **Preview Module**:
    - **Status**:
        - Green: Connected & Config Valid.
        - Yellow: Connected but Missing Scenes (show count).
        - Red: Disconnected.
    - **Action**: Click -> Navigate to `/obs`.
- **Detail Page (`ObsPage.tsx`)**:
    - **Connection Status**: Display URL and Connection State.
    - **Validation Report**:
        - If scenes are missing, list them explicitly with a warning UI.
        - Show a list of "Verified Scenes" (scenes present in both config and OBS).
    - **Manual Controls**:
        - List of available scenes as buttons or a dropdown.
        - Clicking a scene switches it immediately in OBS.

### 3. Command Handler Integration
- Create/Update `SwitchObsSceneHandler` in `src/main/handlers/switch-obs-scene-handler.ts`.
- **Command Type**: `SWITCH_OBS_SCENE`
- **Payload Definition**:
    ```json
    {
      "sceneName": "string" // The exact name of the scene in OBS to switch to
    }
    ```
- **Logic**:
    - Receive `SWITCH_OBS_SCENE` command from the Sequence Executor.
    - Extract `sceneName` from the payload.
    - Call `ObsService.switchScene(sceneName)`.
    - Handle errors (e.g., scene not found, OBS disconnected) by logging them via the `LogHandler`.

## Configuration
- **Environment Variables**:
    - `OBS_WS_URL`: The WebSocket URL (e.g., `ws://localhost:4455`).
    - `OBS_WS_PASSWORD`: The password for the OBS WebSocket server.
- **Updates**:
    - Add these keys to `.env.example`.

## Validation Logic
The core value of this feature is ensuring the broadcast is "ready" before it starts.

1.  **Trigger**: Runs automatically when OBS connects OR when the Race Session data is refreshed.
2.  **Input**:
    - `RaceSession.scenes`: A list of expected scene names defined in the Race Control API.
    - `OBS.GetSceneList()`: The actual scenes in OBS.
3.  **Process**:
    - Iterate through `RaceSession.scenes`.
    - Check if each exists in `OBS.GetSceneList()`.
4.  **Output**:
    - `missingScenes`: Array of scene names that are expected but not found.
    - This array drives the warning UI in the Preview Module and Detail Page.
