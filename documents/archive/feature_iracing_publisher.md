# Feature: iRacing Publisher — Telemetry & Event Publishing

> **Status: Implemented**
> Based on RFC: *Publisher Integration into the Director App & Hybrid Telemetry* (Race Control team, 2025-07-14)
> Implementation tracked across issues #82, #83, #92, #106.

---

## 1. Overview

The **iRacing Publisher** is a new capability added to the existing `director-iracing` extension. When enabled, the extension reads the iRacing telemetry variable buffer at 5Hz, detects race events locally, and POSTs structured `RaceEvent` payloads to Race Control via REST.

This replaces the legacy Python `publisher_service.py` prototype. By folding the capability directly into the iRacing extension, the Director app becomes the single deployable unit for all rig functions.

### Deployment Model

There are two distinct rig roles:

| Role | Extensions Active | Director Loop | Network Path |
| :--- | :--- | :--- | :--- |
| **Driver Rig** | iRacing (publisher mode) only | Disabled — no sequence execution | Outbound to Race Control via internet |
| **Media/Director Rig** | iRacing, OBS, Discord, etc. | Active — polls Race Control for sequences | Outbound to Race Control via internet |

**Key constraints:**
- Driver rigs are **fire-and-forget**: they POST events to Race Control and receive nothing back. There is no back-channel, no sequence delivery, no commands from Race Control to a publisher rig.
- Rigs are **not assumed to be on the same network**. Each rig connects independently to Race Control over the internet. There is no peer-to-peer or LAN dependency.
- The Director Agent (on the media rig) retrieves race events **from Race Control** via the existing Director Loop — not directly from publisher rigs.
- iRacing session context (drivers, track, camera groups) is already available locally on each rig via the existing iRacing shared memory YAML reader. The publisher does not re-transmit session state.

---

## 2. Motivation

### 2.1 Problems with the Python Prototype

| Problem | Impact |
| :--- | :--- |
| Manual `pip install` per rig | No production upgrade path |
| Hard-coded `publisher_code` config file | No registration or discovery UI |
| Sends ~150 raw fields at 5Hz | ~25–50KB/s per rig, 95% never read by AI |
| Isolated Python codebase | No shared types with Director or Race Control |
| No monitoring | Only log files; no dashboard visibility |

### 2.2 Why Inside the iRacing Extension

The iRacing extension already opens the shared memory file (`Local\IRSDKMemMapFileName`) via `kernel32.dll` and has a polling loop. The telemetry variable buffer is in the same memory-mapped file, immediately after the variable headers. Rather than creating a separate `publisher-extension` with its own FFI setup, we add a **Publisher Mode** toggle to the existing extension — sharing the same memory handle, poll cycle, and connection lifecycle.

This is the right architectural boundary: the iRacing extension owns all iRacing shared-memory concerns. Publishing is a delivery concern layered on top of it.

---

## 3. Architectural Design

### 3.1 Extension Modes

The `director-iracing` extension gains a `publisherMode` setting in its configuration:

| Mode | Behaviour |
| :--- | :--- |
| `disabled` (default) | Current behaviour — camera control + overlays only |
| `enabled` | Adds telemetry polling at 5Hz, local event detection, and REST delivery to Race Control |

### 3.2 Component Breakdown

```
src/extensions/iracing/
├── index.ts                          (existing — connection, camera, overlays; wires publisher)
├── telemetry-frame.ts                (RawTelemetryReads → TelemetryFrame assembly & iRacing var names)
└── publisher/
    ├── index.ts                      (barrel re-export for all publisher modules)
    ├── orchestrator.ts               (PublisherOrchestrator — wires all detectors to extension lifecycle)
    ├── transport.ts                  (PublisherTransport — batch queue, POST, retry, auto-config lookup)
    ├── event-types.ts                (PublisherEvent envelope, 60+ PublisherEventType union, payload map)
    ├── session-state.ts              (TelemetryFrame, CarState, SessionState, buildEvent, carRefFromRoster)
    ├── identity-override.ts          (IdentityOverrideService — publisher.identityDisplayName → iRacing UserName)
    ├── identity-event-builder.ts     (IDENTITY_RESOLVED / IDENTITY_OVERRIDE_CHANGED event constructors)
    ├── lifecycle-event-detector.ts   (PUBLISHER_HELLO/HEARTBEAT/GOODBYE, IRACING_CONNECTED/DISCONNECTED)
    ├── session-lifecycle-detector.ts (SESSION_LOADED, SESSION_STATE_CHANGE, RACE_GREEN, RACE_CHECKERED, SESSION_ENDED)
    ├── session-type-detector.ts      (SESSION_TYPE_CHANGE)
    ├── flag-detector.ts              (FLAG_GREEN/YELLOW_*/RED/WHITE/DEBRIS, per-car flag events)
    ├── lap-completed-detector.ts     (LAP_COMPLETED)
    ├── lap-performance-detector.ts   (PERSONAL_BEST_LAP, SESSION_BEST_LAP, CLASS_BEST_LAP, LAP_TIME_DEGRADATION, STINT_MILESTONE, STINT_BEST_LAP)
    ├── overtake-battle-detector.ts   (OVERTAKE, OVERTAKE_FOR_LEAD, OVERTAKE_FOR_CLASS, POSITION_CHANGE, BATTLE_ENGAGED/CLOSING/BROKEN, LAPPED_TRAFFIC_AHEAD, BEING_LAPPED)
    ├── pit-incident-detector.ts      (PIT_ENTRY, PIT_EXIT, OFF_TRACK, BACK_ON_TRACK, STOPPED_ON_TRACK, SLOW_CAR_AHEAD)
    ├── pit-stop-detail-detector.ts   (PIT_STOP_BEGIN, PIT_STOP_END, FUEL_LEVEL_CHANGE, FUEL_LOW, OUT_LAP)
    ├── incident-stint-detector.ts    (INCIDENT_POINT, TEAM_INCIDENT_POINT, INCIDENT_LIMIT_WARNING, BIG_HIT, SPIN_DETECTED, STINT_MILESTONE)
    ├── driver-swap-roster-detector.ts(DRIVER_SWAP_INITIATED, DRIVER_SWAP_COMPLETED, ROSTER_UPDATED)
    ├── environment-detector.ts       (WEATHER_CHANGE, TRACK_TEMP_DRIFT, WIND_SHIFT, TIME_OF_DAY_PHASE)
    ├── polish-flag-detector.ts       (FLAG_BLUE_DRIVER, FLAG_BLACK_DRIVER, FLAG_MEATBALL_DRIVER, FLAG_DISQUALIFY)
    ├── player-physics-detector.ts    (player-car physics events — speed, steering, spin)
    └── __tests__/                    (one test file per detector + orchestrator + transport)
```

### 3.3 Data Flow

#### Driver Rig (publisher mode — outbound only)

```
iRacing Shared Memory
        │
        ▼ (5Hz, telemetry var buffer — kernel32.dll, same handle as session reader)
telemetry-frame.ts  (assembleTelemetryFrame — RawTelemetryReads → TelemetryFrame)
        │  TelemetryFrame (25+ fields — see §3.4)
        ▼
PublisherOrchestrator.onTelemetryFrame()
        │  runs 14 detector functions in dependency order:
        │    detectSessionLifecycle → detectFlags → detectLapCompleted
        │    detectPitAndIncidents → detectPitStopDetail → detectOvertakeAndBattle
        │    detectLapPerformance → detectSessionTypeChange → detectIncidentsAndMilestones
        │    detectDriverSwapAndRoster → detectEnvironment → detectPolishFlags
        │    detectPlayerPhysics
        │  PublisherEvent[]
        ▼
PublisherTransport.enqueue()  ◄──  HIGH_PRIORITY_EVENTS trigger immediate flush
        │
        ▼ (batch timer, default 2s, configurable)
POST /api/telemetry/events  (max 20 events, Bearer token from MSAL)
        ▼  [internet — no LAN required]
Race Control API  →  raceEvents Cosmos container
        │
        ↑  (no back-channel — publisher rig never receives anything)
```

#### Media/Director Rig (existing Director Loop — unchanged)

```
Race Control API  (raceEvents Cosmos container)
        │  GET /api/director/v1/sessions/{id}/sequences/next  (Director Loop)
        ▼
Director Agent  →  SequenceExecutor  →  OBS / Discord / iRacing camera commands
```

The two rigs never communicate with each other. Race Control is the sole intermediary.

### 3.4 Telemetry Fields Read

All fields are defined in `telemetry-frame.ts` and assembled into a `TelemetryFrame` by `assembleTelemetryFrame()`:

**Session scalars**

| iRacing Variable | Type | Purpose |
| :--- | :--- | :--- |
| `SessionTick` | `number` | Deduplication key |
| `SessionTime` | `number` | iRacing session clock in seconds |
| `SessionState` | `enum` | Racing state machine value |
| `SessionFlags` | `bitfield` | Yellow/red/green flag state |
| `SessionUniqueID` | `number` | Changes on new session/subsession |

**Per-car arrays (CarIdx 0–63)**

| iRacing Variable | Type | Purpose |
| :--- | :--- | :--- |
| `CarIdxPosition` | `Int32Array` | Race position per car |
| `CarIdxClassPosition` | `Int32Array` | Class position per car |
| `CarIdxOnPitRoad` | `Uint8Array` | Pit road detection |
| `CarIdxTrackSurface` | `Int32Array` | Track / pit stall / approaching pits / off-track |
| `CarIdxLastLapTime` | `Float32Array` | Last lap time per car |
| `CarIdxBestLapTime` | `Float32Array` | Best lap time per car |
| `CarIdxLapCompleted` | `Int32Array` | Laps completed per car |
| `CarIdxLapDistPct` | `Float32Array` | 0.0–1.0 track position (sector detection) |
| `CarIdxF2Time` | `Float32Array` | Gap to car ahead in seconds (battle detection) |
| `CarIdxSessionFlags` | `Int32Array` | Per-car flag bitmask (blue/black/meatball flags) |
| `CarIdxSpeed` | `Float32Array` | Per-car ground speed m/s |

**Player car scalars**

| iRacing Variable | Type | Purpose |
| :--- | :--- | :--- |
| `FuelLevel` | `number` | Fuel in litres |
| `FuelLevelPct` | `number` | Fuel 0.0–1.0 |
| `PlayerCarMyIncidentCount` | `number` | Player incident count |
| `PlayerCarTeamIncidentCount` | `number` | Team incident count |
| `IncidentLimit` | `number` | Session limit for warnings |

**Environmental scalars**

| iRacing Variable | Type | Purpose |
| :--- | :--- | :--- |
| `Skies` | `enum` | Sky condition |
| `TrackTemp` | `number` | Track temperature (°C) |
| `WindDir` | `number` | Wind direction (radians) |
| `WindVel` | `number` | Wind speed (m/s) |
| `AirHumidity` | `number` | Relative humidity 0.0–1.0 |
| `FogLevel` | `number` | Fog 0.0–1.0 |

**Player-car physics (single-car telemetry)**

| iRacing Variable | Type | Purpose |
| :--- | :--- | :--- |
| `Speed` | `number` | Ground speed m/s |
| `SteeringWheelAngle` | `number` | Radians, positive = left |
| `SteeringWheelPctTorque` | `number` | 0.0–1.0 |
| `SolarAltitude` | `number` | Radians from horizon |

---

## 4. Event Types

Defined in `publisher/event-types.ts`. Events are grouped into eight categories. Cloud-synthesised events are never emitted by the publisher; they are noted for documentation only.

### §1 Lifecycle & Session State

| Event Type | Trigger | Detector |
| :--- | :--- | :--- |
| `PUBLISHER_HELLO` | Extension activate with publisher.enabled | `LifecycleEventDetector` |
| `PUBLISHER_HEARTBEAT` | 30s idle (suppressed if any event was emitted within the window) | `LifecycleEventDetector` |
| `PUBLISHER_GOODBYE` | Extension deactivate / app shutdown | `LifecycleEventDetector` |
| `IRACING_CONNECTED` | iRacing shared memory becomes available | `LifecycleEventDetector` |
| `IRACING_DISCONNECTED` | iRacing shared memory lost | `LifecycleEventDetector` |
| `SESSION_LOADED` | `SessionUniqueID` changes (new subsession) | `session-lifecycle-detector` |
| `SESSION_STATE_CHANGE` | `SessionState` enum transitions | `session-lifecycle-detector` |
| `SESSION_TYPE_CHANGE` | Session type string changes in YAML | `session-type-detector` |
| `RACE_GREEN` | SessionState transitions to Racing | `session-lifecycle-detector` |
| `RACE_CHECKERED` | SessionState transitions to Checkered | `session-lifecycle-detector` |
| `SESSION_ENDED` | SessionState transitions to CoolDown/Finished | `session-lifecycle-detector` |

### §2 Race Control / Flags

| Event Type | Trigger | Detector |
| :--- | :--- | :--- |
| `FLAG_GREEN` | `SessionFlags` green bit set | `flag-detector` |
| `FLAG_YELLOW_LOCAL` | `SessionFlags` yellow bit, local caution | `flag-detector` |
| `FLAG_YELLOW_FULL_COURSE` | `SessionFlags` full-course yellow | `flag-detector` |
| `FLAG_RED` | `SessionFlags` red bit | `flag-detector` |
| `FLAG_WHITE` | `SessionFlags` white (final lap) | `flag-detector` |
| `FLAG_BLUE_DRIVER` | `CarIdxSessionFlags` blue bit for affected car | `polish-flag-detector` |
| `FLAG_BLACK_DRIVER` | `CarIdxSessionFlags` black bit | `polish-flag-detector` |
| `FLAG_MEATBALL_DRIVER` | `CarIdxSessionFlags` meatball bit | `polish-flag-detector` |
| `FLAG_DEBRIS` | `SessionFlags` debris bit | `flag-detector` |
| `FLAG_DISQUALIFY` | `CarIdxSessionFlags` disqualify bit | `polish-flag-detector` |

### §3 Lap & Sector Performance

| Event Type | Trigger | Detector |
| :--- | :--- | :--- |
| `LAP_COMPLETED` | `CarIdxLapCompleted` increment | `lap-completed-detector` |
| `PERSONAL_BEST_LAP` | Player's `CarIdxBestLapTime` improves (requires `playerCarIdx` from YAML) | `lap-performance-detector` |
| `SESSION_BEST_LAP` | Lowest `CarIdxBestLapTime` across all cars improves | `lap-performance-detector` |
| `CLASS_BEST_LAP` | Best lap within a `CarClassID` group improves | `lap-performance-detector` |
| `LAP_TIME_DEGRADATION` | Rolling avg `CarIdxLastLapTime` rises > threshold from stint best | `lap-performance-detector` |
| `STINT_MILESTONE` | 25% / 50% / 75% of estimated stint laps completed | `incident-stint-detector` |
| `STINT_BEST_LAP` | New best lap within current stint | `lap-performance-detector` |

### §4 Position & Battle

| Event Type | Trigger | Detector |
| :--- | :--- | :--- |
| `OVERTAKE` | On-track position swap, both cars off pit road | `overtake-battle-detector` |
| `OVERTAKE_FOR_LEAD` | Overtake gains P1 overall | `overtake-battle-detector` |
| `OVERTAKE_FOR_CLASS` | Overtake gains P1 in class | `overtake-battle-detector` |
| `POSITION_CHANGE` | Position change via pit cycle (not an on-track pass) | `overtake-battle-detector` |
| `BATTLE_ENGAGED` | `CarIdxF2Time` < 1.0s, sustained 2 frames | `overtake-battle-detector` |
| `BATTLE_CLOSING` | Gap < 2.0s and shrinking | `overtake-battle-detector` |
| `BATTLE_BROKEN` | Gap > 2.0s after engagement | `overtake-battle-detector` |
| `LAPPED_TRAFFIC_AHEAD` | Lap-down car detected within gap threshold | `overtake-battle-detector` |
| `BEING_LAPPED` | Player car being approached by lap-up traffic | `overtake-battle-detector` |

### §5 Pit & Strategy

| Event Type | Trigger | Detector |
| :--- | :--- | :--- |
| `PIT_ENTRY` | `CarIdxOnPitRoad` false → true | `pit-incident-detector` |
| `PIT_STOP_BEGIN` | Car comes to a stop in pit stall (`CarIdxTrackSurface` = 2) | `pit-stop-detail-detector` |
| `PIT_STOP_END` | Car leaves pit stall | `pit-stop-detail-detector` |
| `PIT_EXIT` | `CarIdxOnPitRoad` true → false | `pit-incident-detector` |
| `FUEL_LEVEL_CHANGE` | `FuelLevel` change during pit stop | `pit-stop-detail-detector` |
| `FUEL_LOW` | `FuelLevelPct` crosses low-fuel threshold | `pit-stop-detail-detector` |
| `OUT_LAP` | First lap off pit exit (post stop) | `pit-stop-detail-detector` |

### §6 Incidents & Safety

| Event Type | Trigger | Detector |
| :--- | :--- | :--- |
| `OFF_TRACK` | `CarIdxTrackSurface` transitions to off-track (-1) | `pit-incident-detector` |
| `BACK_ON_TRACK` | `CarIdxTrackSurface` returns to on-track after off-track | `pit-incident-detector` |
| `STOPPED_ON_TRACK` | Car speed near zero off pit road | `pit-incident-detector` |
| `SLOW_CAR_AHEAD` | `CarIdxSpeed` of car ahead significantly below surrounding traffic | `pit-incident-detector` |
| `INCIDENT_POINT` | `PlayerCarMyIncidentCount` increment | `incident-stint-detector` |
| `TEAM_INCIDENT_POINT` | `PlayerCarTeamIncidentCount` increment | `incident-stint-detector` |
| `INCIDENT_LIMIT_WARNING` | Incident count approaches `IncidentLimit` | `incident-stint-detector` |
| `BIG_HIT` | Large sudden speed delta detected | `incident-stint-detector` |
| `SPIN_DETECTED` | Rapid steering angle change with speed loss | `incident-stint-detector` |

### §7 Identity & Roster

| Event Type | Trigger | Detector |
| :--- | :--- | :--- |
| `IDENTITY_RESOLVED` | First resolution of player display name | `identity-event-builder` |
| `IDENTITY_OVERRIDE_CHANGED` | `publisher.identityDisplayName` setting changed mid-session | `identity-event-builder` |
| `DRIVER_SWAP_INITIATED` | Operator clicks "Initiate Driver Swap" in the UI while player car is in pits | `driver-swap-roster-detector` |
| `DRIVER_SWAP_COMPLETED` | Car exits pits after a pending swap | `driver-swap-roster-detector` |
| `ROSTER_UPDATED` | YAML driver roster changes (pit exit / new join) | `driver-swap-roster-detector` |

### §8 Environment

| Event Type | Trigger | Detector |
| :--- | :--- | :--- |
| `WEATHER_CHANGE` | `Skies` enum transitions | `environment-detector` |
| `TRACK_TEMP_DRIFT` | `TrackTemp` crosses threshold from baseline | `environment-detector` |
| `WIND_SHIFT` | `WindDir` or `WindVel` crosses change threshold | `environment-detector` |
| `TIME_OF_DAY_PHASE` | `SolarAltitude` crosses dawn/dusk boundaries | `environment-detector` |

> **Cloud-emitted only (never produced by publisher):** `FOCUS_VS_FOCUS_BATTLE`, `FOCUS_GROUP_ON_TRACK`, `FOCUS_GROUP_SPLIT`, `STINT_HANDOFF_HANDOVER`, `RIG_FAILOVER`, `STINT_BATON_PASS`, `UNDERCUT_DETECTED`, `IN_LAP_DECLARED`, `SESSION_LEADER_CHANGE`

---

## 5. Data Models

### 5.1 PublisherEvent (wire format to Race Control)

Defined in `publisher/event-types.ts`. The envelope changed from the proposed `RaceEvent` — the primary car reference is a flat `car` field (not `involvedCars[]`), and `publisherCode` identifies the sending rig.

```typescript
interface PublisherEvent<T extends PublisherEventType = PublisherEventType> {
  /** UUID v4 — idempotency key */
  id: string;
  /** Cloud-assigned session id (from check-in response or publisher.raceSessionId setting) */
  raceSessionId: string;
  /** Identifies the rig — set from publisher.publisherCode setting */
  publisherCode: string;
  /** Event type discriminator */
  type: T;
  /** Unix ms (publisher clock) */
  timestamp: number;
  /** iRacing SessionTime in seconds */
  sessionTime: number;
  /** iRacing SessionTick — used for deduplication */
  sessionTick: number;
  /** The car this event is primarily about */
  car: PublisherCarRef;
  /** Event-specific payload — typed per event via EventPayloadMap */
  payload: EventPayloadMap[T];
  /** Optional cheap context block attached to every event */
  context?: PublisherEventContext;
}

interface PublisherCarRef {
  carIdx: number;       // iRacing CarIdx (0–63)
  carNumber: string;    // iRacing CarNumberRaw
  driverName: string;   // Display name with identity override applied
  teamName?: string;
  carClassShortName?: string;
}

interface PublisherEventContext {
  leaderLap?: number;    // Leader lap at time of event
  sessionState?: number; // iRacing SessionState enum
  sessionFlags?: number; // iRacing SessionFlags bitmask snapshot
  trackTemp?: number;    // °C
}
```

### 5.2 PublisherConfigResponse (auto-discovery via GET /api/publisher-config/{publisherCode})

```typescript
interface PublisherConfigResponse {
  gatewayUrl: string;
  raceSessionId: string;
  id: string;
  driverId: string;
  displayName: string;
  nickname: string;
  iracingName: string;
  publisherCode: string;
  createdAt: string;
  updatedAt: string;
}
```

The driver only needs their `publisherCode` — the settings UI calls `fetchPublisherConfig()` (in `transport.ts`) to auto-populate `raceSessionId` and `displayName`.

### 5.3 SessionState (in-memory, not transmitted)

Defined in `publisher/session-state.ts`. A `SessionState` instance is created on the first telemetry frame and reset on `SESSION_LOADED`.

```typescript
interface SessionState {
  raceSessionId: string;
  sessionUniqueId: number;
  carStates: Map<number, CarState>;         // keyed by carIdx
  sessionBestLapTime: number;
  classBestLapTimes: Map<number, number>;   // keyed by carClassId
  activeBattles: Map<string, BattleEntry>;  // keyed by 'carIdxA-carIdxB'
  driverSwapPending: boolean;
  pendingSwapOutgoingDriverId: string;
  pendingSwapIncomingDriverId: string;
  pendingSwapIncomingDriverName: string;
  pendingSwapInitiatedSessionTime: number;
  roster: Map<number, PublisherCarRef>;
}

interface CarState {
  position: number;
  classPosition: number;
  onPitRoad: boolean;
  trackSurface: number;
  lastLapTime: number;
  bestLapTime: number;
  lapsCompleted: number;
  lapDistPct: number;
  stintBestLapTime: number;
  sessionFlags: number;
  lapEnteredPit: number;
  // ... additional pit/stint tracking fields
}
```

### 5.4 TelemetryFrame (internal — not transmitted)

Defined in `publisher/session-state.ts`. Assembled from raw koffi reads by `assembleTelemetryFrame()` in `telemetry-frame.ts`. Contains all 25+ fields listed in §3.4.

---

## 6. Identity Override

Implemented in `publisher/identity-override.ts` — `IdentityOverrideService`.

**Resolution priority:**
1. `publisher.identityDisplayName` setting (non-empty string) — manually configured display name.
2. iRacing YAML `UserName` for the player car — fallback when no override is set.

**Behaviour:**
- `resolve(iracingUserName, overrideDisplayName)` returns a discriminated union: `first_resolution`, `override_changed`, or `unchanged`. The caller (`identity-event-builder.ts`) emits `IDENTITY_RESOLVED` on first resolution and `IDENTITY_OVERRIDE_CHANGED` when the display name changes mid-session.
- `setRacecenterDriverId(driverId)` injects the Race Control driver ID once the check-in API provides it. This is currently not yet called — the check-in response does not yet include driver assignment (tracked as racecontrol#265). When that lands, this method is wired to the check-in handler.
- `reset()` clears state on `SESSION_LOADED` with a new `SessionUniqueID`.

> **Note:** The proposed approach of loading a `carIdx → bookedDriverName` map from the session check-in response has been deferred pending racecontrol#265. The current implementation uses the settings-based override instead.

---

## 7. Transport

Implemented in `publisher/transport.ts` — `PublisherTransport` and `fetchPublisherConfig`.

- **Endpoint:** `POST /api/telemetry/events` — batches `PublisherEvent[]` in a `PublisherEventBatchRequest` envelope.
- **Auth:** `Authorization: Bearer <token>` — reuses the MSAL token from the Director auth service via the `getAuthToken` callback.
- **Endpoint derivation:** The endpoint URL is derived from `app.rcApiBaseUrl` (which reads `VITE_API_BASE_URL` at build time), ensuring all parts of the Director point at the same Race Control environment without per-extension hardcoding.
- **Batch size:** Maximum 20 events per request (per OpenAPI spec `maxItems: 20`).
- **Flush interval:** Configurable via `publisher.batchIntervalMs` (default 2000ms).
- **High-priority bypass:** `OVERTAKE`, `OVERTAKE_FOR_LEAD`, `OVERTAKE_FOR_CLASS`, `BATTLE_ENGAGED`, and other events in `HIGH_PRIORITY_EVENTS` trigger an immediate flush without waiting for the next timer tick.
- **Response handling:**
  - `202 Accepted` — parse `PublisherEventBatchResponse`, log any `invalid` events. Reset backoff.
  - `400 Bad Request` — drop batch; do not re-queue (would loop forever).
  - `401 Unauthorized` — re-queue events, surface error (caller must refresh token).
  - `429 Too Many Requests` — re-queue events, apply exponential backoff.
  - `5xx / network error` — re-queue events, apply exponential backoff.
- **Backoff:** Starts at 1s, doubles on each consecutive failure, caps at 30s.
- **Reentrancy:** Concurrent `flush()` calls are dropped — only one flush in flight at a time.
- **Session rebind:** `clearQueue()` discards all queued events when the `raceSessionId` changes, preventing stale events from leaking into the new session.

**Auto-discovery:** `fetchPublisherConfig(publisherCode, getAuthToken, baseUrl)` calls `GET /api/publisher-config/{publisherCode}`. The driver only needs their `publisherCode` to auto-populate `raceSessionId` and `displayName` in the settings UI.

---

## 8. Configuration

Publisher settings are stored in the iRacing extension settings alongside existing camera and overlay settings. They are read by `PublisherOrchestrator.start()` from `director.settings`.

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `publisher.enabled` | `boolean` | `false` | Enable telemetry publishing |
| `publisher.publisherCode` | `string` | `''` | Short code identifying this rig (e.g. `rig-01`) |
| `publisher.raceSessionId` | `string` | `''` | Active Race Control session ID — auto-populated via publisher code lookup or set via `bindSession` intent |
| `publisher.identityDisplayName` | `string` | `''` | Override display name (blank = use iRacing UserName) |
| `publisher.batchIntervalMs` | `number` | `2000` | How often to flush the event buffer (ms) |

> **Removed from spec:** `publisher.pollRateHz` (telemetry poll rate is managed by the iRacing extension's unified polling loop) and `publisher.maxBatchSize` (hard-coded to 20 per the OpenAPI spec).

---

## 9. IPC Signals & Intent Handlers

The orchestrator communicates with the renderer via the extension `emitEvent` system.

### Events emitted (Main → Renderer)

| IPC Event | Payload | When |
| :--- | :--- | :--- |
| `iracing.publisherStateChanged` | `TransportStatus` (`status`, `message`, `eventsQueuedTotal`, `lastFlushAt`) | On every transport status transition |
| `iracing.publisherEventEmitted` | `{ id, type, carIdx?, timestamp }` | After each individual event is dispatched |
| `iracing.publisherOperatorState` | `{ playerOnPitRoad: boolean, driverSwapPending: boolean }` | When player pit-road state changes |

### Intent handlers (Renderer → Main)

| Intent | Handler | Description |
| :--- | :--- | :--- |
| `iracing.publisher.setEnabled` | `orchestrator.setEnabled(enabled)` | Hot-toggle publisher without restarting the extension |
| `iracing.publisher.bindSession` | `orchestrator.setRaceSessionId(id)` | Hot-update `raceSessionId` after Director session check-in; queue is cleared to prevent cross-session events |
| `iracing.publisher.initiateDriverSwap` | `orchestrator.initiateDriverSwap(out, in, name)` | Operator-initiated driver swap — emits `DRIVER_SWAP_INITIATED` immediately; `DRIVER_SWAP_COMPLETED` fires on next pit exit |

---

## 10. UI

### 10.1 PublisherSettings Component (`renderer/PublisherSettings.tsx`)

The iRacing extension Panel gains a **Publisher** tab alongside the existing Control Desk and Race View tabs. The `PublisherSettings` component is hosted there. Fields:

- **Enable toggle** — maps to `publisher.enabled`, hot-toggles via `setEnabled` intent.
- **Publisher Code** — the rig's short code (e.g. `rig-01`). A lookup button calls `GET /api/publisher-config/{publisherCode}` to auto-populate Session ID and Display Name.
- **Session ID** — maps to `publisher.raceSessionId`. Can be manually set or auto-populated via the lookup.
- **Display Name override** — maps to `publisher.identityDisplayName`.
- **Batch Interval** — maps to `publisher.batchIntervalMs`.

**Status indicators:**
- Status badge uses colour-coded icons: green (active), yellow (idle/connecting), red (error/disabled).
- Shows `eventsQueuedTotal` and `lastFlushAt` timestamp from `TransportStatus`.
- Error message surfaced from `publisherStatus.message`.

**Recent Events feed:**
- Displays last 5 events received via `iracing.publisherEventEmitted`.
- Columns: event type, car number, timestamp delta.
- Font: `font-jetbrains text-xs`, auto-FIFO scrolling.

**Driver Swap panel** (shown when `operatorState.playerOnPitRoad === true`):
- Fields: Outgoing Driver ID, Incoming Driver ID, Incoming Driver Name.
- "Initiate Swap" button fires `iracing.publisher.initiateDriverSwap` intent.
- Button is disabled while `operatorState.driverSwapPending === true`.

### 10.2 Dashboard Widget

The existing iRacing `DashboardCard` shows a publisher badge when `publisher.enabled` is true:
- Status dot using `--green-flag` / `--yellow-flag` / `--red-flag`.
- Event count from `eventsQueuedTotal`.

---

## 11. No Sequence Integration on Driver Rigs

Publisher rigs do **not** run the Director Loop. They do not poll Race Control for sequences, do not execute intents, and do not receive commands of any kind from the cloud. The publisher extension is outbound-only.

If a future requirement arises to remotely enable/disable publishing, this must be done by changing the extension setting locally on the rig. No back-channel will be added.

---

## 12. Out of Scope (Race Control back-end)

The following items from the RFC are owned by the Race Control back-end team and are not part of this Director feature:

- **Global Event Detector:** Cloud-side frame-comparison state machine that merges events from multiple rigs.
- **Race Story Distiller:** Periodic AI consolidation of events into narrative chapter summaries.
- The `POST /api/telemetry/events` REST endpoint itself.
- Cloud-synthesised events (`FOCUS_VS_FOCUS_BATTLE`, `UNDERCUT_DETECTED`, `SESSION_LEADER_CHANGE`, etc.).

---

## 13. Known Limitations / Deferred Items

| Item | Status |
| :--- | :--- |
| `PERSONAL_BEST_LAP` requires `playerCarIdx` sourced from session YAML | `playerCarIdx` wiring from YAML parse to `setSessionMetadata()` is pending — event does not fire until wired |
| `SESSION_TYPE_CHANGE` requires `sessionType` from YAML | No-op until `setSessionMetadata({ sessionType })` is called from the iRacing extension YAML parse path |
| `racecenterDriverId` in `IdentityOverrideService` | Not yet populated — blocked on racecontrol#265 (check-in response to include driver assignment) |
| `STINT_MILESTONE` requires `estimatedStintLaps` | No-op until `setSessionMetadata({ estimatedStintLaps })` is called |

---

## 14. Related Documents

- [feature_iracing_extension.md](feature_iracing_extension.md) — Existing iRacing extension architecture
- [feature_extension_system.md](feature_extension_system.md) — Extension system and contribution points
- [feature_director_loop_v2.md](feature_director_loop_v2.md) — Director Loop v2 orchestrator (orthogonal; publisher is independent)
- [feature_session_claim.md](feature_session_claim.md) — Session check-in and identity mapping
- Race Control RFC: *Publisher Integration into the Director App & Hybrid Telemetry* (2025-07-14)
- Race Control OpenAPI Spec: `https://simracecenter.com/api/openapi.yaml`
