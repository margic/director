# iRacing Publisher

> STATUS: IMPLEMENTED. Source of truth: `src/extensions/iracing/publisher/`.

The Publisher is a **subsystem inside the iRacing extension** that
emits `PublisherEvent` records to the Race Control telemetry ingest
endpoint. There are two pipelines (Session and Driver) sharing one
transport, gated by separate enable flags. The cloud uses these
events as the primary signal for storytelling: it is the publisher
that says "car 42 just overtook car 7 at turn 3", and the cloud
that decides "show that on screen".

For the wire envelope and event-type union, see `data-models.md` §
Publisher events. The full per-event payload definitions live in
`src/extensions/iracing/publisher/event-types.ts`.

## Component layout

```
PublisherOrchestrator                              ← top-level (one per app)
├── PublisherTransport                             ← single, batches POSTs
├── LifecycleEventDetector                         ← PUBLISHER_HELLO/HEARTBEAT/GOODBYE,
│                                                    IRACING_CONNECTED/DISCONNECTED
├── SessionPublisherOrchestrator                   ← started by bindSession(id)
│   ├── EnvironmentDetector                        ← weather, track temp, time-of-day
│   ├── FlagDetector                               ← FLAG_GREEN/YELLOW/RED/WHITE/...
│   ├── PolishFlagDetector                         ← black/blue/meatball/disqualify
│   ├── LapCompletedDetector                       ← LAP_COMPLETED
│   ├── LapPerformanceSessionDetector              ← PERSONAL/SESSION/CLASS_BEST_LAP
│   ├── OvertakeBattleDetector                     ← OVERTAKE/BATTLE_*/POSITION_CHANGE
│   ├── SessionLifecycleDetector                   ← SESSION_LOADED/STATE_CHANGE/RACE_GREEN/CHECKERED/ENDED
│   ├── SessionTypeDetector                        ← SESSION_TYPE_CHANGE
│   └── RosterDetector                             ← ROSTER_UPDATED, IDENTITY_RESOLVED
└── DriverPublisherOrchestrator                    ← started by registerDriver(id)
    ├── DriverSwapDetector                         ← DRIVER_SWAP_INITIATED/COMPLETED
    ├── IdentityEventBuilder + IdentityOverride    ← IDENTITY_RESOLVED, IDENTITY_OVERRIDE_CHANGED
    ├── LapPerformanceDriverDetector               ← STINT_BEST_LAP, LAP_TIME_DEGRADATION, STINT_MILESTONE
    ├── PitIncidentDetector                        ← PIT_ENTRY/EXIT, OFF_TRACK, BACK_ON_TRACK, INCIDENT_POINT
    ├── PitStopDetailDetector                      ← PIT_STOP_BEGIN/END, FUEL_*
    ├── PlayerPhysicsDetector                      ← BIG_HIT, SPIN_DETECTED, STOPPED_ON_TRACK
    └── IncidentStintDetector                      ← TEAM_INCIDENT_POINT, INCIDENT_LIMIT_WARNING
```

Each detector consumes `TelemetryFrame` ticks (the assembled view of
the iRacing shared memory) and emits zero or more `PublisherEvent`s
through the orchestrator.

The list above is the **canonical detector inventory**. Adding a new
event type requires adding (or extending) a detector here.

## Lifecycle

### `activate()`

Called by `iracing/index.ts:activate`.

1. Migrate legacy config keys (`LEGACY_KEYS` in `orchestrator.ts`).
2. Generate a `rigId` (uuid) if `publisher.rigId` is unset; persist
   via `director.saveSetting`.
3. Construct the singleton `PublisherTransport`:
   - `endpointUrl = director.settings['publisher.endpointUrl'] ||
     '{rcApiBaseUrl}/api/telemetry/events'`
   - `batchIntervalMs = director.settings['publisher.batchIntervalMs'] || 2000`
   - `getAuthToken = director.getAuthToken`
4. Start the lifecycle detector (heartbeat every 30 s).
5. Emit `PUBLISHER_HELLO`.

### `bindSession(raceSessionId)`

Triggered by the internal directive
`iracing.publisher.bindSession` after Director check-in.

- Stores the id; **arms** it if iRacing is not yet connected.
- Activates pipeline(s) according to `publisher.scope`:
  - `'session'` *(default)* → `SessionPublisherOrchestrator` only.
  - `'driver'` → `DriverPublisherOrchestrator` only.
  - `'both'` → both (dev/demo only — logs a warning).
- Emits `iracing.publisherStateChanged { status: 'active', raceSessionId }`.

### `setScope(scope)` *(DIR-4)*

Triggered by `iracing.publisher.setScope` from the Rig Mode selector in
the Publisher Settings UI.

1. Validates the value (`'session' | 'driver' | 'both'`).
2. Persists `publisher.scope` via `director.saveSetting`.
3. If a session is bound and iRacing is connected, deactivates the
   running sub-orchestrators and re-runs the equivalent of
   `startSessionPipeline()` so the new scope takes effect immediately.
   The transport stays live across the transition; `PUBLISHER_HELLO`
   is re-emitted by the restart.
4. Emits `iracing.publisherStateChanged` so the UI updates.

The legacy intents `iracing.publisher.setSessionEnabled` /
`iracing.publisher.setDriverEnabled` are deprecated in favor of
`setScope`; the corresponding `publisher.session.enabled` /
`publisher.driver.enabled` config keys are no longer consulted by the
orchestrator after the one-time migration in `migrateConfig()`.

### `releaseSession()`

Triggered by `iracing.publisher.releaseSession` (sent on session wrap
or 410 Gone).

1. Stops both sub-orchestrators.
2. Emits `PUBLISHER_GOODBYE`.
3. Calls `transport.flush()` to drain pending batches.
4. The transport itself stays live (next `bindSession` reuses it).

### `registerDriver(raceSessionId)`

Driver-only flow: an operator running a rig (not a Race Director)
registers as a publisher for someone else's session. POSTs to
`/api/publisher-config/{publisherCode}` to claim the slot, then starts
the `DriverPublisherOrchestrator` independently of session binding.

### `initiateDriverSwap(outgoing, incoming, displayName)`

Operator-triggered. Delegates to `DriverSwapDetector` which:

1. Emits `DRIVER_SWAP_INITIATED { outgoingDriverId, incomingDriverId }`.
2. Suppresses driver-pipeline events for the outgoing driver.
3. Re-emits `IDENTITY_RESOLVED` for the incoming driver.
4. Emits `DRIVER_SWAP_COMPLETED` once the next telemetry tick
   confirms the new driver is in the seat (matched via
   `DriverInfo.Drivers[carIdx].UserName`).

There is no formal state machine enum — the swap is gated on the
"observed driver matches incoming" condition. Timeouts are not
enforced; if the swap never completes (e.g. iRacing crash), the next
`registerDriver` or `releaseSession` resets state.

### `deactivate()`

Stops both pipelines, sends `PUBLISHER_GOODBYE`, and tears down the
transport. Called when the iRacing extension is unloaded.

## Operator guide: one Director rig per session

**Only one rig per race session may run in Director (`scope='session'`)
mode.** All other rigs participating in the same session (driver
stations, additional spectators) must run in Driver (`scope='driver'`)
mode. `scope='both'` is for single-machine dev/demo only.

### Why

`SessionPublisherOrchestrator` observes the *entire field* via the
shared iRacing YAML/telemetry. Every rig running with `scope='session'`
sees the same session state and independently emits the same
broadcast-level events (flags, overtakes, all-car `LAP_COMPLETED`,
roster, environment). Race Control deduplicates only by event `id`
(which includes `rigId`), so two Director rigs on one session cause
**every broadcast event to be ingested twice** — inflating Cosmos DB
RU consumption, doubling the AI narrative context signal, and
potentially firing duplicate sequence triggers.

### How operators avoid the misconfiguration

1. The Rig Mode selector in **Publisher Settings** (the "Director /
   Driver / Combined" radio group, see
   `src/extensions/iracing/renderer/PublisherSettings.tsx`) is the
   single source of truth. The Director option's blurb states
   "One per session" so the constraint is visible at the point of
   selection.
2. Driver rigs should select **Driver** and complete the registration
   flow against their session.
3. The dedicated broadcast / media rig — and only that rig — should
   select **Director**.

### What Director does *not* do today

There is no client-side leader election or server-side dedup. A second
rig with `scope='session'` will not be detected or blocked; the
constraint is enforced operationally via the UI. A future enhancement
(see issue tracker) may add a session-publisher lease against the Race
Control API; server-side dedup by `(raceSessionId, type, sessionTick,
carIdx)` is being tracked at
<https://github.com/margic/racecontrol/issues>.

## Transport

`PublisherTransport` (`src/extensions/iracing/publisher/transport.ts`).

### Endpoint

```http
POST {endpointUrl}        // default https://simracecenter.com/api/telemetry/events
Authorization: Bearer {token}
Content-Type: application/json

{ "events": [ …PublisherEvent… ] }   // maxItems: 20 per spec
```

### Auto-config endpoint (driver flow only)

```http
GET /api/publisher-config/{publisherCode}
Authorization: Bearer {token}
```

Returns `PublisherConfigResponse` with `gatewayUrl`, `raceSessionId`,
`driverId`, `displayName`, etc. Used so a driver only needs to enter
their `publisherCode`.

### Batching

- `BATCH_INTERVAL_MS` is configurable via `publisher.batchIntervalMs`
  (default 2000). Flushed on the timer.
- Maximum batch size is **20 events** (spec constraint). Larger
  pending queues are split across multiple POSTs.
- High-priority events bypass the timer and trigger an immediate
  flush. The list is `HIGH_PRIORITY_EVENTS` in `event-types.ts`
  (lifecycle, flag changes, race start/end, identity resolution).

### Response handling

| Status | Behaviour |
|---|---|
| `202 Accepted` | Parse `PublisherEventBatchResponse`. Log any `invalid` results. Reset backoff. |
| `400 Bad Request` | **Drop** the batch (structural failure). No retry. |
| `401 Unauthorized` | Re-queue the batch. Surface error so caller can refresh the token. |
| `429 Too Many Requests` | Re-queue. Exponential backoff (`INITIAL_BACKOFF_MS=1000`, capped at `MAX_RETRY_BACKOFF_MS=30000`). |
| `5xx` / network error | Same as `429`: re-queue with backoff. |

The transport reports its current state via `onStatusChange(status)`
(`'idle' | 'sending' | 'error'`); the orchestrator forwards this as
`iracing.publisherStateChanged`.

## Status events

`iracing.publisherStateChanged`:

```ts
{
  status: 'active' | 'idle' | 'error' | 'disabled';
  message?: string;
  raceSessionId?: string;
  publisherCode?: string;
  eventsQueuedTotal: number;
  lastFlushAt?: number;
}
```

`iracing.publisherEventEmitted` is fired once per event handed to the
transport (regardless of whether it's been POSTed yet). Used by the
publisher panel to render a recent-events feed.

## Edge-authoritative identity

The publisher is the source of truth for **who is in the seat**. The
cloud trusts `IDENTITY_RESOLVED` and `IDENTITY_OVERRIDE_CHANGED`
events from the publisher; it does not infer identity from iRacing
account info.

`IdentityOverride` (in `driver-publisher/identity-override.ts`) lets
the operator set a `displayName` that overrides the iRacing username.
This is persisted at `publisher.driver.displayName` and re-emitted as
`IDENTITY_OVERRIDE_CHANGED` on every change.

## CLOUD-EMITTED events (do not produce these)

The publisher MUST NOT emit:

```
FOCUS_VS_FOCUS_BATTLE, FOCUS_GROUP_ON_TRACK, FOCUS_GROUP_SPLIT,
STINT_HANDOFF_HANDOVER, RIG_FAILOVER, STINT_BATON_PASS,
UNDERCUT_DETECTED, IN_LAP_DECLARED, SESSION_LEADER_CHANGE
```

These are synthesised by the cloud from cross-rig data and may appear
in cloud-side analyses of the session, but no edge component should
ever produce them.

## Testing

Detector tests live in
`src/extensions/iracing/publisher/__tests__/`. Each detector has its
own `*.test.ts` file using realistic frames from
`__tests__/frame-fixtures.ts`. The orchestrator-level test
(`orchestrator.test.ts`) asserts the single-transport invariant and
the bind/release lifecycle. Run with `npm test -- publisher`.
