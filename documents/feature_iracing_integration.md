# iRacing Integration Feature Specification

## Overview
This feature implements the core integration with the iRacing Simulator using the **Windows Broadcast Message** system. This allows the Director application to send commands (like camera switches) to the simulator without requiring full telemetry data access.

## Design Pattern: Module-Based Dashboard
This feature implements the "Module-Based Dashboard" pattern:
1.  **Sidebar**: Adds an iRacing icon (Helmet/Car) to the main navigation.
2.  **Preview Module**: Adds an "iRacing Status" card to the main dashboard showing connection state (Window Found/Not Found). Clicking it navigates to the Detail Page.
3.  **Detail Page**: A dedicated view (`/iracing`) displaying connection status and manual camera controls.

## Scope

### 1. Backend (Main Process)
- **Library**: Use `koffi` (modern FFI) to interface with the Windows User32 API.
- **Service**: Create `IracingService` class.
    - **Connection Detection**: Periodically poll for the iRacing window using `FindWindow`.
    - **Messaging**: Register the `IRSDK_BROADCASTMSG` string to get the message ID.
    - **Command Sending**: Use `SendNotifyMessage` (or `PostMessage`) to broadcast commands to the simulator.
- **IPC Handlers**:
    - `iracing:get-status`: Returns `{ connected: boolean }` based on window presence.
    - `iracing:send-command`: Accepts command parameters (msg, var1, var2) to send to the sim.

### 2. Frontend (Renderer)
- **Navigation**: Update `App.tsx` to handle the new view.
- **Sidebar**: Add iRacing menu item.
- **Preview Module**:
    - Display: "Simulator Running" or "Simulator Not Found".
    - Action: Click -> Navigate to `/iracing`.
- **Detail Page (`IracingPage.tsx`)**:
    - Status Indicator (Green/Red).
    - **Manual Controls**:
        - Camera Switcher: Dropdowns for Camera Group and Car Number.
        - Replay Controls: Play, Pause, Rewind, FF (if supported via broadcast).

### 3. Command Handler Integration
- Update `SwitchCameraHandler` in `src/main/handlers/switch-camera-handler.ts`.
- **Logic**:
    - Call `IracingService.broadcastMessage(IRSDK_BROADCASTMSG, IRSDK_CAM_SWITCHPOS, carNumber, groupNumber, 0)`.

## Technical Details: Windows Messaging

### Dependencies
- `koffi`: For calling native Windows APIs from Node.js.

### Implementation Logic
```typescript
// Pseudo-code for IracingService
const koffi = require('koffi');
const user32 = koffi.load('user32.dll');

// Native Functions
const RegisterWindowMessageA = user32.func('RegisterWindowMessageA', 'uint', ['str']);
const PostMessageA = user32.func('PostMessageA', 'bool', ['void *', 'uint', 'uint', 'long']); // Use PostMessage, not SendNotifyMessage
const FindWindowA = user32.func('FindWindowA', 'void *', ['str', 'str']);

const HWND_BROADCAST = 0xffff;
const msgId = RegisterWindowMessageA('IRSDK_BROADCASTMSG');

function sendCommand(msgId, var1, var2, var3) {
    // Packing logic derived from pyracing/windows_messenger.py
    // wParam = MAKELONG(msgId, var1) -> Low 16: msgId, High 16: var1
    const wParam = (msgId & 0xFFFF) | ((var1 & 0xFFFF) << 16);
    
    // lParam = var2 (unless var3 is present, then MAKELONG(var3, var2))
    // For simple camera switches, var3 is usually 0, so lParam is just var2.
    let lParam = var2;
    if (var3 && var3 !== 0) {
         lParam = (var3 & 0xFFFF) | ((var2 & 0xFFFF) << 16);
    }

    PostMessageA(HWND_BROADCAST, msgId, wParam, lParam);
}
```

### iRacing Broadcast Commands (Reference)
- **Cam Switch Pos**: `cmd = 0`
- **Cam Switch Num**: `cmd = 1` (Target by Car Number)
    - `var1`: Car Number
    - `var2`: Group Number
    - `var3`: Camera Number (optional, usually 0)
- **Replay Set Play Speed**: `cmd = 3`
- **Replay Set Play Position**: `cmd = 4`
- **Replay Search**: `cmd = 5`
- **Replay Set State**: `cmd = 6`

*Note: We will focus on `Cam Switch Num` (Command 1) as it allows targeting by Car Number directly.*

## Acceptance Criteria
1.  **Navigation**: User can navigate to the iRacing Detail page.
2.  **Detection**: App correctly identifies if the iRacing simulation window is open.
3.  **Control**: The `SWITCH_CAMERA` command from the Director Loop successfully triggers a camera switch in iRacing via Windows Broadcast Message.
