# iRacing Integration

> **Status: Active Extension**
> This feature is fully implemented as an extension located at `src/extensions/iracing`.
> It runs in the Extension Host process and communicates with the iRacing Simulator via Windows Broadcast Messages.

## Architecture: Extension Extension
The iRacing integration is a standalone module running within the application's Extension Host. It does not run in the Main process directly, ensuring stability and isolation.

### Manifest (`package.json`)
Detailed capability definition:
- **ID**: `director-iracing`
- **Intents**:
    - `broadcast.showLiveCam`: Switch camera to a specific Car and Group.
    - `broadcast.replayFromTo`: Play a replay segment.
    - `broadcast.setReplaySpeed`: Control replay playback speed.
    - `broadcast.setReplayPosition`: Jump to specific frame.
    - `broadcast.setReplayState`: Set internal replay state.

### Backend Implementation (`src/extensions/iracing/index.ts`)
The extension uses the `koffi` FFI library to interface with the Windows User32 API.
- **Connection Monitoring**: Polling `FindWindowA` to detect 'iRacing.com Simulator'.
- **Command Execution**: Sending `PostMessageA` with registered window message IDs to the simulator.

### Frontend Integration (Renderer)
The UI interacts with the extension purely through the Extension API.
- **Status**: Checked via `window.electronAPI.extensions.getStatus()['director-iracing']`.
- **Commands**: Dispatched via `window.electronAPI.extensions.executeIntent('broadcast.showLiveCam', ...)`.

## User Interface
The **Control Deck** (`IracingPage.tsx`) provides:
1.  **Connection Status**: Visual indicator of simulator connectivity.
2.  **Camera Control**: Helper buttons for configured cameras and manual override inputs.
3.  **Replay Control**: Transport controls (Play, Pause, Skip) fully wired to Extension Intents.

## Legacy Migration
Previous direct IPC calls (`iracing:send-command`) have been removed. The application now uses the unified Intent system.

