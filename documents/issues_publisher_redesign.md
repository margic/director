# Issue Drafts — Publisher Redesign

> Context: Rearchitecting the iRacing publisher into two independent pipelines — a **Session Publisher** (auto-starts on Director check-in, observes the whole field) and a **Driver Publisher** (opt-in, observes only the player car on this rig). The `publisherCode` concept is removed; `rigId` is auto-generated. Deduplication of session events across multiple rigs is deferred to a later milestone.
>
> **Shared transport principle:** Both pipelines use a single `PublisherTransport` instance as the only code path to Race Control. Neither orchestrator sends HTTP requests directly. Both call `transport.enqueue(event)`. The transport owns batching, retry, backoff, auth-token refresh, and the POST to `/api/telemetry/events`. This is a hard architectural constraint — do not introduce a second transport instance.
>
> Related design discussions: `documents/feature_iracing_extension.md`, `documents/feature_iracing_publisher.md`

---

## Shared Conventions (apply to all issues below)

These rules cut across the dual-pipeline design. Implementers of any issue must respect them.

### S1 — Lifecycle event ownership

`PUBLISHER_HELLO`, `PUBLISHER_HEARTBEAT`, `PUBLISHER_GOODBYE`, `IRACING_CONNECTED`, `IRACING_DISCONNECTED` describe the **extension** and the **shared iRacing connection**, not a per-pipeline concern. They are emitted by the **top-level orchestrator** (the same component that owns `PublisherTransport`), regardless of which sub-pipelines are active. They appear in DIR-1's pipeline assignment table under "Top-level", not under Driver.

### S2 — Authorization model after `publisherCode` removal

Race Control authorizes `POST /api/telemetry/events` per envelope as follows:

| Envelope `raceSessionId` source | Authorization rule |
| :--- | :--- |
| Bound via Director check-in (Session Publisher, and Driver Publisher on a media rig) | The Bearer-token user must hold the active check-in for that `raceSessionId`. |
| Bound via `POST /api/publisher/sessions/{id}/register` (Driver Publisher on a driver-only rig) | The Bearer-token user must have an active registration for `(rigId, raceSessionId)`. |

`rigId` is **optional** on the envelope (debugging annotation only). Authorization is keyed on the Bearer-token identity plus the `raceSessionId`, not on `rigId`. This is what allows session-only events from a media rig (no per-car rig identifier) to be accepted. RC-1 and RC-2 must both encode this rule.

### S3 — Config migration on upgrade

When a Director instance starts on a config that contains the legacy keys, the migration is:

| Legacy key | Action |
| :--- | :--- |
| `publisher.enabled` | Dropped silently. |
| `publisher.publisherCode` | Dropped silently. |
| `publisher.raceSessionId` | Dropped silently. |
| `publisher.identityDisplayName` | Copied to `publisher.driver.displayName` if the new key is unset, then dropped. |

`publisher.rigId` is generated on first launch if absent. Migration runs once at startup; legacy keys are removed from the persisted config file after migration.

### S4 — Telemetry poll-rate rule

The iRacing telemetry loop runs at **200 ms** when *either* the Session Publisher or the Driver Publisher is active, and **250 ms** otherwise. The top-level orchestrator owns this rule; sub-orchestrators report their active state up.

### S5 — Shared roster

Both pipelines need the driver/car roster (Session Publisher: to enrich `PublisherCarRef` in overtake/battle/lapped events; Driver Publisher: for player-car identity). The top-level orchestrator owns roster ingestion (from session YAML) and pushes updates to both sub-orchestrators. There is one roster cache, not two.

### S6 — New behaviours require new tests

The acceptance criteria below explicitly call for tests covering: auto-start on `bindSession`, the register HTTP flow (success + 404/409/401), single-transport invariant (no second transport instance constructed), session-change state reset, and pipeline-independent activation. "Existing tests migrate" is not sufficient.

---

## Director Issues

---

### DIR-1 — Split publisher into Session Publisher and Driver Publisher pipelines

**Repository:** margic/director  
**Labels:** enhancement, publisher, iracing  
**Branch:** f-raceevents

#### Problem

The current `publisher.enabled` toggle activates a single monolithic pipeline that conflates two conceptually different streams:

1. **Session-level events** — observable from any rig watching the same race: flags, overtakes, battles, laps, roster, environment. These are stateless facts about the field.
2. **Driver-level events** — authoritative only from the player's own rig: fuel, incidents, pit-stop detail, personal bests, stint data, driver swap. These require being physically on the car's machine.

Bundling them makes `publisherCode` load-bearing (it is the only signal identifying which car's data a driver-rig event belongs to) and makes it impossible to run session publishing on a media rig without also claiming driver ownership of a car.

#### Proposed Change

Split `publisher/` into two sub-orchestrators behind a thin routing layer:

```
publisher/
├── orchestrator.ts                ← top-level: owns transport, roster, lifecycle events, poll-rate gating
├── transport.ts                   ← shared (one PublisherTransport instance)
├── event-types.ts                 ← shared
├── session-state.ts               ← shared cache (split into session-scoped vs driver-scoped sections)
├── index.ts                       ← barrel re-export
├── shared/
│   └── lifecycle-event-detector.ts  ← emits PUBLISHER_HELLO/HEARTBEAT/GOODBYE, IRACING_CONNECTED/DISCONNECTED
├── session-publisher/
│   ├── orchestrator.ts            ← SessionPublisherOrchestrator
│   ├── session-lifecycle-detector.ts
│   ├── session-type-detector.ts
│   ├── flag-detector.ts
│   ├── polish-flag-detector.ts
│   ├── lap-completed-detector.ts
│   ├── overtake-battle-detector.ts
│   ├── lap-performance-session.ts   (SESSION_BEST_LAP, CLASS_BEST_LAP only)
│   ├── roster-detector.ts           (ROSTER_UPDATED only)
│   └── environment-detector.ts
├── driver-publisher/
│   ├── orchestrator.ts            ← DriverPublisherOrchestrator
│   ├── identity-override.ts
│   ├── identity-event-builder.ts
│   ├── pit-incident-detector.ts
│   ├── pit-stop-detail-detector.ts
│   ├── incident-stint-detector.ts
│   ├── lap-performance-driver.ts    (PERSONAL_BEST_LAP, LAP_TIME_DEGRADATION, STINT_BEST_LAP)
│   ├── player-physics-detector.ts
│   └── driver-swap-detector.ts
└── __tests__/                       ← mirror layout above
```

#### Router contract

The top-level orchestrator routes each frame to the active sub-orchestrators only. If only the Session Publisher is active, the Driver Publisher is not constructed and receives no frames. Both sub-orchestrators are constructed lazily on first activation and torn down on deactivation. The router does not gate per-frame; it gates at activation.

#### Shared transport — architectural constraint

The top-level `orchestrator.ts` owns the single `PublisherTransport` instance. It passes a reference to both sub-orchestrators at construction time. Neither sub-orchestrator creates its own transport or sends HTTP requests. The emission path is always:

```
SessionPublisherOrchestrator.onFrame(frame)
  └─► transport.enqueue(event)   ─┐
                                   ├─► PublisherTransport (one instance)
 DriverPublisherOrchestrator.onFrame(frame)   │        │
  └─► transport.enqueue(event)   ─┘        batches, retries, POSTs
                                                       │
                                         POST /api/telemetry/events
```

`PublisherTransport` is the only place that knows about HTTP, auth tokens, backoff, or the Race Control endpoint URL. This is a hard constraint — do not add a second transport instance for any reason.

The top-level orchestrator also routes lifecycle signals to both sub-orchestrators:
- `onConnectionChange(connected)` → both
- `setRaceSessionId(id)` → both + `transport.clearQueue()` to discard cross-session events
- `deactivate()` → both + `transport.stop()` (final flush)

#### Event assignment

| Pipeline | Owns |
| :--- | :--- |
| Top-level (always-on when extension active) | `PUBLISHER_HELLO`, `PUBLISHER_HEARTBEAT`, `PUBLISHER_GOODBYE`, `IRACING_CONNECTED`, `IRACING_DISCONNECTED` |
| Session | `SESSION_*`, `RACE_GREEN/CHECKERED`, `FLAG_*`, `LAP_COMPLETED`, `SESSION_BEST_LAP`, `CLASS_BEST_LAP`, `OVERTAKE*`, `POSITION_CHANGE`, `BATTLE_*`, `LAPPED_*`, `BEING_LAPPED`, `ROSTER_UPDATED`, `WEATHER_*`, `TRACK_TEMP_*`, `WIND_*`, `TIME_OF_DAY_*` |
| Driver | `IDENTITY_*`, `PIT_*`, `FUEL_*`, `OUT_LAP`, `PERSONAL_BEST_LAP`, `LAP_TIME_DEGRADATION`, `STINT_*`, `INCIDENT_POINT`, `TEAM_INCIDENT_POINT`, `INCIDENT_LIMIT_WARNING`, `OFF_TRACK`, `BACK_ON_TRACK`, `STOPPED_ON_TRACK`, `BIG_HIT`, `SPIN_DETECTED`, `DRIVER_SWAP_*` |

Lifecycle events use whichever `raceSessionId` is currently bound (preferring the Session Publisher's binding on a media rig, the Driver Publisher's on a driver-only rig). When no session is bound, lifecycle events are emitted with `raceSessionId: null` and the transport will hold them until a session binds (see DIR-2).

#### Acceptance criteria

- [ ] `SessionPublisherOrchestrator` activates/deactivates independently of `DriverPublisherOrchestrator`
- [ ] Both orchestrators enqueue events into the same `PublisherTransport` instance
- [ ] Test asserts only one `PublisherTransport` is constructed even when both pipelines activate (single-transport invariant)
- [ ] Lifecycle events (`PUBLISHER_HELLO`/`HEARTBEAT`/`GOODBYE`, `IRACING_*`) are emitted on a media rig running only the Session Publisher
- [ ] Telemetry loop runs at 200 ms when either pipeline is active, 250 ms otherwise (per S4)
- [ ] Roster cache is owned by the top-level orchestrator and pushed to both sub-orchestrators (per S5)
- [ ] Existing tests migrate to the new file structure with no loss of coverage
- [ ] No detector is duplicated — each lives in exactly one pipeline

---

### DIR-2 — Session Publisher auto-starts on Director check-in; remove `publisher.enabled` toggle

**Repository:** margic/director  
**Labels:** enhancement, publisher, iracing  
**Branch:** f-raceevents

#### Problem

Today, `publisher.enabled` must be manually toggled before any events flow. This creates an operational gap: a Director rig that checks in to a session but forgets to enable the publisher sends no session events to Race Control.

The session publisher has no personally identifying data and no per-rig configuration dependency. There is no reason for it to be opt-in.

#### Proposed Change

- `publisher.session.enabled` setting is **removed**.
- The existing `iracing.publisher.bindSession(raceSessionId)` internal directive (fired by `SessionManager` after a successful check-in) becomes the **sole activation trigger** for the Session Publisher. Receiving `bindSession` starts the `SessionPublisherOrchestrator` if iRacing is connected; stopping occurs on session release or extension deactivation.
- A new `iracing.publisher.releaseSession()` internal directive (fired by `SessionManager` on check-out / session expiry) stops the Session Publisher and triggers a final flush. Equivalently, `bindSession(null)` is accepted with the same semantics — choose one and document the chosen form in the implementation.
- **Session change semantics**: when `bindSession` fires with a *different* `raceSessionId` than the one currently bound, the orchestrator (a) stops, (b) calls `transport.clearQueue()` to discard cross-session events, (c) resets all cached detector state (prior positions, lap counts, best laps, flag state, environment baselines), then (d) starts again with the new id. Without the reset the first frame after rebind would emit phantom `OVERTAKE`/`POSITION_CHANGE`/`SESSION_BEST_LAP` events.
- If iRacing is not connected when `bindSession` fires, the orchestrator arms itself and starts automatically when `iracing.connectionStateChanged` fires `connected: true`.
- Session publisher status is surfaced in the existing `iracing.publisherStateChanged` event, now with a `pipeline: 'session' | 'driver'` discriminator field. `eventsQueuedTotal` is reported **per pipeline** (the transport tracks emit counts keyed on the source pipeline).

#### Settings delta

| Before | After |
| :--- | :--- |
| `publisher.enabled` | **Removed** |
| `publisher.raceSessionId` | **Removed** (bound internally via `bindSession`) |

#### Acceptance criteria

- [ ] Checking in to a Director session automatically starts the Session Publisher
- [ ] Releasing a session (via `releaseSession` or `bindSession(null)`) stops the Session Publisher and flushes remaining events
- [ ] Re-binding to a different `raceSessionId` clears the transport queue and resets all detector caches (test: positions array from prior session does not produce overtake events on the first frame of the new session)
- [ ] `iracing.publisherStateChanged` carries a `pipeline` discriminator and per-pipeline counters
- [ ] No manual toggle is required or visible in the UI for session publishing
- [ ] `bindSession` arriving before iRacing connects queues the activation correctly

---

### DIR-3 — Driver Publisher: replace `publisherCode` with auto-generated `rigId`; add driver-only rig registration flow

**Repository:** margic/director  
**Labels:** enhancement, publisher, iracing  
**Branch:** f-raceevents

#### Problem

`publisherCode` is a manually configured string that operators must obtain from Race Control and type into the app. It serves two purposes that should be separated:

1. Identifying which physical machine sent an event (useful for debugging)
2. Resolving which `raceSessionId` to publish to (required for driver-only rigs without a Director Loop)

Purpose 1 should not require human configuration. Purpose 2 needs a cleaner flow.

#### Proposed Change

**`publisherCode` is removed entirely.**

**`rigId`** is introduced — a stable UUID auto-generated on first launch and stored in app config. Never user-visible beyond a read-only display in the settings panel. Appears in every `PublisherEvent` envelope as an optional annotation for debugging.

**Driver-only rig binding** (rigs without a Director Loop):

A driver-only rig operator pastes the `raceSessionId` from the Race Control event UI (or a QR code / shared message from the race organiser) into the Driver Publisher settings panel and clicks **Register**. The Director app calls:

```
POST /api/publisher/sessions/{raceSessionId}/register
Authorization: Bearer <token>
{
  "rigId": "<auto-generated UUID>",
  "driverName": "<publisher.driver.displayName || iRacing UserName>"
}
```

On success, the Driver Publisher activates and begins sending events tagged with that `raceSessionId`.

For **Director Loop rigs**, the `raceSessionId` comes from `bindSession` (see DIR-2) — no manual entry or register call needed. If `publisher.driver.enabled` is true and a check-in is held, the Driver Publisher activates automatically using the check-in's `raceSessionId`; the manual register flow is not used in this case.

#### Behaviour rules

- **MSAL login still required.** Driver-only rigs without a Director Loop must still complete MSAL sign-in to obtain a Bearer token; the register call cannot be made anonymously. Surface this in the UI as a precondition.
- **Idle behaviour.** If `publisher.driver.enabled = true` but neither check-in nor register has bound a session, the Driver Publisher stays idle and the settings UI displays "No session bound — check in or register to start publishing."
- **Multiple driver rigs per session.** Race Control accepts one registration per `(rigId, raceSessionId)` pair. Multiple distinct `rigId`s registering against the same `raceSessionId` is allowed and expected (one rig per car).
- **Regenerate `rigId`.** Operator action behind a confirmation prompt. If a session is currently bound via register, the previous registration is invalidated and the operator must re-register. In-flight events in the transport queue are flushed first under the old `rigId`.
- **Register failures.** 404 / 409 / 401 responses are surfaced in the settings UI with actionable messages (see DIR-5). The Driver Publisher does **not** activate on a failed register.

#### Settings delta

| Before | After |
| :--- | :--- |
| `publisher.enabled` | **Removed** (see DIR-2) |
| `publisher.publisherCode` | **Removed** |
| `publisher.raceSessionId` | **Removed** (bound via check-in or register) |
| `publisher.identityDisplayName` | Renamed → `publisher.driver.displayName` |
| `publisher.batchIntervalMs` | Unchanged |
| *(new)* `publisher.rigId` | Auto-generated UUID, read-only in UI |
| *(new)* `publisher.driver.enabled` | Opt-in toggle for Driver Publisher |
| *(new)* `publisher.driver.sessionId` | Populated by register flow on driver-only rigs; blank on Director Loop rigs |

#### Acceptance criteria

- [ ] `rigId` is generated on first extension activation and persisted; never regenerated unless the operator explicitly requests it
- [ ] `publisherCode` field is removed from settings, UI, and all event payloads
- [ ] Driver-only rig: pasting a `raceSessionId` and clicking Register calls `POST /api/publisher/sessions/{id}/register` and activates the Driver Publisher on success
- [ ] Driver-only rig: register failures (404/409/401) are surfaced to the operator and the publisher remains idle
- [ ] Director Loop rig: Driver Publisher activates via `bindSession` if `publisher.driver.enabled` is true, with no manual registration required
- [ ] Regenerating `rigId` requires confirmation, flushes the queue, invalidates registration, and prompts re-register
- [ ] Legacy config keys are migrated per S3 on first launch after upgrade
- [ ] `rigId` appears in `PublisherEvent.rigId` (optional field) for all events from both pipelines

---

### DIR-4 — Update `PublisherEvent` envelope and affected payload types for self-describing events

**Repository:** margic/director  
**Labels:** enhancement, publisher, iracing  
**Branch:** f-raceevents

#### Problem

Events like `OVERTAKE` and `BATTLE_ENGAGED` currently reference secondary cars as bare `carIdx` integers in their payloads. A consumer receiving these events must independently resolve `carIdx → { carNumber, driverName }` — the event is not self-describing.

Additionally, `publisherCode` in the envelope is being replaced by `rigId` (see DIR-3).

#### Proposed Changes

**Envelope changes:**

```typescript
// Before
interface PublisherEvent {
  publisherCode: string;
  // ...
}

// After
interface PublisherEvent {
  rigId?: string;   // optional — auto-generated UUID, for debugging only
  // ...
}
```

**Affected payload types** — secondary car references enriched from bare integers to `PublisherCarRef` objects:

| Event type | Before | After |
| :--- | :--- | :--- |
| `OVERTAKE`, `OVERTAKE_FOR_LEAD`, `OVERTAKE_FOR_CLASS` | `overtakenCarIdx: number` | `overtakenCar: PublisherCarRef` |
| `BATTLE_ENGAGED`, `BATTLE_CLOSING`, `BATTLE_BROKEN` | `chaserCarIdx: number` + `leaderCarIdx: number` | `chaserCar: PublisherCarRef` + `leaderCar: PublisherCarRef` |
| `LAPPED_TRAFFIC_AHEAD` | `lapDownCarIdx: number` | `lappedCar: PublisherCarRef` |
| `BEING_LAPPED` | `lappingCarIdx: number` | `lappingCar: PublisherCarRef` |
| `FLAG_BLUE_DRIVER`, `FLAG_BLACK_DRIVER`, etc. | *(car in envelope only)* | *(no change — envelope `car` is sufficient)* |

`PublisherCarRef` exists in `event-types.ts` and carries `{ carIdx, carNumber?, driverName?, teamName?, carClassShortName? }`. On the Race Control side, the structurally identical type is `PublisherEventCar` in `publisher-events.ts`. The two must remain in sync; no duplicate type should be introduced on either side.

**Battle payload semantics.** The RC `BattleEngagedPayload` uses two distinct roles (`chaserCarIdx`/`leaderCarIdx`) that the AI executor consumes separately. The Director must emit both as named `PublisherCarRef` objects (`chaserCar` + `leaderCar`). Convention: the envelope `car` field is always the chaser; `leaderCar` is the car being chased. This must hold for all three battle event types.

**Roster-fallback rule.** The roster may not yet contain an entry for a `carIdx` (e.g. a car joins mid-session, or an event fires before the first YAML parse completes). The schema must tolerate this:

- `carIdx` is required.
- `carNumber` and `driverName` are **optional** in the type; when the roster lookup fails, the detector emits `{ carIdx }` only.
- Race Control consumers must handle the `carIdx`-only case (degraded but valid).

**Transitional dual-emit.** During the rollout window, the Director publishes both the new `<name>Car: PublisherCarRef` field *and* the legacy `<name>CarIdx: number` field on each affected event. This lets Race Control consumers migrate independently. The legacy field is removed in a follow-up release once RC-3 has shipped and consumers have migrated.

#### Acceptance criteria

- [ ] All affected payload interfaces in `event-types.ts` updated; `carNumber` and `driverName` marked optional on `PublisherCarRef`
- [ ] Battle events updated with **two** named refs (`chaserCar` + `leaderCar`); `otherCar` naming removed from all three battle types
- [ ] `LAPPED_TRAFFIC_AHEAD` uses `lappedCar` (not `lapDownCar`); `BEING_LAPPED` uses `lappingCar`; field names match RC-3 exactly
- [ ] All affected detector implementations updated to populate `PublisherCarRef` from roster, with `carIdx`-only fallback
- [ ] During transition, both new (`*Car`/`*Cars`) and legacy (`*CarIdx`) fields are emitted; tests assert both shapes are present
- [ ] `publisherCode` removed from envelope; `rigId?: string` added
- [ ] Existing tests updated to reflect new payload shapes
- [ ] Follow-up issue filed to remove legacy `*CarIdx` fields after RC-3 lands

---

### DIR-5 — Update Publisher settings UI for dual-pipeline architecture

**Repository:** margic/director  
**Labels:** enhancement, ui, iracing  
**Branch:** f-raceevents

#### Problem

`PublisherSettings.tsx` was built around the single-pipeline `publisher.enabled` model with a publisher code lookup flow. Both of these are being removed.

#### Proposed UI Layout

```
PUBLISHER  (tab in iRacing Panel)
┌────────────────────────────────────────────────────────────┐
│  SESSION PUBLISHER                                         │
│  Starts automatically when a Director session is active.   │
│  Publishes flags, overtakes, battles, laps, roster and     │
│  environment for all cars in the field.                    │
│                                                            │
│  Status  ● ACTIVE   Session: sim-race-2026-05-01           │
│          Events sent: 2,841   Last flush: 0.3s ago         │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│  DRIVER PUBLISHER                             [● Enabled]  │
│  Publishes fuel, incidents, pit stops, personal bests      │
│  and stint data for the player car on this rig.            │
│                                                            │
│  Display Name  [Lando Prost          ]                     │
│  Rig ID        [3a7f-9c21  ]  [Regenerate]                 │
│                                                            │
│  ── For rigs without a Director session ──                 │
│  Session ID    [                     ]  [Register]         │
│  (Leave blank if a Director session is active)             │
│                                                            │
│  Status  ● IDLE                                            │
└────────────────────────────────────────────────────────────┘
```

#### Changes

- Remove `publisherCode` field and lookup button
- Remove `raceSessionId` manual entry from the session publisher area
- Add `rigId` as read-only display + Regenerate button (with confirmation prompt per DIR-3)
- Rename "Identity Display Name" → "Display Name"
- Add "Session ID" + Register button in a clearly labelled "For rigs without a Director session" section
  - The section is **hidden** when a Director check-in is active. The check-in's `raceSessionId` is used automatically by the Driver Publisher; manual entry and check-in are mutually exclusive.
  - When neither a check-in nor a registration exists and `publisher.driver.enabled = true`, show "No session bound — check in or register to start publishing."
- Surface register failures (404 "Session not found", 409 "Session not accepting registrations", 401 "Sign in required") inline next to the Register button
- Show per-pipeline counters: Session Publisher and Driver Publisher each display their own `eventsQueuedTotal` and `lastFlushAt` (per DIR-2)
- Session Publisher section is informational only — no toggle
- Driver Publisher section retains an on/off toggle

#### Acceptance criteria

- [ ] `publisherCode` field and lookup button removed
- [ ] Session Publisher section has no enable/disable toggle
- [ ] Driver Publisher section has `display name`, `rigId` (read-only with Regenerate + confirmation), and the driver-only `sessionId` + Register flow
- [ ] "Session ID" manual entry is hidden when a Director check-in is active (mutual exclusion with check-in)
- [ ] Register failures (404/409/401) surface actionable inline messages
- [ ] Per-pipeline event counters are displayed independently for Session and Driver publishers
- [ ] Recent events feed and status indicators retained for both pipelines

---

## Race Control Issues

---

### RC-1 — New endpoint: `POST /api/publisher/sessions/{raceSessionId}/register`

**Repository:** margic/racecontrol  
**Labels:** enhancement, api, publisher

#### Problem

Driver rigs that do not run the Director Loop have no way to bind themselves to a `raceSessionId` except via `GET /api/publisher-config/{publisherCode}`. That endpoint requires a `publisherCode` — a human-configured string that the race organiser must distribute, configure, and manage per-rig. This is operational friction that can be eliminated.

#### Proposed Endpoint

```
POST /api/publisher/sessions/{raceSessionId}/register
Authorization: Bearer <MSAL token>

Request body:
{
  "rigId": "3a7f-9c21-...",      // stable UUID auto-generated by Director
  "driverName": "Lando Prost"    // display name for this rig's player car
}

Response 200 OK:
{
  "raceSessionId": "sim-race-2026-05-01",
  "registered": true
}

Response 404 Not Found:   session does not exist
Response 409 Conflict:    session is not in a state that accepts registration
                          (accepting states: PLANNED, ACTIVE)
                          (rejecting states: COMPLETED, CANCELED)
Response 401:             unauthenticated
```

#### Behaviour

- Idempotent: calling register multiple times for the same `rigId` + `raceSessionId` is a no-op (returns 200).
- The `driverName` can be updated by re-calling register with a new value. Updated names are reflected in the session roster API response (so consumers see the new driver attribution on subsequent reads).
- **Relationship to check-in.** Director check-in remains the activation flow for media rigs; a checked-in user is implicitly authorized to publish session events for that `raceSessionId` and does **not** need to call register. Register exists specifically for driver-only rigs that do not run a Director Loop and therefore never check in.
- **Multiple registrations per session.** A single `raceSessionId` may have many distinct `rigId` registrations concurrently — one per driver rig. This is the normal multi-car case.
- No `publisherCode` required. Authorization is via the standard MSAL Bearer token — the same token used for all Director API calls.
- Race Control records the registration so that events from this `rigId` tagged with this `raceSessionId` are accepted by `POST /api/telemetry/events`.

#### Why this is needed

This is the clean replacement for the `publisherCode` lookup ceremony. Media rigs use check-in (existing flow). Driver-only rigs use register. Both result in the publisher being authorized to send events for the session.

#### Acceptance criteria

- [ ] Endpoint exists at `POST /api/publisher/sessions/{raceSessionId}/register`
- [ ] Requires valid Bearer token
- [ ] Idempotent for same `rigId` + `raceSessionId`
- [ ] Returns 404 for unknown session, 409 for non-accepting states (`COMPLETED`, `CANCELED`)
- [ ] Multiple distinct `rigId`s may register against the same `raceSessionId` concurrently
- [ ] `driverName` is stored and updatable; re-registering with a new value overwrites the previous name
- [ ] Registered `(rigId, raceSessionId, userId)` triple authorizes the Bearer-token user to POST driver events for that session, per S2
- [ ] Checked-in users may POST session events for their checked-in `raceSessionId` without calling register, per S2
- [ ] A `publisherRegistrations` Cosmos container is provisioned (partition key: `raceSessionId`, no TTL); `cosmos.tf` updated
- [ ] OpenAPI spec updated

---

### RC-2 — `POST /api/telemetry/events`: accept `rigId` in place of `publisherCode`; make identifier field optional

**Repository:** margic/racecontrol  
**Labels:** enhancement, api, publisher

#### Problem

The current `PublisherEvent` schema requires `publisherCode` — a string that operators manually configure. Under the revised Director design, `publisherCode` is removed and replaced by an auto-generated `rigId` UUID. The API schema needs to reflect this.

Additionally, for session-level events published from a media rig operating as an observer (no dedicated driver car), there is no meaningful per-car rig identifier at all. The field should be optional.

**This issue also covers two tightly coupled pieces of work:**

1. **`publisher-checkin-service.ts` migration.** `handleLifecycleEvent` in `telemetry-events.ts` calls `removePublisherCheckin(event.raceSessionId, event.publisherCode)`. `PublisherCheckinDocument` keys documents as `${raceSessionId}::${publisherCode}`, and all service methods take `publisherCode` as a parameter. These must be migrated to use `rigId` in lock-step with the envelope change — otherwise lifecycle events from a new Director will fail silently.

2. **Authorization enforcement (S2).** The current `postTelemetryEvents` checks only that a `principal` exists (is the request authenticated?). It does **not** verify the sender is authorized for the claimed `raceSessionId`. Implementing S2 — checking active check-ins for session-scope events, checking `publisherRegistrations` for driver-scope events — is new enforcement behaviour that ships in this issue. This is the primary work item; the schema rename is secondary.

#### Proposed Schema Change

In the `PublisherEvent` schema within the OpenAPI spec:

```yaml
# Before
publisherCode:
  type: string
  description: Per-rig identifier configured by the operator
  required: true

# After
rigId:
  type: string
  format: uuid
  description: >
    Stable auto-generated UUID identifying the Director installation.
    Optional — present for debugging, not required for event processing.
  required: false
```

#### Dual-field validation rule (transition window)

The following rule governs `validateEvent` during the transition period:

> Accept the event if **either** `publisherCode` (non-empty string) **or** `rigId` (UUID string) is present. Reject with **400** if both are absent. When both are present, prefer `rigId` for auth lookup; `publisherCode` is silently discarded. Once the RC-4 removal milestone is reached, drop the `publisherCode` branch entirely.

This supersedes the current validation which rejects any event without `publisherCode`.

#### Authorization

Per S2 (Shared Conventions), authorization for `POST /api/telemetry/events` is keyed on the **Bearer-token identity + `raceSessionId`**, not on `rigId`. Specifically:

- Session-scope events (those listed under "Session" in DIR-1) are accepted if the Bearer-token user holds an active check-in for the envelope's `raceSessionId`.
- Driver-scope events (those listed under "Driver" in DIR-1) are accepted if the Bearer-token user holds an active registration for `(rigId, raceSessionId)` *or* an active check-in for that session.
- This is what allows session-only events (no per-car identifier) from a media rig to be accepted with `rigId` absent.

#### Migration

- Events carrying `publisherCode` (from older Director versions) continue to be accepted during a transition period. Race Control maps them internally.
- New Director versions send `rigId` only.
- Target removal of `publisherCode` field: one minor release after the deprecated `publisher-config` endpoint (RC-4) is removed.

#### Acceptance criteria

- [ ] `rigId` accepted as optional UUID field on `PublisherEvent`
- [ ] `publisherCode` continues to be accepted (not a breaking change) but marked deprecated in the spec
- [ ] Dual-field validation rule implemented: 400 if both fields absent; `rigId` preferred when both present
- [ ] **Authorization enforcement:** `postTelemetryEvents` queries active check-ins (session-scope events) or `publisherRegistrations` (driver-scope events) against the Bearer-token identity and `raceSessionId`; returns 403 when neither is satisfied
- [ ] Session-scope events from a checked-in media rig are accepted with `rigId` absent
- [ ] Driver-scope events without an active registration or check-in are rejected with 403
- [ ] `publisher-checkin-service.ts` migrated: document key and all method signatures use `rigId` in place of `publisherCode`
- [ ] Lifecycle events from a new Director (carrying `rigId`, no `publisherCode`) are correctly processed by `handleLifecycleEvent`
- [ ] OpenAPI spec updated

---

### RC-3 — `POST /api/telemetry/events`: secondary car references in payloads should use named fields, not bare `carIdx`

**Repository:** margic/racecontrol  
**Labels:** enhancement, api, publisher

#### Problem

Events like `OVERTAKE` and `BATTLE_ENGAGED` reference the secondary car (the car being overtaken, or the other car in the battle) as a bare integer `carIdx`. Race Control consumers — including the AI planner — must join this back to a driver name and car number by cross-referencing the session roster. This is unnecessary complexity; the Director already has the roster at event-detection time.

#### Proposed Schema Change

For all multi-car event payloads, replace bare integer car references with the existing `PublisherEventCar` type. **Do not introduce a duplicate type** — `PublisherEventCar` in `publisher-events.ts` already carries `{ carIdx, carNumber?, driverName?, teamName?, carClassShortName? }` and is the correct type to reuse (optionally exported under the alias `PublisherCarRef` for cross-codebase consistency with the Director).

Affected event payload schemas:

| Event | Current fields | After |
| :--- | :--- | :--- |
| `OVERTAKE`, `OVERTAKE_FOR_LEAD`, `OVERTAKE_FOR_CLASS` | `overtakenCarIdx: int` | `overtakenCar: PublisherEventCar` |
| `BATTLE_ENGAGED`, `BATTLE_CLOSING`, `BATTLE_BROKEN` | `chaserCarIdx: int` + `leaderCarIdx: int` | `chaserCar: PublisherEventCar` + `leaderCar: PublisherEventCar` |
| `LAPPED_TRAFFIC_AHEAD` | `lappedCarIdx: int` + `lappedCarNumber: string` | `lappedCar: PublisherEventCar` |
| `BEING_LAPPED` | `leaderCarIdx: int` + `leaderCarNumber: string` | `lappingCar: PublisherEventCar` |

**Battle payload semantics.** `BattleEngagedPayload` tracks two distinct roles — the chaser and the leader — which the AI executor uses separately. Collapsing to a single `otherCar` would lose this distinction. The solution is two named refs: `chaserCar` (the closing car) and `leaderCar` (the car being chased). Convention: the envelope `car` field is always the chaser; `leaderCar` is the other participant. This convention must hold consistently across `BATTLE_ENGAGED`, `BATTLE_CLOSING`, and `BATTLE_BROKEN`.

**Field requirements.** All fields on `PublisherEventCar` except `carIdx` are optional — the roster lookup may not yet have resolved a new entrant. Consumers must tolerate `carIdx`-only objects as a degraded-but-valid state.

**Transitional dual-emit window.** During the rollout, both the legacy integer fields *and* the new `PublisherEventCar` objects will be present on the same event. Consumers should prefer the object when present. Legacy fields are removed in a follow-up release once Director consumers have migrated.

#### Acceptance criteria

- [ ] OpenAPI spec updated for all affected event payload schemas using the existing `PublisherEventCar` component (no new type introduced)
- [ ] Battle payloads updated with **two** named refs (`chaserCar` + `leaderCar`); the `envelope car = chaser` convention is documented in the spec
- [ ] `lappedCar` used for `LAPPED_TRAFFIC_AHEAD`; `lappingCar` used for `BEING_LAPPED`; field names match DIR-4 exactly
- [ ] Validation accepts both the new object shapes and the legacy integer fields during the dual-emit window
- [ ] Validation accepts `PublisherEventCar` objects containing only `carIdx` (degraded roster case)
- [ ] Old integer fields marked deprecated (not immediately removed for migration tolerance)

---

### RC-4 — Deprecate `GET /api/publisher-config/{publisherCode}`

**Repository:** margic/racecontrol  
**Labels:** deprecation, api, publisher

#### Problem

`GET /api/publisher-config/{publisherCode}` was the primary mechanism for driver rigs to discover their `raceSessionId` from a short human-readable code. Under the new design this is replaced by `POST /api/publisher/sessions/{raceSessionId}/register` (RC-1), which is simpler and does not require Race Control to pre-assign `publisherCode` values to rigs.

#### Proposed Change

- Mark `GET /api/publisher-config/{publisherCode}` as **deprecated** in the OpenAPI spec.
- Endpoint remains functional for the current Python prototype and any older Director versions still in the field.
- Target for removal: when `publisherCode` support is formally dropped (a separate future milestone).

#### Acceptance criteria

- [ ] Endpoint marked `deprecated: true` in OpenAPI spec
- [ ] Deprecation notice added to API docs
- [ ] `Deprecation: true` response header added to `getPublisherConfig.ts` response
- [ ] `Sunset` (or `Link` with `rel="sunset"`) header added indicating the planned removal milestone
- [ ] Endpoint continues to function (no breaking change)

---

## Summary — Dependency Order

```
RC-1 (register endpoint)   ←── DIR-3 (driver rig registration flow)
RC-2 (rigId in events)     ←── DIR-3, DIR-4
RC-3 (CarRef payloads)     ←── DIR-4
RC-4 (deprecate config)    ←── DIR-3 (can be done any time after RC-1 ships)

DIR-1 (split pipelines)    ←── DIR-2, DIR-3 depend on this
DIR-2 (auto-start session) ←── DIR-1
DIR-3 (rigId + register)   ←── DIR-1, RC-1
DIR-4 (envelope + payloads)←── DIR-1, RC-2, RC-3
DIR-5 (settings UI)        ←── DIR-2, DIR-3
```

Minimum viable sequence:
1. **RC-1** — unblocks driver-only rigs immediately
2. **DIR-1 + DIR-2** in the same PR — split + auto-start
3. **DIR-3** — once RC-1 is merged or behind a feature flag
4. **DIR-4 + RC-2 + RC-3** — together (wire format change, coordinate with Race Control)
5. **DIR-5** — after DIR-2 and DIR-3
6. **RC-4** — any time after RC-1 is stable
