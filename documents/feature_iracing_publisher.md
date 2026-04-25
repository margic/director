# Feature: iRacing Publisher — Telemetry & Event Publishing

> **Status: In Progress**
> Based on RFC: *Publisher Integration into the Director App & Hybrid Telemetry* (Race Control team, 2025-07-14)
> Updated: 2026-04-23 — Added three-role deployment model, TAKE OVER / HAND OFF driver swap flow, and publisher check-in design.

---

## 1. Overview

The **iRacing Publisher** is a capability built into the existing `director-iracing` extension. When active, the extension reads the iRacing telemetry variable buffer at 5Hz, detects race events locally, and POSTs structured `RaceEvent` payloads to Race Control via REST.

This replaces the legacy Python `publisher_service.py` prototype. By folding the capability directly into the iRacing extension, the Director app becomes the single deployable unit for all rig functions.

### Minimum Production Setup: Three Machines

A Sim RaceCenter broadcast requires a minimum of three machines:

| Machine | Role | Purpose |
| :--- | :--- | :--- |
| Sim Rig A | `driver-rig` | iRacing + publisher; current driver |
| Sim Rig B | `driver-rig` | iRacing + publisher; incoming driver (standby until swap) |
| Streaming PC | `media-director` | OBS, Discord, Director Loop; never runs iRacing |

Driver swaps in endurance racing require two physically separate rigs — a driver cannot hand over to an incoming driver on the same PC. The two-rig minimum is therefore a hard operational constraint, not a preference.

### Deployment Model

The app role is configured once per machine via `app.rigRole` in settings:

| Role | Director Loop | Publisher | OBS / Discord | Check-in role |
| :--- | :--- | :--- | :--- | :--- |
| `media-director` | ✅ Active | ❌ | ✅ | `director` |
| `driver-rig` | ❌ | 🔄 TAKE OVER / HAND OFF toggle | ❌ | `publisher` (on TAKE OVER) |

> An `all-in-one` mode (all capabilities active) is available for development and testing but is not presented in the first-run UI. It is not a supported broadcast configuration.

**Key constraints:**
- Rigs are **not assumed to be on the same network**. Each machine connects independently to Race Control over the internet. There is no peer-to-peer or LAN dependency.
- The Director Agent (on the streaming PC) retrieves race events **from Race Control** — not directly from publisher rigs.
- A `driver-rig` in **standby** is connected to iRacing, watching, but not publishing. The publisher only runs when the operator explicitly presses TAKE OVER.
- Only one `driver-rig` should be ACTIVE (publishing) at a time for a given session. Race Control enforces this via check-in exclusivity.

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

### 3.1 Rig Roles and the Driver Swap Flow

The `app.rigRole` setting (one of `driver-rig` | `media-director`) determines the startup behaviour of the app. The session to join is selected from the dashboard — it is a global app-level setting, not per-extension.

#### Driver Swap Sequence

```
Lap 80 — Swap time:
  1. Operator on Rig A presses HAND OFF
       → publisher stops (iracing.publisher.setEnabled false)
       → wrap check-out call to Race Control (role: publisher)
       → state: STANDBY
  2. New driver sits in Rig B
  3. Operator on Rig B (or streaming PC operator) presses TAKE OVER
       → POST /api/director/v1/sessions/{id}/checkin (role: publisher, driver info)
       → publisher starts (iracing.publisher.setEnabled true)
       → state: ACTIVE
  4. RC sees clean publisher handoff — events now tagged with Rig B publisher code
  5. RC can automatically trigger a "Driver Intro" sequence on the Media Director
  6. Media Director rig (streaming PC) is never touched — Director Loop keeps running
```

No peer-to-peer. No LAN coordination. Race Control is the sole intermediary.

#### Driver Rig Boot Behaviour

On boot, a `driver-rig` starts in **STANDBY**: iRacing connected, session loaded from saved settings, publisher stopped. The operator must explicitly press TAKE OVER to activate publishing. This prevents accidental dual-publishing if a rig restarts mid-race.

#### Publisher Check-in Payload

When TAKE OVER is pressed, the driver rig checks into the session:

```typescript
POST /api/director/v1/sessions/{raceSessionId}/checkin
{
  "role": "publisher",
  "publisherCode": "RIG-B",          // from publisher settings
  "capabilities": ["iracing.telemetry"],
  "driver": {
    "driverId": "usr_abc123",        // from MSAL auth token (logged-in user IS the driver)
    "displayName": "Alex Reimer",    // from MSAL id_token claims
    "carNumber": "44"                // from iRacing session YAML (DriverInfo, player car)
  }
}
```

The `driverId` and `displayName` are taken directly from the MSAL authentication token — no additional user input. The `carNumber` is read from the iRacing session YAML at the moment TAKE OVER is pressed.

#### Publisher Check-out (HAND OFF)

```typescript
POST /api/director/v1/sessions/{raceSessionId}/wrap   // or DELETE /checkin
{
  "role": "publisher",
  "publisherCode": "RIG-B"
}
```

RC uses this signal to fire a "driver swap complete" lifecycle event — enabling automatic Driver Outro / Driver Intro sequences on the Media Director.

### 3.2 Extension Modes (iRacing Extension)

The `director-iracing` extension behaviour depends on both `app.rigRole` and the TAKE OVER / HAND OFF state:

| State | Behaviour |
| :--- | :--- |
| `driver-rig` STANDBY (default on boot) | iRacing connected, camera reads active, publisher stopped |
| `driver-rig` ACTIVE (after TAKE OVER) | Publisher running at 5Hz, events flowing to Race Control |
| `media-director` | Publisher never runs; camera control + Director Loop active |

### 3.3 Component Breakdown

```
src/extensions/iracing/
├── index.ts                  (existing — connection, camera, overlays)
├── telemetry-reader.ts       (NEW — reads iRacing telemetry var buffer at 5Hz)
├── event-detector.ts         (NEW — detects OVERTAKE, BATTLE_STATE, PIT_ENTRY/EXIT, etc.)
├── identity-override.ts      (NEW — maps carIdx → booked driver name from session config)
├── publisher.ts              (NEW — batches & POSTs RaceEvent[] to Race Control)
└── publisher-config.ts       (NEW — settings schema for publisher mode)
```

### 3.4 Data Flow

#### Driver Rig ACTIVE (publisher running — outbound only)

```
iRacing Shared Memory
        │
        ▼ (5Hz, telemetry var buffer — kernel32.dll, same handle as session reader)
TelemetryReader
        │  TelemetryFrame (8 key fields only — see §3.4)
        ▼
EventDetector  ◄──  SessionState (per-session in-memory cache)
        │  RaceEvent[]
        ▼
IdentityOverride  ◄──  booked driver map (from local session config set at check-in)
        │  RaceEvent[] with resolved driver names
        ▼
Publisher
        │  POST /api/telemetry/events  (batched, Bearer token from MSAL)
        ▼  [internet — no LAN required]
Race Control API  →  raceEvents Cosmos container
        ↑
        │  (no back-channel — publisher rig never receives anything)
```

#### Media/Director Rig (existing Director Loop — unchanged)

```
Race Control API  (raceEvents Cosmos container)
        │  GET /api/director/v1/sessions/{id}/next  (existing Director Loop)
        ▼
Director Agent  →  SequenceExecutor  →  OBS / Discord / iRacing camera commands
```

The two rigs never communicate with each other. Race Control is the sole intermediary.

### 3.5 Telemetry Fields Read

The 8 fields the AI pipeline actually uses (from the RFC analysis):

| iRacing Variable | Type | Purpose |
| :--- | :--- | :--- |
| `CarIdxPosition` | `int[64]` | Race position per car |
| `CarIdxOnPitRoad` | `bool[64]` | Pit road detection |
| `CarIdxTrackSurface` | `int[64]` | Track / pit / out-of-world |
| `CarIdxLastLapTime` | `float[64]` | Last lap time per car |
| `CarIdxBestLapTime` | `float[64]` | Best lap time per car |
| `CarIdxLapCompleted` | `int[64]` | Laps completed per car |
| `CarIdxClassPosition` | `int[64]` | Class position per car |
| `SessionFlags` | `bitfield` | Yellow/red/green flag state |

No other fields are transmitted. This reduces payload from ~150 fields to 8 — approximately a 95% reduction in wire data.

---

## 4. Event Types

These align with the Race Control Telemetry Gateway Spec:

| Event Type | Trigger | Priority |
| :--- | :--- | :--- |
| `OVERTAKE` | Position swap between consecutive frames, excluding pit cycles | High |
| `BATTLE_STATE` | Gap crosses threshold: `ENGAGED` (< 1.0s), `CLOSING` (< 2.0s, shrinking), `BROKEN` (> 2.0s) | High |
| `PIT_ENTRY` | `CarIdxOnPitRoad` transition false → true | Medium |
| `PIT_EXIT` | `CarIdxOnPitRoad` transition true → false | Medium |
| `INCIDENT` | Flag bitmask change + position/speed anomaly | High |
| `LAP_COMPLETE` | `CarIdxLapCompleted` increment, with lap time captured | Low |
| `POSITION_CHANGE` | `CarIdxPosition` change not caused by an overtake (e.g., pit cycle) | Medium |
| `SECTOR_COMPLETE` | Lap distance crosses sector boundary | Low |

---

## 5. Data Models

### 5.1 RaceEvent (wire format to Race Control)

```typescript
interface RaceEvent {
  id: string;                          // UUID v4
  raceSessionId: string;               // Partition key (from Director session claim)
  type: RaceEventType;                 // Enum from §4
  timestamp: number;                   // Unix ms
  lap: number;                         // Leader lap at time of event
  involvedCars: {
    carIdx: number;
    carNumber: string;
    driverName: string;                // Resolved via IdentityOverride (booked name)
    position?: number;
  }[];
  payload: Record<string, unknown>;    // Event-specific data (gap, lapTime, etc.)
  ttl: number;                         // 7776000 (90 days)
}

type RaceEventType =
  | 'OVERTAKE'
  | 'BATTLE_STATE'
  | 'PIT_ENTRY'
  | 'PIT_EXIT'
  | 'INCIDENT'
  | 'LAP_COMPLETE'
  | 'POSITION_CHANGE'
  | 'SECTOR_COMPLETE';
```

### 5.2 Per-Session State (in-memory, not persisted)

```typescript
interface SessionState {
  raceSessionId: string;
  previousFrame: TelemetryFrame | null;
  carStates: Map<number, CarState>;
  activeBattles: Map<string, BattleState>; // key: "carIdxA-carIdxB"
}

interface CarState {
  position: number;
  classPosition: number;
  onPitRoad: boolean;
  onTrack: boolean;
  lastLapTime: number;
  lapsCompleted: number;
  trackSurface: number;
}

interface BattleState {
  status: 'ENGAGED' | 'CLOSING' | 'BROKEN';
  gapSeconds: number;
  since: number; // timestamp
}
```

### 5.3 TelemetryFrame (internal — not transmitted)

```typescript
interface TelemetryFrame {
  sessionTick: number;
  sessionFlags: number;
  carIdxPosition: Int32Array;     // [64]
  carIdxOnPitRoad: Uint8Array;    // [64] (bool)
  carIdxTrackSurface: Int32Array; // [64]
  carIdxLastLapTime: Float32Array;// [64]
  carIdxBestLapTime: Float32Array;// [64]
  carIdxLapCompleted: Int32Array; // [64]
  carIdxClassPosition: Int32Array;// [64]
}
```

---

## 6. Identity Override

The iRacing game identifies drivers by `CarIdx` (0–63). Race Control knows drivers by their booked name (e.g., "Lando Prost"). The `IdentityOverride` component resolves this at the edge before any data leaves the rig.

**Source of truth:** The Director's session config, populated at check-in time via the existing `POST /api/director/v1/sessions/{raceSessionId}/checkin` flow. The check-in response includes the rig's booked driver assignment.

**Override logic:**
1. At session start, load `carIdx → bookedDriverName` map from session config.
2. For every `RaceEvent` produced by `EventDetector`, replace the iRacing driver name with the booked name in `involvedCars[].driverName`.
3. If no override is available for a `carIdx`, fall back to the iRacing driver name from session YAML.

This ensures the cloud's `raceEvents` container always contains real-world identities — no post-processing step needed in Race Control.

---

## 7. Transport

- **Endpoint:** `POST /api/telemetry/events` (new Race Control endpoint — see OpenAPI spec)
- **Auth:** `Authorization: Bearer <token>` — reuses the MSAL token already managed by the Director's auth service. No additional credentials on the rig.
- **Batching:** Events are buffered in-memory and flushed every 2 seconds or when the buffer reaches 20 events, whichever comes first.
- **Retry:** Failed POSTs are retried up to 3 times with exponential backoff (1s, 2s, 4s). Events older than 30 seconds are discarded rather than retried.
- **Offline:** If the rig loses internet connectivity, the buffer drains silently. No local persistence — the cloud state machine tolerates missing frames.

---

## 8. Configuration

New settings added to the iRacing extension settings panel under a **"Publisher"** section:

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `publisher.enabled` | `boolean` | `false` | Enable telemetry publishing |
| `publisher.pollRateHz` | `number` | `5` | Telemetry read rate (max 60Hz, iRacing cap) |
| `publisher.batchIntervalMs` | `number` | `2000` | How often to flush the event buffer |
| `publisher.maxBatchSize` | `number` | `20` | Max events per POST request |

These are stored in the iRacing extension's settings alongside existing camera and overlay settings. No separate config file.

---

## 9. Manifest Changes (`src/extensions/iracing/package.json`)

New entries added to the existing manifest:

```json
{
  "events": [
    {
      "name": "iracing.publisherStateChanged",
      "description": "Emitted when publisher connection state changes.",
      "payload": {
        "connected": "boolean",
        "eventsPublishedTotal": "number",
        "lastFlushAt": "number | null"
      }
    }
  ],
  "settings": [
    {
      "key": "publisher.enabled",
      "type": "boolean",
      "default": false,
      "label": "Enable Telemetry Publisher",
      "description": "Stream race events to Race Control when a session is active."
    }
  ]
}
```

---

## 10. UI

### 10.1 Driver Rig Home Screen

When `app.rigRole === 'driver-rig'`, the app renders a dedicated home screen instead of the full Director dashboard. This screen is focused — it shows only what the driver/operator needs and nothing else.

**STANDBY state (default on boot):**
```
┌──────────────────────────────────────┐
│  SRC DIRECTOR   RIG B            ⚙  │
├──────────────────────────────────────┤
│  iRACING    ● CONNECTED              │
│  Session    Daytona 24h • Lap 47     │
│  Driver     Alex Reimer • Car #44    │
│                                      │
│  ┌────────────────────────────────┐  │
│  │   ▶  TAKE OVER                 │  │
│  │      Activate publisher        │  │
│  └────────────────────────────────┘  │
│                                      │
│  Last active: 23 min ago             │
└──────────────────────────────────────┘
```

**ACTIVE state (after TAKE OVER):**
```
┌──────────────────────────────────────┐
│  SRC DIRECTOR   RIG B            ⚙  │
├──────────────────────────────────────┤
│  iRACING    ● CONNECTED              │
│  Session    Daytona 24h • Lap 47     │
│  Driver     Alex Reimer • Car #44    │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  🟢 PUBLISHING                 │  │
│  │  Lap 47 • Events sent: 1,247   │  │
│  └────────────────────────────────┘  │
│                                      │
│  [ HAND OFF / GO STANDBY ]           │
└──────────────────────────────────────┘
```

- TAKE OVER button: `bg-primary` (Apex Orange), large, full-width.
- HAND OFF button: `bg-destructive` (Flag Red), prominent but below the status card.
- Publisher status card: uses `--green-flag` border glow when ACTIVE.
- iRacing connection status and session/driver info auto-populated from iRacing YAML.
- Settings gear (⚙) opens publisher settings (publisherCode, raceSessionId).

### 10.2 First-Run Role Selection

On first launch (no `app.rigRole` set), the app presents a role selection screen before anything else:

```
┌────────────────────────────────────────┐
│  SIM RACECENTER DIRECTOR               │
│  What is this machine?                 │
│                                        │
│  ┌──────────────┐  ┌────────────────┐  │
│  │  🏎  DRIVER   │  │  📺 MEDIA      │  │
│  │     RIG      │  │    DIRECTOR    │  │
│  │              │  │                │  │
│  │ I drive in   │  │ I run OBS and  │  │
│  │ iRacing and  │  │ broadcast the  │  │
│  │ publish data │  │ race           │  │
│  └──────────────┘  └────────────────┘  │
└────────────────────────────────────────┘
```

Selection persists to `app.rigRole` in config. Can be changed later in app settings.

### 10.3 Extension Panel — Publisher Section

The iRacing extension detail page gains a collapsible **"TELEMETRY PUBLISHER"** section below the existing camera and overlay controls:

```
┌─────────────────────────────────────────────────────────┐
│ TELEMETRY PUBLISHER                              [toggle]│
├─────────────────────────────────────────────────────────┤
│ STATUS   ● STREAMING    Events: 1,284   Last: 0.4s ago  │
│                                                         │
│ Poll Rate   5 Hz        Batch Interval   2s             │
│                                                         │
│ RECENT EVENTS                                           │
│  OVERTAKE    Martinez → P3    Lap 14    2s ago          │
│  PIT_EXIT    Garcia            Lap 14    8s ago          │
│  BATTLE_STATE  Johnson / Kim  ENGAGED   12s ago         │
└─────────────────────────────────────────────────────────┘
```

- Status indicator uses `--green-flag` (streaming), `--yellow-flag` (connecting / retrying), `--red-flag` (error).
- Recent events list shows last 5 events — `font-jetbrains`, `text-xs`, auto-scrolling.
- All labels uppercase `font-rajdhani`.

### 10.4 Dashboard Widget (Media Director)

The existing iRacing dashboard widget on the Media Director gains a small publisher badge showing whether any rig is actively publishing:

```
┌─────────────────────────┐
│ iRACING          ● LIVE │
│ Watkins Glen  Lap 14/20 │
│ PUB ▲ 1,284 events      │
└─────────────────────────┘
```

`PUB ▲` badge is shown only when `publisher.enabled` is true and the session is active. Uses `text-secondary` (Telemetry Blue).

---

## 11. Driver Rig — No Sequence Integration

`driver-rig` machines do **not** run the Director Loop. They do not poll Race Control for sequences, do not execute intents targeting OBS or Discord, and do not receive commands of any kind from the cloud. The only outbound path is `POST /api/telemetry/events`.

The only exception is the check-in / wrap calls (`POST /api/director/v1/sessions/{id}/checkin` and the corresponding wrap call) which are triggered by operator TAKE OVER / HAND OFF actions — not by the Director Loop.

This is by design. The streaming PC (Media Director) is the command executor. Driver rigs are data sources only.

---

## 12. Out of Scope (for this feature)

The following items from the RFC are owned by the Race Control backend team and are **not** part of this Director feature:

- **Step 1 — Global Event Detector:** Cloud-side frame-comparison state machine that merges events from multiple rigs.
- **Step 2 — Race Story Distiller:** Periodic AI consolidation of events into narrative chapter summaries.
- The new `POST /api/telemetry/events` REST endpoint itself.

This feature delivers only the **Director-side implementation** of Step 3 from the RFC.

---

## 13. Open Questions

1. ~~**Poll Rate vs. Existing Loop**~~ **Resolved.** Two separate timers: connection poll at 2s, telemetry poll at 200ms (5Hz). The session YAML re-read is gated on the `sessionInfoUpdate` counter so 2s calls do not re-parse unchanged data.

2. ~~**Multi-Rig Identity**~~ **Resolved.** All rigs join the same `raceSessionId`. Each checks in with `role: publisher` + `publisherCode` identifying the physical rig. Race Control merges event streams by `raceSessionId`; the `publisherCode` disambiguates which rig emitted each event.

3. **Publisher check-in endpoint:** The existing `POST /api/director/v1/sessions/{id}/checkin` was designed for the Media Director role. The publisher check-in with `role: publisher` and `driver` payload is a proposed extension. Race Control must confirm whether this is handled by the same endpoint or a new one. See [margic/racecontrol issue tracker](https://github.com/margic/racecontrol/issues).

4. **Driver swap lifecycle events:** When a `role: publisher` wrap is received (HAND OFF), Race Control should ideally emit a lifecycle signal that the Media Director's Director Loop can consume as a trigger for automatic Driver Swap sequences. The mechanism (a special sequence type, a new event, or a conventional `raceEvent`) is an RC design decision.

5. **API Endpoint Spec:** The `POST /api/telemetry/events` endpoint is referenced in the RFC but not yet in the OpenAPI spec at `https://simracecenter.com/api/openapi.yaml`. Implementation will be blocked until this is published.

6. ~~**Publisher Mode Only Config**~~ **Resolved.** `app.rigRole = driver-rig` replaces any per-extension publisher-mode config. The role is set at app level; the iRacing extension reads `app.rigRole` to know whether to show the TAKE OVER / HAND OFF UI or the full Director panel.

---

## 14. Related Documents

- [feature_iracing_integration.md](feature_iracing_integration.md) — Existing iRacing extension architecture
- [feature_extension_system.md](feature_extension_system.md) — Extension system and contribution points
- [feature_director_loop_v2.md](feature_director_loop_v2.md) — Director Loop v2 orchestrator (orthogonal; publisher is independent)
- [feature_session_claim.md](feature_session_claim.md) — Session check-in and identity mapping
- Race Control RFC: *Publisher Integration into the Director App & Hybrid Telemetry* (2025-07-14)
- Race Control OpenAPI Spec: `https://simracecenter.com/api/openapi.yaml`
