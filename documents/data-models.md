# Data Models

> STATUS: IMPLEMENTED. Source of truth: `src/main/director-types.ts`,
> `src/extensions/iracing/publisher/event-types.ts`,
> `src/main/overlay/overlay-types.ts`,
> `src/main/extension-host/extension-types.ts`,
> `src/main/session-manager.ts`.

This document is a **canonical type reference**. All wire formats
between Director, Race Control, the renderer, and the extension host
are defined here. The code definitions are authoritative — this
document mirrors them.

## Table of contents

- [Sequences](#sequences)
- [Execution](#execution)
- [Race Context](#racecontext)
- [Session check-in](#session-check-in)
- [Director state](#director-state)
- [Capability catalog](#capability-catalog)
- [Publisher events](#publisher-events)
- [Overlay](#overlay)
- [Extension manifest](#extension-manifest)

---

## Sequences

A `PortableSequence` is the canonical, headless format. The executor
does not care how it was authored (Visual Editor, AI, JSON file, REST
import).

```ts
interface PortableSequence {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  category?: 'builtin' | 'cloud' | 'custom';
  /** If true, executes immediately even mid-Director-Loop (cancel-and-replace). */
  priority?: boolean;
  variables?: SequenceVariable[];
  steps: SequenceStep[];
  metadata?: Record<string, unknown>;
}

interface SequenceStep {
  id: string;
  /** Namespace-scoped intent id, e.g. "system.wait", "obs.switchScene". */
  intent: string;
  payload: Record<string, unknown>;
  metadata?: { label?: string; timeout?: number };
}

interface SequenceVariable {
  name: string;            // camelCase identifier
  label: string;           // for UI
  type: 'text' | 'number' | 'boolean' | 'select'
      | 'sessionTime' | 'sessionTick';
  required: boolean;
  default?: unknown;
  description?: string;
  constraints?: {
    min?: number; max?: number;
    options?: { label: string; value: string }[];
    pattern?: string;
  };
  source?: 'user' | 'context' | 'cloud';
  contextKey?: string;     // dot-path into telemetry/session for auto-fill
}
```

### Variable resolution (`$var()` syntax)

Implemented in `src/main/sequence-scheduler.ts:25..92`. Substitution
only — **no expression evaluation**, **no arithmetic**, **no method
calls**. Two forms:

| Source string | Behaviour |
|---|---|
| `"$var(name)"` (entire value) | Replaced with the raw typed value (preserves `number`, `boolean`, `null`). |
| `"… $var(name) …"` (interpolated) | `String(value)` interpolated; unknown names left verbatim. |

Resolution precedence: explicitly provided > `default` > unset.
Required variables that resolve to unset throw before execution
begins. Substitution recurses through nested objects but **not** into
arrays (arrays are passed through as-is).

## Execution

```ts
type ExecutionSource =
  | 'manual' | 'director-loop' | 'ai-agent'
  | 'stream-deck' | 'webhook' | 'event-mapper';

interface QueuedSequence {
  executionId: string;          // uuid v4
  sequence: PortableSequence;
  variables: Record<string, unknown>;
  queuedAt: string;             // ISO-8601
  position: number;             // 1-indexed
  source: ExecutionSource;
}

interface SequenceProgress {
  executionId: string;
  sequenceId: string;
  sequenceName: string;
  currentStep: number;          // 1-indexed; 0 means not yet started
  totalSteps: number;
  stepIntent: string;
  stepStatus: 'running' | 'success' | 'skipped' | 'failed';
  log: string;                  // pre-formatted single line for the activity log
}

interface StepResult {
  stepId: string;
  intent: string;
  status: 'success' | 'skipped' | 'failed';
  durationMs: number;
  message?: string;             // error or skip reason
}

interface ExecutionResult {
  executionId: string;
  sequenceId: string;
  sequenceName: string;
  status: 'completed' | 'partial' | 'failed' | 'cancelled';
  source: ExecutionSource;
  priority: boolean;
  startedAt: string;            // ISO-8601
  completedAt: string;
  totalDurationMs: number;
  resolvedVariables: Record<string, unknown>;
  steps: StepResult[];
}
```

The progress event uses two synthetic `stepIntent` values: `sequence.start`
(emitted before the first real step) and `sequence.end` (emitted after
the last). The orchestrator treats `sequence.start` as the trigger to
prefetch the next cloud sequence.

## RaceContext

Sent in the body of every `POST .../sequences/next` and (since issue
#114) included in `POST .../checkin` so the Planner can phase-weight
templates.

```ts
interface RaceContext {
  sessionType: string;       // "Race", "Practice", "Qualify"
  sessionFlags: string;      // "green" | "caution" | "red" | "disconnected"
  lapsRemain: number;        // -1 if unlimited
  carCount: number;
  contextTimestamp: string;  // ISO-8601
  cautionType?: 'local' | 'fullCourse' | 'none';
  timeRemainSec?: number;
  leaderLap?: number;
  totalLaps?: number;
  focusedCarNumber?: string;
  currentObsScene?: string;
  battles?: { cars: string[]; gapSec: number }[];
  pitting?: string[];
  trackName?: string;
  trackType?: string;        // "oval" | "road"
  seriesName?: string;
  drivers?: RaceContextDriver[];   // top-20, sorted by overall position
  recentEvents?: RaceContextEvent[];
  stintLaps?: number;        // for the focused driver
}

interface RaceContextDriver {
  carNumber: string;
  gapToAhead: number;
  lapsCompleted: number;
  bestLap: number;           // seconds
  classPosition: number;
  pos?: number;              // overall position (1-indexed)
  driverName?: string;
  carClass?: string;         // short name, e.g. "GT3"
  isOnTrack?: boolean;
  lastLap?: number;          // seconds; 0 if never finished a lap
}

interface RaceContextEvent {
  type: string;              // "LEADER_CHANGE", "LAPS_MILESTONE", "BATTLE_APPROACHING", …
  description: string;       // plain English, fed to Planner
  timestamp: string;         // ISO-8601
  carNumber?: string;
  data?: Record<string, unknown>;
}
```

`recentEvents` are synthesised by `RaceAnalyzer`
(`src/main/race-analyzer.ts`) from local telemetry — they are never
fetched from the cloud.

## Session check-in

The full lifecycle is in `feature_session_claim.md`. The wire types:

```ts
type CheckinStatus =
  | 'unchecked' | 'checking-in' | 'standby'
  | 'directing' | 'wrapping' | 'error';

// REQUEST: POST /api/director/v1/sessions/{raceSessionId}/checkin
//          (use X-Force-Checkin: true to evict an existing checkin)
interface SessionCheckinRequest {
  directorId: string;        // d_inst_{uuid}, persisted in config
  version: string;           // app.getVersion()
  capabilities: DirectorCapabilities;
  /** Optional: the operator's local sequence library (max 50). */
  sequences?: PortableSequence[];
  /** Optional: live raceContext snapshot for Planner phase-weighting. */
  raceContext?: RaceContext;
}

// RESPONSE 200
interface SessionCheckinResponse {
  status: 'standby';
  checkinId: string;
  checkinTtlSeconds: number;
  sessionConfig: SessionOperationalConfig;
  warnings?: string[];
}

// RESPONSE 409 — session already claimed
interface SessionCheckinConflict {
  error: string;
  existingCheckin: {
    directorId: string;
    checkedInAt: string;
    expiresAt: string;
    displayName?: string;
  };
}

interface SessionOperationalConfig {
  raceSessionId: string;
  name: string;
  status: string;
  simulator: string;
  drivers: SessionDriverMapping[];
  obsScenes: string[];
  obsHost?: string;
  timingConfig?: {
    idleRetryIntervalMs: number;   // CloudPoller idle interval
    retryBackoffMs: number;
  };
}

interface SessionDriverMapping {
  driverId: string;
  carNumber: string;
  rigId: string;
  obsSceneId: string;
  displayName?: string;
}
```

### `DirectorCapabilities` — what we tell the cloud

```ts
interface DirectorCapabilities {
  intents: IntentCapability[];          // broadcast intents only (#112)
  connections: Record<string, ConnectionHealth>;
  cameraGroups?: CameraGroup[];         // iRacing
  scenes?: string[];                    // OBS
  drivers?: CapabilityDriver[];         // iRacing
  /** Per-extension prose blocks injected into the Planner LLM prompt (#113). */
  extensionContexts?: { extensionId: string; aiContext: string }[];
}

interface IntentCapability {
  intent: string;
  extensionId: string;
  active: boolean;
  schema?: Record<string, unknown>;
  description?: string;
}

interface ConnectionHealth {
  connected: boolean;
  connectedSince?: string;
  metadata?: Record<string, unknown>;
}

interface CameraGroup     { groupNum: number; groupName: string; }
interface CapabilityDriver { carNumber: string; userName: string; carName: string; }
```

### Wrap (release the session)

```
POST /api/director/v1/sessions/{raceSessionId}/checkin    (refresh)
DELETE /api/director/v1/sessions/{raceSessionId}/checkin  (wrap)

interface SessionWrapRequest { reason?: string; }
```

> Note: in `auth-config.ts` the `wrap` endpoint resolves to the same
> URL as `checkin`/`refreshCheckin`. The HTTP **method** is what
> distinguishes them. See `session-manager.ts:wrapSession` for the
> `DELETE` invocation.

## Director state

```ts
interface DirectorOrchestratorState {
  mode: 'stopped' | 'manual' | 'auto';
  status: 'IDLE' | 'BUSY' | 'ERROR';
  sessionId: string | null;
  currentSequenceId?: string | null;
  totalCommands?: number;
  processedCommands?: number;
  lastError?: string;
  checkinStatus: CheckinStatus;
  checkinId?: string | null;
  sessionConfig?: SessionOperationalConfig | null;
  checkinWarnings?: string[];
}

interface SessionManagerState {
  state: 'none' | 'searching' | 'discovered' | 'selected' | 'checked-in';
  sessions: RaceSession[];
  selectedSession: RaceSession | null;
  lastError?: string;
  checkinStatus: CheckinStatus;
  checkinId?: string | null;
  sessionConfig?: SessionOperationalConfig | null;
  checkinWarnings?: string[];
  checkinTtlSeconds?: number;
}
```

`RaceSession` is the loose shape returned by Race Control; the fields
Director cares about are `raceSessionId`, `name`, `centerId`,
`simulator`, `obsHost`, `obsPassword`, `directorSceneId`, `drivers`,
`iracing`, `settings`. See `director-types.ts:185` for the full
optional surface.

## Capability catalog

What the catalog hands to the renderer (`catalog.intents()`,
`catalog.events()`):

```ts
interface IntentCatalogEntry {
  intentId: string;
  label?: string;
  extensionId: string;
  extensionLabel?: string;
  inputSchema?: Record<string, unknown>;
  active: boolean;
}

interface EventCatalogEntry {
  eventId: string;
  label?: string;
  extensionId: string;
  extensionLabel?: string;
  payloadSchema?: Record<string, unknown>;
}
```

These are produced by `SequenceLibraryService.getRegisteredIntents()`
and are slimmer than the internal `CatalogEntry` (which carries the
full `IntentContribution`).

## Publisher events

The wire envelope POSTed in batches to `POST /api/telemetry/events`:

```ts
interface PublisherEvent<T extends PublisherEventType = PublisherEventType> {
  id: string;                  // uuid v4 — idempotency key
  raceSessionId: string;       // bound at check-in via the bindSession directive
  rigId?: string;              // uuid for this physical rig
  type: T;
  timestamp: number;           // ms since epoch (publisher clock)
  sessionTime: number;         // iRacing SessionTime (s)
  sessionTick: number;         // iRacing SessionTick (used for de-dup)
  car: PublisherCarRef;
  payload: EventPayloadMap[T];
  context?: PublisherEventContext;
}

interface PublisherCarRef {
  carIdx: number;              // iRacing CarIdx, 0..63
  carNumber?: string;          // omitted when roster not yet resolved
  driverName?: string;
  teamName?: string;
  carClassShortName?: string;
}

interface PublisherEventContext {
  leaderLap?: number;
  sessionState?: number;       // iRacing enum value
  sessionFlags?: number;       // bitmask
  trackTemp?: number;          // °C
}
```

The full `PublisherEventType` union and per-event payloads are in
`src/extensions/iracing/publisher/event-types.ts`. `feature_iracing_publisher.md`
groups them by detector.

The batch wire format:

```ts
interface PublisherEventBatchRequest  { events: PublisherEvent[]; }   // maxItems: 20
interface PublisherEventBatchResponse {
  accepted: number; duplicates: number; invalid: number;
  results: { id: string; status: 'accepted' | 'duplicate' | 'invalid'; error?: string }[];
}
```

## Overlay

```ts
type OverlayRegion =
  | 'top-bar' | 'lower-third' | 'ticker'
  | 'center-popup' | 'corner-top-left' | 'corner-top-right';

interface OverlayRegistration {
  id: string;          // unique within the extension
  region: OverlayRegion;
  title: string;
  template: string;    // built-in template id OR relative path to extension HTML
  autoHide?: number;   // ms; 0 = stay visible
  priority?: number;   // higher wins region conflicts
}

interface OverlaySlot extends OverlayRegistration {
  extensionId: string;
  data?: Record<string, unknown>;
  visible: boolean;
}

/** WebSocket protocol: server → host SPA */
type OverlayServerMessage =
  | { type: 'connected';           overlays: OverlaySlot[] }
  | { type: 'overlay:registered';  overlay: OverlaySlot }
  | { type: 'overlay:update';      id: string; data: Record<string, unknown> }
  | { type: 'overlay:show';        id: string }
  | { type: 'overlay:hide';        id: string }
  | { type: 'overlay:unregistered'; id: string };
```

There is no client → server message in the protocol today; the host
SPA is purely a renderer of server-pushed state. The server also sends
a periodic WebSocket `ping` every 30 s.

## Extension manifest

The `package.json` of every built-in extension. Loaded by
`ExtensionScanner` (`src/main/extension-host/extension-scanner.ts`).

```ts
interface ExtensionManifest {
  name: string;
  displayName?: string;
  version: string;
  main: string;              // relative path to compiled JS entry
  description?: string;
  /** Prose injected into the Planner LLM prompt. */
  aiContext?: string;
  contributes?: {
    intents?:   IntentContribution[];
    commands?:  CommandContribution[];
    events?:    EventContribution[];
    settings?:  Record<string, unknown>;
    views?:     ViewsContribution | ViewContribution[];   // object (spec) or array (legacy)
    overlays?:  OverlayManifestContribution[];
  };
}

interface IntentContribution {
  intent: string;
  title: string;
  description?: string;
  /** broadcast = sequence-able; operational/query = excluded from capabilities. */
  category?: 'broadcast' | 'operational' | 'query';
  schema?: object;           // JSON Schema for payload
}

interface EventContribution {
  event: string;
  title: string;
  description?: string;
  schema?: object;
}

interface ViewsContribution {
  dashboard?: { component: string };
  sidebar?:   { label: string; icon: string; target: string };
  panels?:    { id: string; component: string; title: string }[];
}

interface OverlayManifestContribution {
  id: string;
  region: string;            // OverlayRegion at runtime
  title: string;
  template: string;
  autoHide?: number;
  priority?: number;
}
```

`commands` is legacy and no longer dispatched (the `EXECUTE_COMMAND`
IPC type was removed); manifests can still declare it but the
`CommandRegistry` is dead. New extensions should not use it.
