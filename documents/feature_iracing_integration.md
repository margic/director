# iRacing Integration

> **Status: Active Extension**
> This feature is fully implemented as an extension located at `src/extensions/iracing`.
> It runs in the Extension Host process and communicates with the iRacing Simulator via Windows Broadcast Messages.

## Architecture: Extension-Only (No Core Module)
The iRacing integration is a standalone module running within the application's Extension Host. Unlike the OBS integration (which has a dual-layer Core Module + Extension architecture), iRacing is purely an extension. It does not run in the Main process, ensuring stability and isolation.

### Manifest (`package.json`)
Detailed capability definition:
- **ID**: `director-iracing`
- **Intents**:
    - `broadcast.showLiveCam`: Switch camera to a specific Car and Group.
    - `broadcast.replayFromTo`: Play a replay segment.
    - `broadcast.setReplaySpeed`: Control replay playback speed.
    - `broadcast.setReplayPosition`: Jump to specific frame.
    - `broadcast.setReplayState`: Set internal replay state.
- **Events**:
    - `iracing.connectionStateChanged`: Emitted when simulator connection state changes. Payload: `{ connected: boolean }`.
    - `iracing.cameraGroupsChanged`: Emitted when camera groups change (session load/change). Payload: `{ groups: [{ groupNum, groupName, isScenic }] }`.
- **Overlays**:
    - `race-info`: Top-bar overlay showing lap, flag, and leader info.
    - `flag-alert`: Center-popup overlay for flag changes (auto-hide 5000ms).

### Backend Implementation (`src/extensions/iracing/index.ts`)
The extension uses the `koffi` FFI library to interface with two Windows system DLLs:

#### Windows API Usage
| DLL | Functions | Purpose |
| :--- | :--- | :--- |
| **user32.dll** | `FindWindowA`, `PostMessageA`, `RegisterWindowMessageA` | Detect sim window, send broadcast commands |
| **kernel32.dll** | `OpenFileMappingA`, `MapViewOfFile`, `UnmapViewOfFile`, `CloseHandle` | Read iRacing shared memory for session data |

> **Dependency Note:** Both `koffi` and `js-yaml` are declared in the root `package.json` but consumed exclusively by this extension. See `feature_extension_system.md` § 2.11 for the architectural discussion on extension dependency management.

#### Connection & Command Layer (user32.dll)
- **Connection Monitoring**: Polls `FindWindowA(null, 'iRacing.com Simulator')` every 2 seconds to detect the simulator window.
- **Command Execution**: Sends `PostMessageA` with registered `IRSDK_BROADCASTMSG` window message ID to the simulator.
- **State Events**: Emits `iracing.connectionStateChanged` on the Extension Event Bus when the simulator is found or lost.
- **Overlay Management**: Shows/hides overlays based on connection state. Updates race-info overlay with session data (currently placeholder/simulated).

#### Session Data Layer (kernel32.dll — Shared Memory)
iRacing exposes session metadata via a memory-mapped file (`Local\IRSDKMemMapFileName`). The extension reads this to extract camera group names, driver info, and session configuration.

**Shared Memory Layout:**
```
┌─────────────────────────────────────────────┐
│ Header (112 bytes — 12 × int32)             │
│   [0] ver  [1] status  [2] tickRate         │
│   [3] sessionInfoUpdate  (change counter)   │
│   [4] sessionInfoLen     (YAML buffer size) │
│   [5] sessionInfoOffset  (byte offset)      │
│   [6..11] numVars, varHeaderOffset, etc.    │
├─────────────────────────────────────────────┤
│ Session Info (YAML string at offset [5])    │
│   CameraInfo.Groups[], DriverInfo[],        │
│   WeekendInfo, SessionInfo, etc.            │
├─────────────────────────────────────────────┤
│ Telemetry Variable Headers                  │
├─────────────────────────────────────────────┤
│ Telemetry Data Buffers                      │
└─────────────────────────────────────────────┘
```

**Read Strategy:**
1. When iRacing connects, `openSharedMemory()` maps the file with `FILE_MAP_READ` (read-only).
2. Every poll cycle (2s), the extension reads `headerInts[3]` (`sessionInfoUpdate` counter).
3. If the counter changed (session load, driver join, etc.), the YAML is re-read and parsed.
4. Camera groups are extracted from `CameraInfo.Groups[]` and emitted as `iracing.cameraGroupsChanged`.
5. When iRacing disconnects, `closeSharedMemory()` unmaps the view and closes the handle.

### Frontend Integration (Renderer)
The UI interacts with the extension through **Extension Events** and the **Extension API**.
- **Connection Status**: Determined by `iracing.connectionStateChanged` events via `window.electronAPI.extensions.onExtensionEvent()`, with initial state queried from `window.electronAPI.extensions.getLastEvent('iracing.connectionStateChanged')`.
- **Extension Active State**: Checked via `window.electronAPI.extensions.getStatus()['director-iracing'].active` (whether the extension is loaded — distinct from simulator connection).
- **Commands**: Dispatched via `window.electronAPI.extensions.executeIntent('broadcast.showLiveCam', ...)`.

### Event Flow: Connection State to Renderer
```
iRacing Extension (Extension Host)
  → director.emitEvent('iracing.connectionStateChanged', { connected })
    → ExtensionProcess.emitEvent()
      → ExtensionHostService (main thread) → EventBus.emitExtensionEvent()
        → eventBus.on('*') in main.ts → caches event + sends to renderer via IPC
          → window.electronAPI.extensions.onExtensionEvent(callback)
```

## User Interface
The **Control Deck** (`Panel.tsx`) provides:
1.  **Connection Status**: Header shows "Connected" / "Disconnected" subtitle driven by live extension events.
2.  **Camera Control**: Named camera group buttons populated from `iracing.cameraGroupsChanged` events (reads iRacing shared memory). Groups are categorized into three sections:
    - **Broadcast**: TV cameras (TV1, TV2, TV3, etc.), Chase, Far Chase, Rear Chase.
    - **On-Car**: Nose, Cockpit, Gearbox, Roll Bar, Gyro, suspension cameras.
    - **Scenic / Special**: Pit Lane, Blimp, Chopper, Scenic.
3.  **Target Car Number**: A persistent input field — selecting any camera button applies to the entered car.
4.  **Manual Override**: Collapsible section for entering raw group numbers (fallback when camera names aren't available).
5.  **Replay Control**: Transport controls (Play, Pause, Skip Forward, Skip Back) wired to Extension Intents.

When iRacing is not connected, the panel shows a hint message and falls back to the manual number input.

The **Dashboard Card** (`DashboardCard.tsx`) provides:
- Green/Red connection indicator dot
- "CONNECTED" / "NOT FOUND" status text
- "OPEN CONTROLS" button navigating to the full panel

## Legacy Migration
Previous direct IPC calls (`iracing:send-command`) have been removed. The application now uses the unified Intent system.

---

## Lessons Learned

### Bug: False "Connected" Status (Fixed)
**Symptom**: The dashboard card showed a green dot and "CONNECTED" status even when iRacing was not running.

**Root Cause**: The renderer components (`DashboardCard.tsx`, `Panel.tsx`) used `extensions.getStatus()['director-iracing'].active` as a proxy for simulator connection. However, `active` only indicates whether the **extension is loaded** in the Extension Host — not whether the simulator is running. Since the extension loads at startup, `active` was always `true`.

**Fix**:
1. Added **event state caching** in `main.ts`: The main process now caches the last payload for each extension event name, enabling the renderer to query the current state on mount.
2. Added `extensions:get-last-event` IPC handler + `getLastEvent()` API.
3. Rewrote renderer components to use `iracing.connectionStateChanged` events for connection state instead of the extension `active` flag.

**Key Lesson**: Extension "active" (loaded) ≠ Integration "connected" (simulator running). These are fundamentally different states. Any extension that monitors an external system must expose its connection state through Extension Events, not rely on the extension lifecycle. This anti-pattern and the correct reporting patterns are now documented in `feature_extension_system.md` § 2.4 and § 2.7.

---

## Testing Strategy

### Current State
The iRacing extension has **no automated tests**. The project has `tsconfig.test.json` with Electron mock path mapping, but no test framework is installed and no test files exist.

### Testability Challenges

| Layer | Challenge | Mitigation |
| :--- | :--- | :--- |
| **koffi FFI (user32)** | Platform-specific, requires Windows DLLs | Mock at module boundary |
| **koffi FFI (kernel32)** | Shared memory mapping requires live iRacing | Mock pointer reads, test YAML parsing separately |
| **YAML parsing** | Large session info string (~500KB) | Use captured YAML fixtures from real sessions |
| **Module-private functions** | `broadcastMessage`, `checkConnection`, etc. are not exported | Refactor to extract testable units |
| **ExtensionAPI** | Injected at `activate()` call | Trivially mockable — it's a plain interface |
| **Polling / Timers** | `setInterval` in `startPolling` | Use fake timers in test framework |

### Recommended Testing Approach

#### 1. Install Vitest (Recommended — already using Vite)
Vitest integrates seamlessly with the existing Vite toolchain and requires minimal configuration.

#### 2. Extract FFI Behind an Interface
The core testability issue is that `koffi` functions are loaded into module-level variables during `initNativeFunctions()`. Refactor to:

```typescript
// iracing-native.ts — Extracted FFI interface
export interface IracingNative {
  // user32.dll — command layer
  findSimulatorWindow(): number | null;
  registerBroadcastMessage(name: string): number;
  postMessage(hwnd: number, msg: number, wParam: number, lParam: number): boolean;
  // kernel32.dll — shared memory read layer
  openSharedMemory(name: string): void * | null;
  readHeaderInts(pBase: void *, count: number): number[];
  readBytes(pBase: void *, offset: number, length: number): Uint8Array;
  closeSharedMemory(): void;
}

export function createWindowsNative(): IracingNative { /* koffi impl */ }
export function createMockNative(): IracingNative { /* test mock */ }
```

This allows the extension logic to be tested without koffi or Windows APIs.

#### 3. Export Business Logic Functions
Functions like `broadcastMessage` (wParam/lParam bit encoding) and `checkConnection` contain important logic that should be unit-tested. Extract them into a separate module or export them:

```typescript
// iracing-protocol.ts — Pure functions, no FFI dependency
export function encodeBroadcastParams(cmd: number, var1: number, var2: number, var3: number): { wParam: number; lParam: number } {
  const wParam = (cmd & 0xFFFF) | ((var1 & 0xFFFF) << 16);
  let lParam = var2;
  if (var3 && var3 !== 0) {
    lParam = (var3 & 0xFFFF) | ((var2 & 0xFFFF) << 16);
  }
  return { wParam, lParam };
}
```

#### 4. Priority Test Cases

| Priority | Test | Type |
| :--- | :--- | :--- |
| **P0** | `encodeBroadcastParams` wParam/lParam encoding correctness | Unit |
| **P0** | `checkConnection` emits correct events on state changes | Unit (with mock native) |
| **P0** | Intent handlers call correct broadcast commands | Unit (with mock native + API) |
| **P0** | `readCameraGroups` parses YAML and extracts camera groups correctly | Unit (YAML fixture) |
| **P1** | Extension `activate()` registers all declared intents | Integration |
| **P1** | Overlay show/hide on connect/disconnect | Integration |
| **P1** | `readCameraGroups` skips re-parse when `sessionInfoUpdate` unchanged | Unit |
| **P1** | `cameraGroupsChanged` event emitted on session change | Unit (mock shared memory) |
| **P2** | `pollSessionData` flag change detection | Unit |
| **P2** | Event caching in main process (`getLastEvent`) | Unit |
| **P2** | Shared memory open/close lifecycle on connect/disconnect | Integration |

#### 5. Mock ExtensionAPI for Tests
```typescript
function createMockDirectorAPI(): ExtensionAPI {
  return {
    settings: {},
    registerIntentHandler: vi.fn(),
    emitEvent: vi.fn(),
    log: vi.fn(),
    overlay: {
      updateOverlay: vi.fn().mockResolvedValue(undefined),
      showOverlay: vi.fn().mockResolvedValue(undefined),
      hideOverlay: vi.fn().mockResolvedValue(undefined),
    },
  };
}
```
