# Session Check-In and Lifecycle

> STATUS: IMPLEMENTED. Source of truth: `src/main/session-manager.ts`,
> `src/main/director-orchestrator.ts`. Replaces the three legacy
> documents `feature_session_claim.md`,
> `rc-response-to-session-checkin.md`, and `response_session_checkin.md`.

A "session" is a Race Control concept: a scheduled racing session
(practice, qualifying, race) at a specific Sim Center. A Director
must **claim** a session before the cloud will plan sequences for it.
This claim is called a **check-in** and is bounded by a TTL the cloud
issues; missing the renewal causes the claim to lapse.

This document specifies the full lifecycle, the wire contracts, the
state machine, the conflict-resolution flow, and the Director-side
storage of session metadata.

For the data shapes themselves, see `data-models.md` § Session check-in.

## The five-phase lifecycle

```
   none ─── discover() ──▶ searching ─── 200 sessions ──▶ discovered
                                          │
                                          │  selectSession(id)
                                          ▼
                                       selected ─── checkin() ──▶ checked-in
                                          ▲                           │
                                          │                           │ wrap()
                                          └──────────────  ◀──────────┘
                                                      DELETE /checkin
```

| Phase | Director-side | Cloud state |
|---|---|---|
| `none` | Nothing selected. | — |
| `searching` | `discover()` in flight. | — |
| `discovered` | Sessions listed; none selected. | — |
| `selected` | One session active in UI; no check-in yet. | Session claimable. |
| `checked-in` | A `checkinId` is held; auto-mode is allowed. | This Director owns the session. |

Transitions are driven by `SessionManager` and emitted as
`stateChanged` events. `DirectorOrchestrator` listens to these to
auto-transition its mode FSM (see `architecture-orchestrator.md`).

## API surface

The renderer-facing surface is `window.electronAPI.session.*` (see
`api-contextbridge.md`). Internal callers use `SessionManager`
directly.

| Method | Endpoint | HTTP method |
|---|---|---|
| `discover(centerId?)` | `GET /api/director/v1/sessions?centerId={c}&status=...` | GET |
| `selectSession(id)` | (local) | — |
| `clearSession()` | (local; releases the check-in if held) | — |
| `checkinSession({ forceCheckin? })` | `POST /api/director/v1/sessions/{id}/checkin` | POST |
| `refreshCheckin()` | `PATCH /api/director/v1/sessions/{id}/checkin` | PATCH |
| `wrapSession(reason?)` | `DELETE /api/director/v1/sessions/{id}/checkin` | DELETE |

The same URL serves all three check-in verbs; the HTTP method
distinguishes create / refresh / release.

## Discover

```http
GET /api/director/v1/sessions?centerId={uuid}&status=upcoming,live
Authorization: Bearer {token}
```

If `centerId` is not provided, Director uses
`UserProfile.centerId` from `/api/auth/user`. The response is an array
of `RaceSession` objects. Director caches them in
`SessionManagerState.sessions` and emits `stateChanged` with
`state: 'discovered'`. If the array is empty, state goes back to
`none`.

## Check in

```http
POST /api/director/v1/sessions/{raceSessionId}/checkin
Authorization: Bearer {token}
Content-Type: application/json
X-Force-Checkin: true   ← optional, evicts any existing check-in

{
  "directorId":   "d_inst_…",       // persistent Director instance id
  "version":      "0.1.7",          // app.getVersion()
  "capabilities": { …DirectorCapabilities… },
  "sequences":    [ …PortableSequence (max 50)… ],   // optional, for Planner training
  "raceContext":  { …RaceContext… }                   // optional, live snapshot
}
```

### Successful response (`200 OK`)

```json
{
  "status": "standby",
  "checkinId": "ck_…",
  "checkinTtlSeconds": 120,
  "sessionConfig": {
    "raceSessionId": "…",
    "name": "Wednesday Night Cup",
    "status": "live",
    "simulator": "iracing",
    "drivers": [ { "driverId": "…", "carNumber": "42", "rigId": "…", "obsSceneId": "…" } ],
    "obsScenes": ["camera_1", "in_car", …],
    "obsHost": "192.168.1.50:4455",
    "timingConfig": {
      "idleRetryIntervalMs": 5000,
      "retryBackoffMs":      30000
    }
  },
  "warnings": [ "Roster has 2 unmatched drivers" ]
}
```

Director:

1. Stores `checkinId`, `checkinTtlSeconds`, `sessionConfig`, `warnings`.
2. Sets `checkinStatus = 'standby'`.
3. Emits `stateChanged` with `state: 'checked-in'`.
4. The orchestrator picks this up and auto-transitions to `auto` mode
   if configured (or stays in `manual`), and dispatches the internal
   directive `iracing.publisher.bindSession` so publisher events get
   tagged with the cloud-assigned `raceSessionId`.

### Conflict (`409 Conflict`)

```json
{
  "error": "Session already claimed",
  "existingCheckin": {
    "directorId":   "d_inst_other",
    "checkedInAt":  "2026-05-05T01:30:00Z",
    "expiresAt":    "2026-05-05T01:32:00Z",
    "displayName":  "Bob's Director"
  }
}
```

`SessionManager` sets `lastError` (`"Session in use by Bob's Director"`)
and `checkinStatus = 'error'`. The renderer can offer a "Force
check-in" button which re-calls `checkin({ forceCheckin: true })` —
this sends `X-Force-Checkin: true` and the cloud evicts the existing
holder.

### Other responses

| Status | Behaviour |
|---|---|
| `4xx` | `checkinStatus = 'error'`, `lastError` set, no retry. |
| Network failure | Same. |

There is **no automatic retry** at the SessionManager layer. The UI
must explicitly retry.

## Refresh check-in (capabilities-changed)

```http
PATCH /api/director/v1/sessions/{id}/checkin
Authorization: Bearer {token}
Content-Type: application/json
X-Checkin-Id: ck_…

{ "capabilities": { …DirectorCapabilities… } }
```

Triggered by the orchestrator when an `extension.capabilitiesChanged`
event fires while `checkinStatus === 'standby'`. The cloud updates the
known capabilities **without re-running the Planner**. A `404`
response means the check-in expired; SessionManager resets to
`selected` and the orchestrator drops to `manual`.

## Wrap (release)

```http
DELETE /api/director/v1/sessions/{id}/checkin
Authorization: Bearer {token}
X-Checkin-Id: ck_…
```

| Status | Meaning |
|---|---|
| `200` / `204` / `404` | Released successfully (404 = check-in already gone, treated as success). |
| `403` | Another Director took over (we lost the claim before we could release it). |
| Other | Logged as a warning; local state is cleared anyway. |

After wrap, `SessionManager` resets to `selected`. The orchestrator
drops to `manual` (or stays `stopped`). `app.on('will-quit')` calls
`wrapSession('app-quit')` as best-effort cleanup; failures are
swallowed.

## Director instance id

Persisted in `electron-store` at `director.id`. Created lazily by
`configService.getOrCreateDirectorId()`:

```
director.id = "d_inst_" + randomUUID()
```

This is the `directorId` in the check-in body. It is **not** a user
identifier — it identifies a single installation. Multiple Directors
on different machines (e.g. backup operator) get different ids.

## State storage

`SessionManager` holds in memory:

```ts
state:           SessionState               // FSM phase
sessions:        RaceSession[]              // last discovery result
selectedSession: RaceSession | null
lastError?:      string

// check-in
checkinId:        string | null
checkinStatus:    CheckinStatus             // unchecked|checking-in|standby|directing|wrapping|error
sessionConfig:    SessionOperationalConfig | null
checkinWarnings:  string[]
checkinTtlSeconds: number                   // initial 120s, overwritten by response
```

None of this survives an app restart. There is intentionally no
persistence: a fresh launch always begins in `state: 'none'`. If the
operator was checked in when the app crashed, the cloud will release
the check-in when the TTL expires.

## Conflict resolution UX

The renderer's session selection screen distinguishes three states:

1. **Free** — no `existingCheckin`. "Check in" button.
2. **Mine (recoverable)** — `existingCheckin.directorId === ourId`.
   "Resume" button (calls `checkin({ forceCheckin: true })`).
3. **Taken by another** — `existingCheckin.directorId !== ourId`.
   "Force check-in" button with a confirmation modal showing
   `displayName` and `expiresAt`.

This is implemented in the renderer; the SessionManager does not
distinguish the three cases server-side — it just surfaces the
conflict and lets the UI decide.

## Cross-references

- The `RaceContext` snapshot included in `checkin` is documented in
  `data-models.md` § RaceContext and assembled by
  `DirectorOrchestrator.buildRaceContext()`.
- `DirectorCapabilities` is built by the callback wired in
  `main.ts:setCapabilitiesBuilder` and excludes `operational` and
  `query` intents (see `architecture-orchestrator.md` § active-intents
  filter).
- `iracing.publisher.bindSession` (the directive sent after check-in)
  is documented in `feature_iracing_publisher.md`.
