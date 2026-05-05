# Feature: iRacing Extension — Broadcast Control & Telemetry Publisher

> **Status: Implemented**
> Source of truth: [src/extensions/iracing/](../src/extensions/iracing/) (extension ID `director-iracing`, version 1.0.0).
> This document supersedes the previously separate `feature_iracing_integration.md` and `feature_iracing_publisher.md` files. It reflects the merged architecture: a single extension that owns both broadcast control (cameras, replay, overlays) and the telemetry publisher pipeline (event detection → batched POST to Race Control).
> Last updated: 2026-04-28.

---

## 1. Overview

The `director-iracing` extension is the sole bridge between the iRacing simulator and the Director app. It runs in the **Extension Host** (out-of-process from main and renderer) and exposes two distinct capabilities:

| Capability | Purpose | Active by default? |
| :--- | :--- | :--- |
| **Broadcast Control** | Camera switching, replay transport, race-info / flag overlays. | Yes — whenever iRacing is running. |
| **Telemetry Publisher** | Reads telemetry at 5 Hz, runs ~14 event detectors, POSTs `PublisherEvent` batches to Race Control. | Opt-in via `publisher.enabled` setting. |

Both capabilities share the **same shared-memory handle** and the **same poll loop**. Publishing is layered on top of the broadcast layer so that there is one FFI surface, one connection lifecycle, and one place to interpret iRacing data.

There is no separate publisher process, no Python prototype, and no `app.rigRole` mode setting. A single Director install can broadcast and publish concurrently; production setups typically dedicate distinct machines, but that is an operational choice, not enforced by the code.

### Architecture Boundary

```
┌─────────────────────────── Director App ───────────────────────────┐
│                                                                    │
│  Main Process                                                      │
│   ├─ DirectorOrchestrator ─── builds RaceContext from cached       │
│   │                            iracing.raceStateChanged events     │
│   ├─ SessionManager ────────── includes RaceContext in check-in    │
│   ├─ CloudPoller ──────────── includes RaceContext in              │
│   │                            POST /sequences/next                │
│   └─ ExtensionHostService ── owns the Extension Host lifecycle     │
│                                                                    │
│  Extension Host (utility process)                                  │
│   └─ director-iracing                                              │
│       ├─ index.ts (broadcast + telemetry frame assembly)           │
│       └─ publisher/  (orchestrator + 14 detectors + transport)     │
│                                                                    │
│  Renderer (React)                                                  │
│   ├─ DashboardCard.tsx — connection + publisher badge              │
│   ├─ Panel.tsx — control desk, race view, publisher tabs           │
│   └─ PublisherSettings.tsx — config, lookup, swap UI               │
└────────────────────────────────────────────────────────────────────┘
```

---

## 2. Manifest

Defined at [src/extensions/iracing/package.json](../src/extensions/iracing/package.json).

### 2.1 Identity & AI Context

- **`name`**: `director-iracing`
- **`version`**: `1.0.0`
- **`displayName`**: "iRacing Broadcast Controller"
- **`aiContext`**: A natural-language description handed to the Race Control AI planner so it can pick correct intents and parameters (e.g. "TV1=11, TV2=12, Chase=20, Blimp=18, PitLane=16"; "follow setReplaySpeed with a system.wait step").

### 2.2 Intents (advertised capabilities)

| Intent | Category | Required Schema | Notes |
| :--- | :--- | :--- | :--- |
| `broadcast.showLiveCam` | broadcast | `carNum` (string), `camGroup`/`camNum` (string) | Switches the iRacing director camera. |
| `broadcast.replayFromTo` | broadcast | `startFrame`, `endFrame` (number); optional `speed` | Plays a replay segment. Use only post-incident, never during live racing. |
| `broadcast.setReplaySpeed` | broadcast | `speed` (number; 0.5/1/2/…) | Always followed by `system.wait`. |
| `broadcast.setReplayPosition` | broadcast | `frame` (number) | Jumps to a replay frame. |
| `broadcast.setReplayState` | broadcast | `state` (number; 0=play, 1=pause) | Used to freeze on a key moment. |
| `iracing.publisher.setEnabled` | operational | `enabled` (boolean) | Hot-toggles the publisher without restarting the app. Restarts the telemetry poll at 5 Hz / 4 Hz accordingly. |

In addition, the extension responds to two **internal directives** (registered the same way as intents but never advertised to the AI planner — invoked by the `DirectorOrchestrator` via `executeInternalDirective`):

- `iracing.publisher.bindSession` — fired immediately after a successful session check-in. Binds the confirmed `raceSessionId` to the publisher and auto-enables it. Fix for the empty-`raceSessionId` issue (#109).
- `iracing.publisher.initiateDriverSwap` — fired by the operator UI; passes outgoing/incoming driver IDs and incoming display name. Triggers the orchestrator's swap state machine.

### 2.3 Events (emitted to other extensions, the renderer, and the main process)

| Event | Payload | When |
| :--- | :--- | :--- |
| `iracing.connectionStateChanged` | `{ connected: boolean }` | Shared-memory availability changes. |
| `iracing.cameraGroupsChanged` | `{ groups: CameraGroup[] }` | Session YAML re-parsed; camera roster changed. |
| `iracing.driversChanged` | `{ drivers: DriverEntry[] }` | Session driver roster changed. |
| `iracing.raceStateChanged` | `RaceState` (per-car positions, gaps, lap times, pit status, session flags) | Every telemetry poll (5 Hz publishing / 4 Hz idle). **Cached in main for `RaceContext`.** |
| `iracing.publisherStateChanged` | `{ status, message?, raceSessionId, publisherCode, eventsQueuedTotal, lastFlushAt }` | Publisher transport status transitions (idle/active/error/disabled). |
| `iracing.publisherOperatorState` | `{ playerOnPitRoad, driverSwapPending }` | Drives operator-facing UI for the driver-swap workflow. |
| `iracing.publisherEventEmitted` | `{ type, carIdx?, timestamp }` | One per `PublisherEvent` dispatched. Drives the recent-events feed in the panel. |

### 2.4 Overlays

| ID | Region | Template | Behaviour |
| :--- | :--- | :--- | :--- |
| `race-info` | `top-bar` | `RaceInfoBar` | Continuous race status (lap, flag, leader). |
| `flag-alert` | `center-popup` | `FlagAlert` | Auto-hides after 5000 ms. |

### 2.5 Settings

| Key | Type | Default | Purpose |
| :--- | :--- | :--- | :--- |
| `iracing.enabled` | boolean | `true` | Master extension toggle. |
| `publisher.enabled` | boolean | `false` | Run the publisher pipeline. |
| `publisher.publisherCode` | string | `""` | Per-rig identifier; tags every outbound event. |
| `publisher.raceSessionId` | string | `""` | Race Control session ID. Auto-populated by lookup or by `bindSession`. |
| `publisher.identityDisplayName` | string | `""` | Override the iRacing username on outgoing events. |
| `publisher.endpointUrl` | string | `https://simracecenter.com/api/telemetry/events` | Telemetry ingest URL. |
| `publisher.batchIntervalMs` | number | `500` | Maximum delay between flushes; high-priority events bypass the timer. |

---

## 3. Broadcast Layer (`index.ts`)

### 3.1 Native Surface (Windows-only)

`koffi` loads two system DLLs:

| DLL | Functions used | Purpose |
| :--- | :--- | :--- |
| `user32.dll` | `RegisterWindowMessageA`, `PostMessageA` | Send `IRSDK_BROADCASTMSG` commands to the simulator. |
| `kernel32.dll` | `OpenFileMappingA`, `MapViewOfFile`, `UnmapViewOfFile`, `CloseHandle` | Read the `Local\IRSDKMemMapFileName` shared-memory file. |

`koffi` and `js-yaml` are declared in the **root** `package.json` even though only this extension uses them; see `feature_extension_system.md` § 2.11 for the dependency-management discussion. On non-Windows platforms the extension activates but stays in a no-op "disconnected" state.

### 3.2 Shared-Memory Layout

```
┌─────────────────────────────────────────────┐
│ Header (12 × int32)                         │
│   [0] ver  [1] status  [2] tickRate         │
│   [3] sessionInfoUpdate  (change counter)   │
│   [4] sessionInfoLen   (YAML buffer size)   │
│   [5] sessionInfoOffset (byte offset)       │
│   [6..11] numVars, varHeaderOffset,         │
│           numBuf, bufLen, padding           │
├─────────────────────────────────────────────┤
│ Triple-buffer headers (offset 48,           │
│   16 bytes each: tickCount, bufOffset, …)   │
├─────────────────────────────────────────────┤
│ Variable headers (144 bytes each)           │
│   type, offset, count, countAsTime,         │
│   name (32 B), desc (64 B), unit (32 B)     │
├─────────────────────────────────────────────┤
│ Session Info YAML (CameraInfo, DriverInfo,  │
│   WeekendInfo, SessionInfo)                 │
├─────────────────────────────────────────────┤
│ Telemetry data buffers (triple-buffered)    │
└─────────────────────────────────────────────┘
```

### 3.3 Poll Loops

Two independent timers:

| Loop | Period | Job |
| :--- | :--- | :--- |
| **Connection** | 1000 ms | `OpenFileMappingA` probe; emit `iracing.connectionStateChanged` on transitions. |
| **Telemetry** | 200 ms when publisher enabled, 250 ms otherwise | Read the latest triple-buffered frame, derive `RaceState`, call telemetry-frame callback (publisher), emit `iracing.raceStateChanged`. |

Session YAML is **only** re-parsed when the `sessionInfoUpdate` counter changes. Variable headers are parsed once at connection time and re-parsed only if `numVars` changes. Camera groups and driver roster are diffed and only emitted when they actually change.

### 3.4 Race-State Derivation

Each telemetry frame produces a `RaceState`:

- **Per-car (`RaceCarState[]`)**: `carIdx`, `carNumber`, `driverName`, `carClass`, `position`, `classPosition`, `lapDistPct`, `gapToLeader`, `gapToCarAhead`, `onPitRoad`, `lapsCompleted`, `lastLapTime`, `bestLapTime`. Driver/car names come from the cached YAML map.
- **Session scalars**: `focusedCarIdx`, `sessionFlags`, `sessionLapsRemain`, `sessionTimeRemain`, `leaderLap`, `totalSessionLaps`, `trackName`.

This `RaceState` is what the `DirectorOrchestrator` caches and downsamples into `RaceContext` (see § 6).

### 3.5 Overlay Updates

`updateOverlay('race-info', …)` is invoked alongside each emitted `RaceState`. `updateOverlay('flag-alert', …)` is fired by detectors / connection transitions and the overlay auto-hides after 5 s.

---

## 4. Publisher Pipeline (`publisher/`)

### 4.1 Telemetry Frame

`assembleTelemetryFrame()` ([src/extensions/iracing/telemetry-frame.ts](../src/extensions/iracing/telemetry-frame.ts)) builds a strongly-typed snapshot per poll. The frame intentionally exposes **only** the fields the detectors need — the wire payload sent to Race Control is shaped event-by-event, not by streaming the frame itself.

Captured per frame:

- Session: `sessionTick`, `sessionTime`, `sessionState`, `sessionFlags`, `sessionUniqueId`.
- Per-car (length 64): `carIdxPosition`, `carIdxClassPosition`, `carIdxOnPitRoad`, `carIdxTrackSurface`, `carIdxLastLapTime`, `carIdxBestLapTime`, `carIdxLapCompleted`, `carIdxLapDistPct`, `carIdxF2Time`, `carIdxSessionFlags`, `carIdxSpeed`.
- Player car: `fuelLevel`, `fuelLevelPct`, `playerIncidentCount`, `teamIncidentCount`, `incidentLimit`.
- Player physics: `speed`, `steeringWheelAngle`, `steeringWheelPctTorque`, `solarAltitude`.
- Environment: `skies`, `trackTemp`, `windDir`, `windVel`, `relativeHumidity`, `fogLevel`.

`getTelemetryIntervalMs()` returns 200 (publishing) or 250 (idle).

### 4.2 Orchestrator

[`publisher/orchestrator.ts`](../src/extensions/iracing/publisher/orchestrator.ts) wires the pipeline:

- `start()` — instantiates `PublisherTransport`, fires `PUBLISHER_HELLO`, begins a 30 s heartbeat timer.
- `stop()` — flushes outstanding events, fires `PUBLISHER_GOODBYE`.
- `setRaceSessionId(id)` — applied by `iracing.publisher.bindSession`; tags every subsequent event.
- `setSessionMetadata(...)` — receives `playerCarIdx`, `carClassByCarIdx`, `carClassShortNames`, `sessionType`, `estimatedStintLaps`, `carNumberByCarIdx` derived from the YAML.
- `updateRoster(driverList)` — diffs against the previous snapshot and fires `ROSTER_UPDATED`.
- `initiateDriverSwap(outgoingId, incomingId, incomingName)` — sets `driverSwapPending`, stores swap metadata in `SessionState`, fires `DRIVER_SWAP_INITIATED` immediately. The pit-exit transition then fires `DRIVER_SWAP_COMPLETED`.

#### Per-Frame Detector Pipeline (in order)

1. `detectSessionLifecycle` — `SESSION_LOADED` (resets cached state), `SESSION_STATE_CHANGE`, `RACE_GREEN`, `RACE_CHECKERED`, `SESSION_ENDED`.
2. `detectFlags` — `FLAG_GREEN`, `FLAG_WHITE`, `FLAG_YELLOW_LOCAL`, `FLAG_YELLOW_FULL_COURSE`.
3. `detectLapCompleted` — `LAP_COMPLETED` for all cars.
4. `detectPitAndIncidents` — `PIT_ENTRY`, `PIT_EXIT`, `OFF_TRACK`, `BACK_ON_TRACK`, `INCIDENT_POINT`, `IDENTITY_RESOLVED`.
5. `detectPitStopDetail` — `PIT_STOP_BEGIN`, `PIT_STOP_END`, `FUEL_LOW`, `FUEL_LEVEL_CHANGE`, `OUT_LAP`.
6. `detectOvertakeAndBattle` — `OVERTAKE`, `OVERTAKE_FOR_LEAD`, `OVERTAKE_FOR_CLASS`, `POSITION_CHANGE`, `BATTLE_ENGAGED`, `BATTLE_CLOSING`, `BATTLE_BROKEN`, `LAPPED_TRAFFIC_AHEAD`, `BEING_LAPPED`.
7. `detectLapPerformance` — `PERSONAL_BEST_LAP`, `SESSION_BEST_LAP`, `CLASS_BEST_LAP`, `LAP_TIME_DEGRADATION`, `STINT_BEST_LAP`.
8. `detectSessionTypeChange` — `SESSION_TYPE_CHANGE` (when YAML sessionType available).
9. `detectIncidentsAndMilestones` — `TEAM_INCIDENT_POINT`, `INCIDENT_LIMIT_WARNING` (50/75/90 %), `STINT_MILESTONE` (25/50/75 %).
10. `detectDriverSwapAndRoster` — `DRIVER_SWAP_COMPLETED` (pit-exit while swap pending), `ROSTER_UPDATED`.
11. `detectEnvironment` — `WEATHER_CHANGE`, `TRACK_TEMP_DRIFT` (≥ 5 °C from session start), `WIND_SHIFT` (≥ 45°), `TIME_OF_DAY_PHASE`.
12. `detectPolishFlags` — per-car `FLAG_RED`, `FLAG_DEBRIS`, `FLAG_BLUE_DRIVER`, `FLAG_BLACK_DRIVER`, `FLAG_MEATBALL_DRIVER`, `FLAG_DISQUALIFY`.
13. `detectPlayerPhysics` — `SPIN_DETECTED`, `BIG_HIT`, `SLOW_CAR_AHEAD`.
14. `lifecycle-event-detector` (independent of frame timing) — `PUBLISHER_HELLO`, `PUBLISHER_HEARTBEAT` (30 s, suppressed if any other event fired in the previous second), `PUBLISHER_GOODBYE`, `IRACING_CONNECTED`, `IRACING_DISCONNECTED`.

### 4.3 Event Catalog (`event-types.ts`)

The full `PublisherEventType` union covers ~70 event types across eight groups. Reference [src/extensions/iracing/publisher/event-types.ts](../src/extensions/iracing/publisher/event-types.ts) for payload schemas; the high-level groupings are:

| Group | Examples |
| :--- | :--- |
| Lifecycle & Session | `PUBLISHER_HELLO`, `PUBLISHER_HEARTBEAT`, `PUBLISHER_GOODBYE`, `IRACING_CONNECTED`, `IRACING_DISCONNECTED`, `SESSION_LOADED`, `SESSION_STATE_CHANGE`, `SESSION_TYPE_CHANGE`, `RACE_GREEN`, `RACE_CHECKERED`, `SESSION_ENDED` |
| Flags | `FLAG_GREEN`, `FLAG_YELLOW_LOCAL`, `FLAG_YELLOW_FULL_COURSE`, `FLAG_RED`, `FLAG_WHITE`, `FLAG_BLUE_DRIVER`, `FLAG_BLACK_DRIVER`, `FLAG_MEATBALL_DRIVER`, `FLAG_DEBRIS`, `FLAG_DISQUALIFY` |
| Lap & Sector | `LAP_COMPLETED`, `PERSONAL_BEST_LAP`, `SESSION_BEST_LAP`, `CLASS_BEST_LAP`, `LAP_TIME_DEGRADATION`, `STINT_MILESTONE`, `STINT_BEST_LAP` |
| Position & Battle | `OVERTAKE`, `OVERTAKE_FOR_LEAD`, `OVERTAKE_FOR_CLASS`, `POSITION_CHANGE`, `BATTLE_ENGAGED`, `BATTLE_CLOSING`, `BATTLE_BROKEN`, `LAPPED_TRAFFIC_AHEAD`, `BEING_LAPPED` |
| Pit & Strategy | `PIT_ENTRY`, `PIT_STOP_BEGIN`, `PIT_STOP_END`, `PIT_EXIT`, `FUEL_LEVEL_CHANGE`, `FUEL_LOW`, `OUT_LAP` |
| Incidents & Safety | `OFF_TRACK`, `BACK_ON_TRACK`, `STOPPED_ON_TRACK`, `SLOW_CAR_AHEAD`, `INCIDENT_POINT`, `TEAM_INCIDENT_POINT`, `INCIDENT_LIMIT_WARNING`, `BIG_HIT`, `SPIN_DETECTED` |
| Identity & Roster | `IDENTITY_RESOLVED`, `IDENTITY_OVERRIDE_CHANGED`, `DRIVER_SWAP_INITIATED`, `DRIVER_SWAP_COMPLETED`, `ROSTER_UPDATED` |
| Environment | `WEATHER_CHANGE`, `TRACK_TEMP_DRIFT`, `WIND_SHIFT`, `TIME_OF_DAY_PHASE` |

#### High-Priority Events

The following bypass the batch timer and trigger an immediate flush:

```
OVERTAKE_FOR_LEAD, STOPPED_ON_TRACK, RACE_GREEN, RACE_CHECKERED,
FLAG_RED, FLAG_YELLOW_FULL_COURSE, INCIDENT_LIMIT_WARNING
```

### 4.4 Identity Resolution

- `identity-event-builder.ts` constructs `PublisherCarRef` objects (`carIdx`, `carNumber`, `driverName`, `teamName`) from the cached YAML roster.
- `identity-override.ts` applies the `publisher.identityDisplayName` override and any per-driver overrides delivered through swap/roster events.
- An `IDENTITY_RESOLVED` event is fired the first time the player's identity is locked in (carNumber + driver name available together). `IDENTITY_OVERRIDE_CHANGED` follows any subsequent override change.

### 4.5 Transport (`transport.ts`)

- **Endpoint**: `POST {publisher.endpointUrl}` (default `https://simracecenter.com/api/telemetry/events`).
- **Auth**: `Authorization: Bearer <token>`; the token is requested via `director.getAuthToken()` on every flush so it always reflects the current MSAL session.
- **Batching**: Up to 20 events per `PublisherEventBatchRequest`. Flushed every `publisher.batchIntervalMs` (default 500 ms) or immediately on a high-priority event.
- **Response handling**:
  - `200 OK` / `202 Accepted` — parse `PublisherEventBatchResponse`, log `accepted` / `duplicates` / `invalid` counts, drop accepted events from the queue, reset backoff.
  - `400 Bad Request` — structural failure; drop the batch and log; do not retry.
  - `401 Unauthorized` — re-queue, surface error; the next flush re-fetches the token.
  - `429 Too Many Requests` / `5xx` / network error — re-queue, exponential backoff (1 s → 30 s cap, doubling each consecutive failure).
- **Status callback**: emits `iracing.publisherStateChanged` whenever the transport transitions between `idle` / `active` / `error` / `disabled`.

### 4.6 Publisher Config Lookup

`fetchPublisherConfig(publisherCode)` issues `GET /api/publisher-config/{publisherCode}` and returns `{ raceSessionId, id, driverId, displayName, nickname, iracingName, publisherCode, createdAt, updatedAt }`. The renderer's "Lookup" button (see § 7) calls this to auto-fill `raceSessionId` and `identityDisplayName` from a single human-friendly code rather than requiring the operator to paste a session UUID.

---

## 5. Driver-Swap Workflow

The publisher implements a "soft" driver swap workflow that does **not** require switching machines, restarting the app, or making out-of-band check-in calls. It models the swap as a state transition inside the existing publisher session.

```
Operator clicks "Initiate Driver Swap" in PublisherSettings
       │  (button only enabled while playerOnPitRoad == true)
       ▼
renderer → window.electronAPI.extensions.executeIntent(
            'iracing.publisher.initiateDriverSwap',
            { outgoingDriverId, incomingDriverId, incomingDriverName })
       │
       ▼
orchestrator.initiateDriverSwap(...)
       │  - sets SessionState.driverSwapPending = true
       │  - records pendingSwapInitiatedSessionTime, stintNumber
       │  - emits DRIVER_SWAP_INITIATED + iracing.publisherOperatorState
       ▼
… time passes; player remains in pit box …
       │
       ▼
Next telemetry frame where carIdxOnPitRoad transitions true → false
       │
       ▼
detectDriverSwapAndRoster() → emits DRIVER_SWAP_COMPLETED
       │  (orchestrator clears driverSwapPending)
       ▼
Race Control receives the lifecycle pair; the Media Director's Director
Loop can use them as triggers for Driver Outro / Driver Intro sequences.
```

There is no separate "publisher check-in" REST call. The driver swap is entirely encoded within the `PublisherEvent` stream.

---

## 6. Race Context — How Extension State Flows Back to Race Control

This is the most recently changed area of the integration. Two distinct streams now carry iRacing context to Race Control.

### 6.1 High-Frequency Event Stream

The publisher transport described in § 4.5 sends `PublisherEvent` batches to `POST /api/telemetry/events`. Each event carries:

- `id` (UUID v4 idempotency key), `raceSessionId`, `publisherCode`.
- `type`, `sessionTime`, `sessionTick` (extracted from the frame).
- A type-specific `payload`.
- Optionally a `context` block (leaderLap, sessionState, sessionFlags, trackTemp) for detectors that need it.

This is the **primary** narrative channel; the AI planner reads from it to understand what is happening on track.

### 6.2 RaceContext on Director Loop Polls

In addition to events, the **Director main process** assembles a `RaceContext` snapshot and includes it in two places:

1. **Session check-in** — `SessionManager` includes `raceContext` in the `POST /api/director/v1/sessions/{raceSessionId}/check-in` body when a getter is registered ([src/main/session-manager.ts](../src/main/session-manager.ts) lines ~350-360).
2. **Director Loop polls** — `CloudPoller` calls `getRaceContext()` and includes it in the `POST /api/director/v1/sessions/{raceSessionId}/sequences/next` body on every poll ([src/main/cloud-poller.ts](../src/main/cloud-poller.ts) lines ~269-290).

The wiring is performed in `main.ts`:

```ts
sessionManager.setRaceContextGetter(() => directorOrchestrator.getRaceContext());
// ...
new CloudPoller({ getRaceContext: () => this.buildRaceContext(), ... })
```

`DirectorOrchestrator.buildRaceContext()` ([src/main/director-orchestrator.ts](../src/main/director-orchestrator.ts) lines ~165-260) is the single source. It:

1. Reads the **last cached `iracing.raceStateChanged` payload** (subscribed via `eventBus.on('iracing.raceStateChanged', …)`).
2. Decodes the iRacing `SessionFlags` bitmask to a Race Control flag string (`green` / `caution` / `red`).
3. Infers `sessionType` (`Race` if `totalSessionLaps > 0`, else `Practice`).
4. Normalizes "unlimited" sentinels (32767) to `-1`.
5. Slices to the **top 20 cars** to keep payloads bounded.
6. Computes `pitting` (cars on pit road) and `battles` (consecutive pairs gapped < 1.0 s).
7. Asks `RaceAnalyzer` for `recentEvents` (synthesized narrative since the previous build) and `stintLaps` for the focused car.

Resulting shape:

```ts
interface RaceContext {
  sessionType: string;          // "Race" | "Practice" | …
  sessionFlags: string;         // "green" | "caution" | "red" | "disconnected"
  lapsRemain: number;           // -1 if unlimited
  carCount: number;
  contextTimestamp: string;     // ISO
  timeRemainSec?: number;
  leaderLap?: number;
  totalLaps?: number;
  trackName?: string;
  focusedCarNumber?: string;
  pitting?: string[];           // car numbers
  battles?: { cars: [string, string]; gapSec: number }[];
  drivers?: Array<{
    carNumber: string;
    pos?: number;
    classPosition?: number;
    driverName?: string;
    carClass?: string;
    gapToAhead: number;
    lapsCompleted: number;
    bestLap: number;
    lastLap?: number;
    isOnTrack?: boolean;
  }>;
  recentEvents?: RaceEvent[];   // from RaceAnalyzer
  stintLaps?: number;           // for focused car
}
```

If iRacing has never connected, a degenerate `{ sessionType: 'Race', sessionFlags: 'disconnected', lapsRemain: -1, carCount: 0, contextTimestamp }` is returned so requests are never blocked on simulator availability.

### 6.3 Why Two Channels?

| Channel | Cadence | Use case |
| :--- | :--- | :--- |
| Publisher events | ≥ 5 Hz, immediate for high-priority types | Narrative truth; the cloud reconstructs the race story from these. |
| `RaceContext` on poll/check-in | 1× per poll cycle (often a few seconds) | Lets RC's planner know the *current* situation without replaying every event since check-in. Keeps planning decisions grounded even if a publisher rig is offline. |

The two are **independent**: a Director instance with the publisher disabled still sends `RaceContext` snapshots (built from `iracing.raceStateChanged`) on every sequence-next poll.

### 6.4 Check-in & Heartbeat

`SessionCheckinResponse` includes `checkinId` and `checkinTtlSeconds`. `DirectorOrchestrator` forwards these to `CloudPoller.updateCheckin(checkinId, ttl)`, which:

- Sends `X-Checkin-Id: <checkinId>` on every `POST /sequences/next` request.
- Enforces a minimum poll frequency of `ttl / 4` to keep the session alive.
- Calls `clearCheckin()` when the session ends.

See [src/main/checkin-acceptance.test.ts](../src/main/checkin-acceptance.test.ts) for the acceptance scenarios.

---

## 7. Renderer

### 7.1 `DashboardCard.tsx`

Shows on the home dashboard. Sources state from cached extension events:

- Connection dot — `iracing.connectionStateChanged` → green "CONNECTED" or red "NOT FOUND".
- Publisher badge — appears when `publisher.enabled && status === 'active'`; displays cumulative event count using `font-jetbrains` for the number.
- "OPEN CONTROLS" button navigates to `Panel.tsx`.

### 7.2 `Panel.tsx`

Three top-level views switched via tabs:

| View | Purpose |
| :--- | :--- |
| `control-desk` (default) | Driver search, camera category filter (On-Car / Broadcast / Special), camera buttons populated from `iracing.cameraGroupsChanged`, target car-number input, manual-override numeric input, replay transport (play / pause / skip / speed). Each click executes the matching `broadcast.*` intent. |
| `race-view` | Live race-position list using cached `iracing.raceStateChanged` data. |
| `publisher` | Embeds `PublisherSettings`. |

The panel restores state from `getLastEvent(...)` on mount so reopening it after navigating away does not lose context.

### 7.3 `PublisherSettings.tsx`

- **Lookup**: text input + "Lookup" button calls `window.electronAPI.publisher.lookupConfig(publisherCode)` and auto-fills `raceSessionId` and `identityDisplayName` from the response.
- **Manual fields**: `publisherCode`, `raceSessionId`, `identityDisplayName`, `batchIntervalMs`.
- **Enable toggle** — calls `iracing.publisher.setEnabled` (hot-toggle; no restart).
- **Status indicator** — colored badge driven by `iracing.publisherStateChanged` (`active` → "Streaming", `idle`, `error`, `disabled`).
- **Recent events feed** — last 5 entries from `iracing.publisherEventEmitted` (`type` / `carIdx` / timestamp).
- **Driver swap** — surfaces `playerOnPitRoad` and `driverSwapPending` from `iracing.publisherOperatorState`. The "Initiate Driver Swap" form (outgoing driver ID, incoming driver ID, incoming display name) executes `iracing.publisher.initiateDriverSwap`. The button is disabled unless `playerOnPitRoad` is true.

### 7.4 `RaceViewMockup.tsx`

A grid-style visualization of the cached `RaceState` (positions, gaps, pit status, focused-driver highlight). Used inside the `race-view` tab.

---

## 8. Tests

### 8.1 Top-level (`src/extensions/iracing/__tests__/`)

| File | Coverage |
| :--- | :--- |
| `telemetry-frame.test.ts` | `assembleTelemetryFrame` field extraction; `getTelemetryIntervalMs` mode switch. |
| `camera-utils.test.ts` | `resolveCameraGroup` lookup logic. |

### 8.2 Publisher (`src/extensions/iracing/publisher/__tests__/`)

Each detector has a corresponding test file:

- `orchestrator.test.ts` — pipeline order, lifecycle, swap initiation, roster diffing.
- `transport.test.ts` — batch ceiling, high-priority flushes, response handling for 200/400/401/429/5xx, exponential backoff cap.
- `session-state.test.ts` — `SessionState` mutations, `BattleState` keys, `buildEvent` UUID/idempotency.
- `session-lifecycle-detector.test.ts`, `flag-detector.test.ts`, `lap-completed-detector.test.ts`, `lap-performance-detector.test.ts`, `overtake-battle-detector.test.ts`, `pit-incident-detector.test.ts`, `pit-stop-detail-detector.test.ts`, `incident-stint-detector.test.ts`, `driver-swap-roster-detector.test.ts`, `environment-detector.test.ts`, `polish-flag-detector.test.ts`, `player-physics-detector.test.ts`, `lifecycle-event-detector.test.ts` — one detector each.
- `identity-override.test.ts`, `identity-event-builder.test.ts` — identity resolution.
- `frame-fixtures.ts` / `frame-fixtures.test.ts` — shared mock-frame builders used by the detector tests.

The native FFI surface is mocked at the module boundary; tests run on Linux CI without iRacing or Windows.

---

## 9. Known Constraints & Gotchas

- **Windows-only at runtime.** On other platforms the extension activates but stays "disconnected"; tests still run cross-platform thanks to mocked FFI.
- **`iracing.publisher.bindSession`** must fire after check-in or the publisher will tag events with an empty `raceSessionId` (issue #109).
- **`raceContext` requires `iracing.raceStateChanged`.** If the extension never connects to iRacing, `RaceContext` falls back to `sessionFlags: "disconnected"`. Down-stream planners must tolerate this.
- **Publisher and Director Loop are independent.** Disabling the publisher does not stop the loop, and vice-versa. Both rely on `iracing.raceStateChanged`, but they consume it differently.
- **Driver swap is event-encoded, not a separate REST call.** There is no `POST /checkin {role: publisher}`. Race Control reconstructs swaps from the `DRIVER_SWAP_INITIATED` / `DRIVER_SWAP_COMPLETED` event pair.
- **Top-20 cap on `RaceContext.drivers`.** Larger fields may be added but the per-driver list is capped to keep the polling payload reasonable.

---

## 10. Related Documents

- [feature_extension_system.md](feature_extension_system.md) — Extension host, manifest contract, contribution points.
- [feature_director_loop_v2.md](feature_director_loop_v2.md) — Director Loop / `CloudPoller` consumer of `RaceContext`.
- [feature_session_claim.md](feature_session_claim.md) — Session check-in flow that includes `RaceContext`.
- [feature_overlay_system.md](feature_overlay_system.md) — Overlay rendering for `race-info` and `flag-alert`.
- Race Control OpenAPI spec: `https://simracecenter.com/api/openapi.yaml`.
