# iRacing Extension

> STATUS: IMPLEMENTED. Source of truth: `src/extensions/iracing/index.ts`,
> `src/extensions/iracing/package.json`,
> `src/extensions/iracing/telemetry-frame.ts`,
> `src/extensions/iracing/camera-utils.ts`.
>
> The publisher subsystem inside this extension is documented separately
> in `feature_iracing_publisher.md`.

The iRacing extension is the **only** extension that interacts with a
binary protocol (Win32 shared memory + window messages). Everything
else uses HTTP/WebSocket. As a result, this document spends most of
its space on the FFI boundary.

## Manifest summary

`name: "director-iracing"`. Contributes:

| Kind | Items |
|---|---|
| **Broadcast intents** | `broadcast.showLiveCam`, `broadcast.replayFromTo`, `broadcast.setReplaySpeed`, `broadcast.setReplayPosition`, `broadcast.setReplayState` |
| **Operational intents** (excluded from capability set) | `iracing.publisher.setEnabled`, `iracing.publisher.registerDriver`, `iracing.publisher.setSessionEnabled`, `iracing.publisher.setDriverEnabled` |
| **Internal directives** (registered at runtime, not in manifest) | `iracing.publisher.bindSession`, `iracing.publisher.releaseSession`, `iracing.publisher.initiateDriverSwap` |
| **Events** | `iracing.connectionStateChanged`, `iracing.driversChanged`, `iracing.cameraGroupsChanged`, `iracing.raceStateChanged`, `iracing.publisherStateChanged`, `iracing.publisherEventEmitted` |
| **Overlays** | `race-info` (top-bar), `flag-alert` (center-popup, autoHide 5 s) |
| **Settings** | `iracing.enabled`, `publisher.enabled`, `publisher.publisherCode`, `publisher.raceSessionId`, `publisher.identityDisplayName`, `publisher.endpointUrl`, `publisher.batchIntervalMs` |

The full JSON Schemas for intent payloads and event payloads are in
`package.json`.

## Native FFI (Windows only)

The extension uses **koffi** (a libffi binding for Node.js) to access
two Win32 APIs:

- `kernel32!OpenFileMappingA` — to map the iRacing shared-memory region.
- `user32!RegisterWindowMessageA` + `SendMessageTimeoutA` /
  `BroadcastSystemMessageA` — to send the iRacing
  `IRSDK_BROADCASTMSG` (cameras, replay).

On non-Windows the extension activates but disables polling. All
intent handlers no-op gracefully.

### Shared-memory layout

Constants (all in `index.ts`):

```
IRSDK_MEMMAPFILENAME   = 'Local\\IRSDKMemMapFileName'
IRSDK_BROADCASTMSG_NAME = 'IRSDK_BROADCASTMSG'

VAR_HEADER_SIZE = 144 bytes per variable header

Variable types (IRSDK_VarType enum):
  IRSDK_BOOL     = 1   (1 byte)
  IRSDK_INT      = 2   (4 bytes)
  IRSDK_BITFIELD = 3   (4 bytes)
  IRSDK_FLOAT    = 4   (4 bytes)
  IRSDK_DOUBLE   = 5   (8 bytes)
```

The header layout (read in `readFullHeader()`):

| Offset | Field | Notes |
|---|---|---|
| 0  | `ver` (int32) | iRacing SDK version |
| 4  | `status` (int32) | 1 if iRacing is connected/active |
| 8  | `tickRate` (int32) | Hz, typically 60 |
| 12 | `sessionInfoUpdate` (int32) | Increments when SessionInfo YAML changes |
| 16 | `sessionInfoLen` (int32) | Bytes |
| 20 | `sessionInfoOffset` (int32) | YAML buffer base |
| 24 | `numVars` (int32) | Variable header count |
| 28 | `varHeaderOffset` (int32) | Base of the variable header table |
| 32 | `numBuf` (int32) | Number of telemetry buffers (typically 4, double-buffered) |
| 36 | `bufLen` (int32) | Bytes per buffer |
| 48 | `varBufHeader[0..3]` | Per-buffer `{ tickCount, bufOffset }` |

Each variable header (144 bytes) contains:

```
+0   int32  type    (IRSDK_VarType)
+4   int32  offset  (within the active variable buffer)
+8   int32  count   (array length)
+12  int32  countAsTime (bool)
+16  char[32] name
+48  char[64] description
+112 char[32] unit
```

The latest tick is found by scanning the four `varBufHeader` entries
and selecting the one with the largest `tickCount`.

### Variables read each poll

`telemetry-frame.ts` enumerates the variable names accessed (this is
the canonical list — keep in sync if you regenerate):

```
SessionTime, SessionTick, SessionState, SessionFlags, SessionTimeRemain,
SessionLapsRemain, CamCarIdx, CamCameraNumber, CamGroupNumber,
CarIdxLap, CarIdxLapCompleted, CarIdxLapDistPct, CarIdxClassPosition,
CarIdxPosition, CarIdxF2Time, CarIdxOnPitRoad, CarIdxBestLapTime,
CarIdxLastLapTime, CarIdxEstTime, CarIdxGear, CarIdxRPM, CarIdxSteer,
CarIdxTrackSurface, CarIdxSessionFlags, FuelLevel, FuelUsePerHour,
TrackTemp, AirTemp, AirPressure, WindVel, WindDir, IsReplayPlaying,
ReplayFrameNum, ReplaySessionTime
```

(See `assembleTelemetryFrame` for the assembled `TelemetryFrame` shape.)

### SessionInfo YAML

`sessionInfoOffset .. sessionInfoOffset+sessionInfoLen` contains a
UTF-8 YAML document. The extension parses it with `js-yaml` to extract:

- `CameraInfo.Groups` → `{ groupNum, groupName }[]`. Scenic groups are
  detected via `camera-utils.ts:isScenicGroup`.
- `DriverInfo.Drivers[]` → `{ carIdx, carNumber, userName, teamName,
  carName, carClassName }`.
- `WeekendInfo.TrackName`.
- `SessionInfo.Sessions[]` → `{ sessionNum, sessionType }`.

Re-parsed only when `sessionInfoUpdate` increments.

### Broadcast messages

`IRSDK_BROADCASTMSG` is a Windows message id obtained at startup via
`RegisterWindowMessageA('IRSDK_BROADCASTMSG')`. The extension sends it
via `BroadcastSystemMessageA(BSF_IGNORECURRENTTASK | BSF_POSTMESSAGE,
&recipients=BSM_APPLICATIONS, msgId, wParam, lParam)`.

`wParam` packs `(messageId | (var1 << 16))`, `lParam` packs
`(var2 | (var3 << 16))`. Message ids used by Director:

```
IRSDK_CAM_SWITCHPOS    = 0   // wParam: car position; var1: camGroup
IRSDK_CAM_SWITCHNUM    = 1   // wParam: car number;   var1: camGroup
IRSDK_REPLAY_SETSPEED  = 3   // wParam: speed (-16..16); var1=slowMotion (1<<31 for divisor); var2=0
IRSDK_REPLAY_SETPOS    = 4   // wParam: search mode; lParam = absolute frame
IRSDK_REPLAY_SEARCH    = 5   // wParam: rpySrchMode; lParam: 0
IRSDK_REPLAY_SETSTATE  = 6   // wParam: 0=play, 1=pause
```

`broadcast.showLiveCam` resolves `camGroup` via
`camera-utils.resolveCameraGroup`, which prefers exact name match
(case-insensitive) then numeric id then well-known synonyms (TV1, TV2,
Chase, Blimp, PitLane).

## Polling loop

`startPolling(api)` (`index.ts:~700`) opens the shared-memory map and
schedules `pollOnce()` on `setInterval`:

- **Idle interval**: 250 ms (4 Hz) when neither publisher pipeline is
  active.
- **Active interval**: 200 ms (5 Hz) when the session publisher is
  bound to a `raceSessionId`.

`getTelemetryIntervalMs()` (`telemetry-frame.ts`) returns the current
target interval based on `publisherOrchestrator.isSessionPublisherActive()`.
Whenever the publisher state changes, the polling loop is restarted so
the interval refreshes.

Each poll:

1. Read the latest `varBufHeader` and snapshot the active buffer.
2. Build a `TelemetryFrame` and pass it to:
   - `publisherOrchestrator.onTelemetryFrame(frame)` (publisher pipelines).
   - `assembleRaceState(frame, sessionInfo)` for the renderer.
3. Emit `iracing.raceStateChanged` with the assembled state.
4. If `sessionInfoUpdate` incremented since last tick, re-parse the
   YAML and emit `iracing.cameraGroupsChanged` and
   `iracing.driversChanged`.
5. If the connection bit toggled, emit
   `iracing.connectionStateChanged`.

The extension does **not** rate-limit `iracing.raceStateChanged` —
it fires every poll. Subscribers (RaceAnalyzer, the renderer dashboard)
are responsible for throttling if they need to.

## Internal directives wired by the orchestrator

| Directive | Sender | Effect |
|---|---|---|
| `iracing.publisher.bindSession` | `DirectorOrchestrator` after check-in (with `raceSessionId`) | `publisherOrchestrator.bindSession(id)` — starts the session publisher pipeline. Polling restarted at 5 Hz. |
| `iracing.publisher.releaseSession` | `SessionManager` on wrap / 410 | `publisherOrchestrator.releaseSession()` — stops the session publisher. Polling drops to 4 Hz. |
| `iracing.publisher.initiateDriverSwap` | UI (publisher panel) | `publisherOrchestrator.initiateDriverSwap(outgoing, incoming, displayName)`. |

These do **not** appear in `DirectorCapabilities.intents` — the cloud
Planner cannot select them.

## Renderer surface

The iRacing renderer (`src/renderer/extensions/iracing/`) consumes:

- `iracing.connectionStateChanged` — to render the status pill.
- `iracing.cameraGroupsChanged` — to populate the camera dropdown.
- `iracing.driversChanged` — to populate the driver list.
- `iracing.raceStateChanged` — to drive the live telemetry panel.
- `iracing.publisherStateChanged` + `iracing.publisherEventEmitted`
  — to drive the publisher panel.

It calls back via `extensions.executeIntent(...)` for the publisher
control intents (`setSessionEnabled`, `setDriverEnabled`,
`registerDriver`).

## What this extension does NOT do

- It does not fetch from the Race Control HTTP API directly. The
  publisher transport does, but only to the telemetry ingest endpoint
  — see `feature_iracing_publisher.md`.
- It does not parse iRacing's UDP packets or take screenshots.
- It does not control OBS — that's the OBS extension. (Director Loop
  sequences typically pair `obs.switchScene` with `broadcast.showLiveCam`.)
- It does not run on macOS or Linux. The activate function checks
  `process.platform === 'win32'` and short-circuits.
