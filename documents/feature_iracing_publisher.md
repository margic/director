# Feature: iRacing Publisher — Telemetry & Event Publishing

> **Status: Proposed**
> Based on RFC: *Publisher Integration into the Director App & Hybrid Telemetry* (Race Control team, 2025-07-14)

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
├── index.ts                  (existing — connection, camera, overlays)
├── telemetry-reader.ts       (NEW — reads iRacing telemetry var buffer at 5Hz)
├── event-detector.ts         (NEW — detects OVERTAKE, BATTLE_STATE, PIT_ENTRY/EXIT, etc.)
├── identity-override.ts      (NEW — maps carIdx → booked driver name from session config)
├── publisher.ts              (NEW — batches & POSTs RaceEvent[] to Race Control)
└── publisher-config.ts       (NEW — settings schema for publisher mode)
```

### 3.3 Data Flow

#### Driver Rig (publisher mode — outbound only)

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

### 3.4 Telemetry Fields Read

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

### 10.1 Extension Panel — Publisher Section

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

### 10.2 Dashboard Widget

The existing iRacing dashboard widget gains a small publisher badge:

```
┌─────────────────────────┐
│ iRACING          ● LIVE │
│ Watkins Glen  Lap 14/20 │
│ PUB ▲ 1,284 events      │
└─────────────────────────┘
```

`PUB ▲` badge is shown only when `publisher.enabled` is true and the session is active. Uses `text-secondary` (Telemetry Blue).

---

## 11. No Sequence Integration on Driver Rigs

Publisher rigs do **not** run the Director Loop. They do not poll Race Control for sequences, do not execute intents, and do not receive commands of any kind from the cloud. The publisher extension is outbound-only.

If a future requirement arises to remotely enable/disable publishing, this must be done by changing the extension setting locally on the rig. No back-channel will be added.

---

## 12. Out of Scope (for this feature)

The following items from the RFC are owned by the Race Control backend team and are **not** part of this Director feature:

- **Step 1 — Global Event Detector:** Cloud-side frame-comparison state machine that merges events from multiple rigs.
- **Step 2 — Race Story Distiller:** Periodic AI consolidation of events into narrative chapter summaries.
- The new `POST /api/telemetry/events` REST endpoint itself.

This feature delivers only the **Director-side implementation** of Step 3 from the RFC.

---

## 13. Open Questions

1. **Poll Rate vs. Existing Loop:** The iRacing extension's current session reader polls at 2s intervals (checking `sessionInfoUpdate` counter). The publisher needs 5Hz (200ms). Should the poll loop be unified at 200ms with session YAML re-read only when the update counter changes, or run two separate timers? A unified loop is cleaner.

2. **Multi-Rig Identity:** In special events with multiple rigs, each Director instance will have its own session config with its rig's booked driver. The cloud merges streams by `raceSessionId`. Does each rig's `raceSessionId` need to be the same shared session, or can rigs join the same session independently via check-in?

3. **API Endpoint Spec:** The `POST /api/telemetry/events` endpoint is referenced in the RFC but not yet in the OpenAPI spec at `https://simracecenter.com/api/openapi.yaml`. Implementation will be blocked until this is published. Track at [margic/racecontrol issues](https://github.com/margic/racecontrol/issues).

4. ~~**Publisher Mode Only Config:**~~ **Resolved.** Driver rigs simply leave all extensions except iRacing disabled. No special launcher mode, no new config format — the existing extension enable/disable system is sufficient.

---

## 14. Related Documents

- [feature_iracing_integration.md](feature_iracing_integration.md) — Existing iRacing extension architecture
- [feature_extension_system.md](feature_extension_system.md) — Extension system and contribution points
- [feature_director_loop_v2.md](feature_director_loop_v2.md) — Director Loop v2 orchestrator (orthogonal; publisher is independent)
- [feature_session_claim.md](feature_session_claim.md) — Session check-in and identity mapping
- Race Control RFC: *Publisher Integration into the Director App & Hybrid Telemetry* (2025-07-14)
- Race Control OpenAPI Spec: `https://simracecenter.com/api/openapi.yaml`
