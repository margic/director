# Director Loop v2 — State Assessment & RFC Proposal

## 1. Current State Assessment

### 1.1 What Exists Today

The Director Loop (`DirectorService`) is the oldest feature in the codebase. It was built before the Extension System, before the Sequence Executor, before the Scheduler, and before the Portable Sequence format. It has been partially adapted but never properly re-architectured to sit on top of the modern execution stack.

**The core problem: `DirectorService` is a monolith that predates the modular architecture it should be built on.**

| Concern | Current Owner | Should Be |
|:---|:---|:---|
| API polling | `DirectorService.loop()` | Dedicated polling module |
| Session discovery | `DirectorService.listSessions()` | Session management module (shared with UI) |
| Sequence normalization | `DirectorService.normalizeApiResponse()` (private) | Shared adapter in `director-types.ts` (already exists, unused) |
| Sequence execution | `DirectorService` → own `SequenceExecutor` instance | Route through `SequenceScheduler` |
| Loop state (IDLE/BUSY/ERROR) | `DirectorService` internal fields | Unify with `SequenceScheduler` state |
| Start/stop control | `director:start` / `director:stop` IPC | Keep, but thin — delegates to orchestrator |
| Session selection | `sessions[0]` (naive) | User-selected or rule-based |

### 1.2 Architectural Sins

#### Sin 1: Bypasses the Scheduler
`DirectorService` instantiates its own `SequenceExecutor` and calls `executor.execute()` directly. This means:
- **No history**: Director-loop executions don't appear in `sequenceScheduler.getHistory()`, so the Sequences panel has no visibility into what the AI is doing.
- **No progress events**: The renderer never receives `sequence:progress` events during auto-director execution. The dashboard card is blind during the most important mode.
- **No variable resolution**: The `$var()` pipeline in the Scheduler is bypassed entirely.
- **No cancellation**: There's no way for the user to cancel a running cloud sequence.
- **No source tracking**: `ExecutionResult.source` supports `'director-loop'` but it's never used.

#### Sin 2: Duplicate Normalization
Three normalization paths exist:
1. `DirectorService.normalizeApiResponse()` — private method, handles `target` objects from the real API.
2. `normalizeApiSequence()` in `director-types.ts` — exported, handles legacy `DirectorSequence`, **never called by DirectorService**.
3. `normalizeNextSequenceResponse()` in `director-types.ts` — exported, wraps the polling response, **never called**.

The private one (#1) is the only one that actually works with the production API response shape, but it's locked inside the service.

#### Sin 3: Session Discovery Is Disconnected
`DirectorService.listSessions()` fetches sessions from Race Control. The Dashboard *also* polls sessions independently on a timer. Two separate polling loops, two separate state caches, no shared session management.

#### Sin 4: No Configuration
Poll intervals (`5000ms`, `100ms`), session selection strategy (`sessions[0]`), auto-start behavior — all hardcoded. No user-facing settings. No typed config schema entry for director settings.

#### Sin 5: Cloud Sequence Library Not Connected
`SequenceLibraryService` documents a `cloud` category but has zero implementation for fetching cloud sequences. The `GET /api/director/v1/sequences` endpoint exists in the Race Control description but the Director never calls it.

### 1.3 What Works Well

Despite the architectural gaps, the fundamentals are solid:

- **Adaptive polling** logic is correct and well-reasoned (5s idle, fast busy).
- **Legacy normalization** (private method) correctly maps `SWITCH_CAMERA` → `broadcast.showLiveCam` etc.
- **The Sequence Executor** is clean, headless, and properly intent-driven.
- **The Scheduler** has proper queueing, history, variable resolution, progress events, and cancellation.
- **The Extension System** provides the right abstraction for intent dispatch.
- **The dashboard** already shows director status and has a start/stop toggle.

The pieces are all there. They just aren't wired together.

---

## 2. The Multi-Simulator Problem

### Why the Cloud Is the Brain

A Sim RaceCenter facility can have **many simulator rigs** — potentially hundreds — running **simultaneously**. Each rig runs its own iRacing instance and publishes telemetry to the cloud. The Director app runs on the **media control rig** — a separate machine that controls OBS and sends camera commands to iRacing. Critically, **the media control rig does not receive or process telemetry from the simulator rigs.** The processing overhead of aggregating telemetry from potentially hundreds of simulators makes that infeasible at the edge.

This is the fundamental architectural constraint: **all race intelligence lives in the cloud. The Director is a command executor, not a decision maker.**

```
┌──────────────────────────────────────────────────────────────────┐
│                        RACE CONTROL (Cloud)                      │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ Session Mgmt │  │ AI Director  │  │ Telemetry Aggregation  │  │
│  │ (Cosmos DB)  │  │ (Sequence    │  │ (Event Hub — ALL rigs) │  │
│  │              │  │  Generator)  │  │                        │  │
│  └──────────────┘  └──────┬───────┘  └────────────▲───────────┘  │
│         ▲                 │                       │              │
│         │                 │ Sequences             │ Telemetry    │
│    Session &              │ (what to show,        │ (gaps, pos,  │
│    Config                 │  when to cut)         │  incidents)  │
└─────────┬─────────────────┼───────────────────────┼──────────────┘
          │                 │                       │
          │                 ▼                       │
┌─────────┴────────────────────────────┐   ┌───────┴──────────────────────────┐
│   MEDIA CONTROL RIG (Director App)   │   │      SIMULATOR RIGS (Many)       │
│                                      │   │                                  │
│  ┌────────────┐  ┌────────────┐      │   │  ┌────────┐ ┌────────┐ ┌──────┐ │
│  │  iRacing   │  │    OBS     │      │   │  │ Rig 1  │ │ Rig 2  │ │ ...  │ │
│  │  Extension │  │  Extension │      │   │  │iRacing │ │iRacing │ │      │ │
│  │ (commands  │  │ (scene     │      │   │  │Publish │ │Publish │ │      │ │
│  │  only)     │  │  switching)│      │   │  └────────┘ └────────┘ └──────┘ │
│  └─────┬──────┘  └─────┬──────┘      │   │                                  │
│        │               │             │   │  Telemetry goes UP to cloud,     │
│  ┌─────┴───┐  ┌────────┴────┐        │   │  NOT sideways to Director.       │
│  │Discord  │  │  YouTube    │        │   └──────────────────────────────────┘
│  │Extension│  │  Extension  │        │
│  └─────┬───┘  └──────┬──────┘        │
│        │             │               │
│        ▼             ▼               │
│  ┌───────────────────────────────┐   │
│  │  Sequence Executor + Scheduler│   │
│  │  (executes cloud sequences)   │   │
│  └───────────────────────────────┘   │
└──────────────────────────────────────┘
```

### The Director's Role: Pure Command Execution

The Director **does not know** who is in a battle, who is pitting, or where the action is. It has no telemetry. It receives a sequence from the cloud that says "switch to car 63 on TV1, wait 5 seconds, switch to car 17 on TV2" and it executes those commands against local hardware. The intelligence — driver scoring, camera selection, scene resolution — is entirely cloud-side.

The iRacing extension on the media control rig exists solely to:
- **Send camera commands** to the local iRacing instance (broadcast messages via `user32.dll`)
- **Send replay commands** (play, pause, seek, speed)
- **Detect if iRacing is running** (connection state)

The extension also currently reads iRacing shared memory for camera group names and driver lists. This local data has limited value — the cloud already knows the session configuration. However, it's useful for:
- Populating the manual camera control UI with named buttons instead of raw group numbers
- Confirming the local iRacing instance is connected to the expected session

> **Note on the current iRacing extension:** The extension emits `iracing.raceStateChanged` at 4Hz with positions, gaps, and lap times from shared memory. This telemetry data from a single spectator view is **not used by the director loop** and **not sent to the cloud.** It currently feeds only the local overlay system. In the context of the director loop, the only iRacing data that matters is **what the cloud tells us to do.**

### What the Cloud Provides (Everything the Director Can't Know Locally)
- **Cross-rig telemetry** — gaps, positions, incidents aggregated from ALL rigs
- **AI direction decisions** — which driver to show, when to cut, when to replay
- **Driver scoring** — proximity analysis, battle detection, "lonely" vs. "exciting" ratings
- **Session configuration** — driver-to-rig assignments, rig-to-OBS-scene mappings
- **Sequence generation** — complete executable sequences built from aggregated context
- **Command injection** — chat bots and external agents queue commands into the next sequence
- **Camera selection strategy** — weighted-random camera group selection from center configuration
- **OBS scene resolution** — decides which OBS scene to use based on camera type and driver mappings

### What the Director Provides (Local Hardware Control)
- **iRacing camera commands** — PostMessage to switch camera target and group
- **iRacing replay control** — play, pause, seek, speed
- **OBS scene switching** — WebSocket commands to the local OBS instance
- **Discord TTS** — voice announcements
- **YouTube chat** — stream chat messages
- **Overlay rendering** — broadcast graphics in the Electron overlay window
- **Connection state** — reports whether iRacing/OBS/Discord are available (capability reporting)

### Responsibility Matrix

| Concern | Owner | Why |
|:---|:---|:---|
| "Which driver is interesting?" | **Cloud** | Requires aggregated telemetry from all rigs |
| "Which camera group to use?" | **Cloud** | Uses center's camera weight config + scene type logic |
| "Which OBS scene to show?" | **Cloud** | Maps driver → rig → OBS scene from session config |
| "Switch camera to car 63, TV1" | **Director** | Sends `PostMessageA` to local iRacing |
| "Switch OBS to Race Cam" | **Director** | Sends WebSocket command to local OBS |
| "Is iRacing running?" | **Director** | Checks for simulator window locally |
| "Is OBS connected?" | **Director** | WebSocket connection state |
| "What camera groups exist?" | **Both** | Cloud has config, Director can read shared memory for UI |
| "Build next broadcast sequence" | **Cloud** | AI Director engine — the core intelligence |

---

## 3. Proposed Architecture: Director Loop v2

### 3.1 Design Principles

| Principle | Description |
|:---|:---|
| **Route Everything Through the Scheduler** | The director loop is a *producer* of sequences for the Scheduler, not a parallel executor. |
| **Unified Execution History** | All sequences — manual, cloud, event-triggered — flow through one path and appear in one history. |
| **Cloud as Intelligence, Local as Execution** | The API decides *what* to do. The Director decides *how* to do it. |
| **Session as Context** | The active session provides configuration context (drivers, OBS mappings). It's a container, not a controller. |
| **Observable** | Every state change (loop state, session, polling result) is evented and visible in the UI. |

### 3.2 Component Decomposition

The monolithic `DirectorService` is decomposed into focused modules:

```
┌─────────────────────────────────────────────────────────┐
│                    DirectorOrchestrator                  │
│         (Thin coordinator — start/stop/status)          │
│                                                         │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ SessionManager│  │  CloudPoller  │  │ EventMapper  │  │
│  │               │  │              │  │              │  │
│  │ - discover    │  │ - adaptive   │  │ - event →    │  │
│  │ - select      │  │   polling    │  │   sequence   │  │
│  │ - subscribe   │  │ - normalize  │  │   triggers   │  │
│  │   to changes  │  │ - enqueue    │  │              │  │
│  └───────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│          │                 │                 │           │
│          ▼                 ▼                 ▼           │
│  ┌──────────────────────────────────────────────────┐   │
│  │              SequenceScheduler                    │   │
│  │  (Queue, History, Variables, Progress, Cancel)   │   │
│  └──────────────────────┬───────────────────────────┘   │
│                         │                               │
│                         ▼                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │              SequenceExecutor                     │   │
│  │         (Headless intent dispatch)               │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

#### `DirectorOrchestrator` (replaces `DirectorService`)
- Thin coordinator. Owns lifecycle (start/stop) and aggregated status.
- Delegates all real work to sub-modules.
- Emits unified state events to the renderer.

#### `SessionManager` (extracted from `DirectorService`)
- Discovers sessions from Race Control API.
- Manages session selection (user picks or auto-selects).
- Shares session state with the dashboard (single source of truth — no dual polling).
- Publishes session config (driver mappings, OBS host) to interested modules.

#### `CloudPoller` (extracted from `DirectorService.loop()`)
- **Event-driven fetch-on-completion model**: requests the next sequence only when the executor signals that the previous sequence has completed.
- On start, makes a single initial fetch.
- On 200 (sequence received): delivers to SequenceScheduler, then **waits** for `onSequenceCompleted()` — no further fetching until signalled.
- On 204 (no sequence available): schedules a single retry respecting `Retry-After` or `idleRetryMs`.
- Normalizes API responses (legacy or portable format) via the shared adapter.
- **Enqueues** sequences into `SequenceScheduler` with `source: 'director-loop'`.
- Does NOT execute sequences directly.

#### `EventMapper` (already exists, enhanced)
- Maps extension events (e.g., `iracing.flagChanged`) to sequence executions.
- Enqueues via `SequenceScheduler` with `source: 'event-trigger'`.

#### `SequenceScheduler` (already exists, unmodified)
- Single execution funnel for all sources.
- Queue, history, progress events, variable resolution, cancellation.

#### `SequenceExecutor` (already exists, unmodified)
- Headless intent dispatch. No changes needed.

### 3.3 State Model

```typescript
interface DirectorLoopState {
  // Orchestrator state
  mode: 'stopped' | 'manual' | 'auto';    // replaces isRunning + status

  // Session state  
  session: {
    status: 'searching' | 'discovered' | 'selected' | 'none';
    available: RaceSession[];
    active: RaceSession | null;            // user-selected or auto-selected
  };

  // Cloud poller state
  poller: {
    status: 'idle' | 'polling' | 'waiting' | 'error' | 'disabled';
    lastPollAt: string | null;
    lastSequenceId: string | null;
    nextPollIn: number;                    // ms until next poll
    consecutiveErrors: number;
    lastError: string | null;
  };

  // Delegated to scheduler (already exists)
  execution: {
    isExecuting: boolean;
    queue: QueuedSequence[];
    history: ExecutionResult[];            // unified — manual + cloud + event
  };
}
```

### 3.4 Mode Definitions

| Mode | Description | CloudPoller | Manual Sequences | EventMapper |
|:---|:---|:---|:---|:---|
| **stopped** | Director is off. No polling, no execution. | Disabled | Disabled | Disabled |
| **manual** | User triggers sequences from the UI, Stream Deck, or webhooks. No cloud polling. | Disabled | Enabled | Enabled |
| **auto** | Full AI director mode. Cloud generates sequences. Manual sequences can still be invoked (priority flag controls interruption). | Enabled | Enabled (priority) | Enabled |

### 3.5 Sequence Flow: Auto Mode

```
     Race Control Cloud
            │
            │  POST .../sequences/next
            ▼
     ┌──────────────┐
     │  CloudPoller  │      ◄──── onSequenceCompleted(seqId)
     │  normalize()  │                      │
     │  enqueue()    │                      │
     └──────┬───────┘                      │
            │  PortableSequence             │
            │  { source: 'director-loop' }  │
            ▼                               │
     ┌──────────────────┐                  │
     │SequenceScheduler │                  │
     │  resolveVars()   │ ─── historyChanged ──► Orchestrator
     │  emit progress   │    (completion)
     │  track history   │
     └──────┬───────────┘
            │
            ▼
     ┌──────────────────┐
     │SequenceExecutor  │
     │  step-by-step    │
     │  intent dispatch │
     └──────┬───────────┘
            │
     ┌──────┴───────────────────────┐
     │              │               │
     ▼              ▼               ▼
  iRacing        OBS          Discord
  Extension    Extension      Extension
```

The flow is event-driven: CloudPoller fetches once, delivers the sequence, and
**waits** until the Orchestrator signals `onSequenceCompleted()` (wired via a
single `historyChanged` listener on the SequenceScheduler). Only then does it
fetch the next sequence. There is no timer-based polling during active execution.

### 3.6 Priority Interruption

When the cloud sends a sequence with `priority: true` (or `priority: 'URGENT'`), the Scheduler already supports priority execution (parallel fire-and-forget). This covers the scenario where the AI detects an incident and needs to immediately interrupt the current sequence.

**Enhancement needed:** The Scheduler's `executePriority()` currently runs in parallel — it should optionally *cancel* the current sequence and *replace* it, rather than running alongside it. Two cameras switching at once is not useful.

---

## 4. RFC Negotiation: Director Response to Race Control Opening Statement

> Race Control's opening statement is in `race_control_description.md` §"Opening Statement". They describe their current generation pipeline, propose 6 changes, and ask 5 questions. This section is the Director team's formal response.

### 4.1 Points of Agreement

We agree with Race Control on the structural direction. Specifically:

| RC Proposal | Director Position |
|:---|:---|
| **1. PortableSequence as sole wire format** | **Agreed. Strongly.** We will delete `normalizeApiResponse()`, `normalizeApiSequence()`, `normalizeNextSequenceResponse()`, and the `LEGACY_INTENT_MAP` once portable is the only format. No migration period — both sides are pre-release, drop legacy now. |
| **3. Unbundle SWITCH_CAMERA from OBS scene** | **Agreed.** This is exactly right. Today RC embeds `obsSceneId` inside the camera command target, and the Director has to pick it apart. Separate steps = separate extension concerns. The iRacing extension handles `broadcast.showLiveCam`, the OBS extension handles `obs.switchScene`. Clean. |
| **4. Payload field names match Director handlers** | **Agreed.** We provide the exact schemas below in §4.3. |
| **5. Sequence Library read-write** | **Agreed.** We need read immediately, write is a future goal. |
| **6. Variable resolution stays as-is** | **Agreed with clarification.** Cloud pre-resolves AI decisions. However, the Director's ability to resolve `$var()` from local context is **extremely limited** — the media control rig has no telemetry. Local context resolution is restricted to: iRacing connection state, OBS scene list, camera group names (if shared memory is accessible). For auto-director sequences, **RC should pre-resolve all values.** Variables only remain unresolved for library sequences invoked manually, where the user provides input via the runtime variables form. |

### 4.2 Intent Name Resolution — The Key Negotiation

Race Control's proposal #2 asks: whose intent names are canonical? **They offered to adopt ours.** We accept that offer. The Director's extension manifests are the source of truth since they define the actual runtime handlers.

However, there are naming gaps to resolve. Below is the proposed **Shared Intent Registry** — covering what both sides currently use, and closing the gaps.

#### Agreed Intents (Both Sides Rename Where Needed)

| Canonical Intent | Domain | RC Currently Uses | Director Currently Uses | Who Changes |
|:---|:---|:---|:---|:---|
| `broadcast.showLiveCam` | iRacing | `broadcast.switchCamera` | `broadcast.showLiveCam` | **RC renames** |
| `obs.switchScene` | OBS | *(embedded in SWITCH_CAMERA)* | `obs.switchScene` | **RC emits as separate step** |
| `communication.announce` | Discord/TTS | `broadcast.tts` | `communication.announce` | **RC renames** |
| `communication.talkToChat` | YouTube | *(not mapped)* | `communication.talkToChat` | **RC adds** |
| `system.wait` | Built-in | `system.wait` | `system.wait` | No change |
| `system.log` | Built-in | `system.log` | `system.log` | No change |

#### New Intents to Agree On

These are proposed by Race Control but don't yet exist in the Director's extension manifests. We need to decide: adopt, rename, or defer.

| RC Proposed | Director Assessment | Decision |
|:---|:---|:---|
| `overlay.show` / `overlay.hide` | The Director has an overlay system but it's driven by extension events, not intents. No intent handler is registered. | **Adopt** — We will register `overlay.show` and `overlay.hide` as built-in intents in the executor (like `system.wait`). Payload: `{ overlayId: string, data?: Record<string, any> }`. RC can emit these. |
| `sequence.execute` | This is a meta-intent: "fetch sequence X from library and run it." The Director needs this for the cloud to reference library sequences. | **Adopt as `system.executeSequence`** — Stays in the `system.*` namespace because it's a built-in executor concern, not an extension intent. Payload: `{ sequenceId: string, variables?: Record<string, any> }`. The executor fetches from the library service and enqueues. |
| `broadcast.chat` | RC proposed this. Director already has `communication.talkToChat` (YouTube extension). Same operation. | **Use `communication.talkToChat`** — The `communication.*` domain is for audience-facing messages regardless of platform. RC should not use `broadcast.*` for chat. |
| `audio.play` | Director has this in the legacy intent map but no extension implements it. | **Defer** — No handler exists. Don't emit sequences with this intent. When an audio extension is built, it will register the intent and report it via capabilities. |

#### Finalized Shared Intent Registry

This is the canonical registry both sides commit to:

| Intent | Domain | Owner | Payload Schema | Status |
|:---|:---|:---|:---|:---|
| `broadcast.showLiveCam` | Simulator | iRacing ext | `{ carNum: string, camGroup?: string, camNum?: string }` | **Live** — handler registered |
| `broadcast.replayFromTo` | Simulator | iRacing ext | `{ startFrame: number, endFrame: number, speed?: number }` | **Live** — handler registered |
| `broadcast.setReplaySpeed` | Simulator | iRacing ext | `{ speed: number }` | **Live** — handler registered |
| `broadcast.setReplayPosition` | Simulator | iRacing ext | `{ frame: number }` | **Live** — handler registered |
| `broadcast.setReplayState` | Simulator | iRacing ext | `{ state: number }` | **Live** — handler registered |
| `obs.switchScene` | Broadcast | OBS ext | `{ sceneName: string, transition?: string, duration?: number }` | **Live** — handler registered |
| `obs.getScenes` | Broadcast | OBS ext | `{}` | **Live** — handler registered |
| `communication.announce` | Audience | Discord ext | `{ message: string }` | **Live** — handler registered |
| `communication.talkToChat` | Audience | YouTube ext | `{ message: string }` | **Live** — handler registered |
| `overlay.show` | Graphics | Built-in | `{ overlayId: string, data?: Record<string, any> }` | **Planned** — register in executor |
| `overlay.hide` | Graphics | Built-in | `{ overlayId: string }` | **Planned** — register in executor |
| `system.wait` | Control | Built-in | `{ durationMs: number }` | **Live** — built-in handler |
| `system.log` | Control | Built-in | `{ message: string, level?: 'INFO' \| 'WARN' \| 'ERROR' }` | **Live** — built-in handler |
| `system.executeSequence` | Control | Built-in | `{ sequenceId: string, variables?: Record<string, any> }` | **Planned** — register in executor |

**Rule:** Race Control MUST NOT emit intents that are not in this registry. If a new intent is needed, both teams agree on it and the Director registers a handler first. RC can discover available intents via capability reporting (§4.5).

### 4.3 Payload Schemas — Exact Field Names

Race Control asked for exact field names and types per intent. Here they are, extracted directly from the extension manifests (`package.json`) and `registerIntentHandler()` calls in the source code.

#### `broadcast.showLiveCam`
```typescript
// iRacing extension — src/extensions/iracing/package.json
// Handler: src/extensions/iracing/index.ts line 156
{
  carNum: string;      // Car number (e.g., "63") — REQUIRED
  camGroup?: string;   // Camera group name (e.g., "TV1", "Cockpit") — optional
  camNum?: string;     // Specific camera within group — optional
}
```
**Important:** Field is `carNum` (not `carNumber`), `camGroup` (not `cameraGroup` or `cameraGroupName`). RC must use exactly these names.

#### `broadcast.replayFromTo`
```typescript
{
  startFrame: number;  // Start frame number — REQUIRED
  endFrame: number;    // End frame number — REQUIRED
  speed?: number;      // Playback speed multiplier — optional
}
```

#### `obs.switchScene`
```typescript
// OBS extension — src/extensions/obs/package.json
// Handler: src/extensions/obs/index.ts line 36
{
  sceneName: string;   // Scene name (e.g., "Race Cam") — REQUIRED
  transition?: string; // Transition override — optional
  duration?: number;   // Transition duration in ms — optional
}
```
**Important:** Field is `sceneName` (not `obsSceneId` or `sceneType`).

#### `communication.announce`
```typescript
// Discord extension — src/extensions/discord/package.json
{
  message: string;     // Text to speak/announce — REQUIRED
}
```

#### `communication.talkToChat`
```typescript
// YouTube extension — src/extensions/youtube/package.json
{
  message: string;     // Chat message text — REQUIRED
}
```

### 4.4 Answers to Race Control's 5 Questions

#### Q1: `totalDurationMs` handling

> *Should this become a `metadata` field on the sequence, or a separate response envelope field?*

**Answer: Sequence metadata.** This is particularly important because **the Director has no telemetry context** — it cannot independently judge how long a sequence should hold before requesting the next one. The cloud must tell it. We already map it there:

```typescript
// Current DirectorService.normalizeApiResponse()
metadata: {
  priority: apiData.priority,
  generatedAt: apiData.generatedAt,
  totalDurationMs: apiData.totalDurationMs,
}
```

This belongs on the `PortableSequence` because it's a property of the sequence, not the transport. With the event-driven fetch-on-completion model, `totalDurationMs` is no longer used for poll pacing — the CloudPoller simply waits for `onSequenceCompleted()` before fetching the next sequence. The field is retained for UI display (progress estimation, activity overlays) and telemetry.

**Proposed shape in PortableSequence:**
```typescript
interface PortableSequence {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  category?: 'cloud' | 'builtin' | 'custom';
  priority?: boolean;
  variables?: SequenceVariable[];
  steps: SequenceStep[];
  metadata?: {
    totalDurationMs?: number;     // Hint for poll pacing
    generatedAt?: string;         // ISO8601 timestamp
    source?: string;              // "ai-director", "library", "command-buffer"
    [key: string]: unknown;       // Extensible
  };
}
```

#### Q2: 204 vs. Empty Sequence

> *When there's nothing interesting to show, should we return `204 No Content` or a sequence with a single `system.wait` step?*

**Answer: 204 No Content.** Reasons:

1. **The Director already handles 204 correctly** — it triggers the idle polling interval (5s). A `system.wait` sequence would be treated as a valid execution, appear in history, emit progress events — all noise.
2. **Semantic clarity** — "no content" means "I have nothing for you" which is true. A `system.wait` sequence is a lie: it says "execute this thing" when there's nothing to execute.
3. **History cleanliness** — Under auto-director, the Director may poll hundreds of times per session. Filling the execution history with "AI said wait" entries would bury real sequence results.
4. **Polling interval control** — If RC wants to vary the idle poll delay, we'd accept a `Retry-After` header on the 204 response. This is cleaner than encoding pacing in a fake sequence.

**Proposed 204 response:**
```
HTTP/1.1 204 No Content
Retry-After: 5
```

The `Retry-After` header (in seconds) lets RC dynamically adjust idle poll intervals. If absent, the Director uses its default (5s).

#### Q3: `totalDurationMs` as poll pacing

Already answered in Q1. The sequence's `metadata.totalDurationMs` controls the delay before the next poll after a successful execution. The 204 `Retry-After` header controls the delay during idle.

#### Q4: Sequence Execute Flow

> *When we emit `sequence.execute` with `{ sequenceId, variables }`, does the Director fetch from the library endpoint, or should RC inline the full sequence?*

**Answer: The Director fetches.** Flow:

1. RC emits a step: `{ intent: "system.executeSequence", payload: { sequenceId: "seq_123", variables: { driverNumber: "63" } } }`
2. The Director's executor hits the built-in `system.executeSequence` handler.
3. Handler calls `sequenceLibraryService.getSequence("seq_123")` — checks local cache first, then fetches from `GET /api/director/v1/sequences/seq_123`.
4. Resolves variables, enqueues into the Scheduler.

**Why fetch, not inline:**
- Sequences can be large (many steps). Inlining bloats every poll response.
- The library provides version control — the Director always gets the latest definition.
- The Director may already have the sequence cached from a previous library sync.

**RC must ensure:** The `GET /api/director/v1/sequences/{id}` endpoint returns a valid `PortableSequence`. This endpoint must be in the OpenAPI spec.

#### Q5: Payload field name adoption

> *We'll adopt whatever field names the Director's intent handlers actually consume.*

**Answer: Provided in §4.3 above.** The critical renames for RC:

| RC Field | Director Field | Context |
|:---|:---|:---|
| `carNumber` | `carNum` | `broadcast.showLiveCam` |
| `cameraGroupName` / `cameraGroup` | `camGroup` | `broadcast.showLiveCam` |
| `cameraGroupNumber` | `camNum` (if used) | `broadcast.showLiveCam` |
| `obsSceneId` | `sceneName` | `obs.switchScene` |
| `sceneType` | *(drop)* | Was used for OBS scene selection — now RC resolves the scene name |
| `text` | `message` | `communication.announce`, `communication.talkToChat` |

### 4.5 Director Capability Reporting

Race Control's opening statement doesn't mention this, but it's critical. Because the Director has **no telemetry and no race intelligence**, the only useful information it can contribute to the cloud is **what hardware it can currently control.** This is the Director's side of the conversation — "I can't tell you who to show, but I can tell you what I'm able to do."

**Problem:** RC currently generates sequences blind. If OBS is disconnected, RC still emits `obs.switchScene` steps. The Director soft-fails them (skips with a warning), but the AI is wasting a camera cut opportunity it could have filled with a different action.

**Proposal: Inline on each poll request.**

```
GET /api/director/v1/sessions/{id}/sequences/next
  ?lastSequenceId=abc-123
  &intents=broadcast.showLiveCam,obs.switchScene,communication.announce,system.wait,system.log
```

The `intents` query parameter is a comma-separated list of currently active intent handlers. RC uses this to constrain sequence generation — only emit steps the Director can actually execute. This is the Director's **only feedback channel** to the cloud (besides consuming sequences). It answers: "Here's what I can do right now — build accordingly."

**Why query parameter, not heartbeat:**
- No additional endpoint or polling mechanism needed.
- Capabilities can change between polls (extension activated/deactivated).
- Updates are synchronous with the request that consumes them.
- URL length is not a concern — the intent list is small (10-15 short strings).

**RC acceptance criteria:** When generating a sequence, RC MUST only include steps whose `intent` is in the Director's reported `intents` list. If the list is absent (legacy Director), RC generates with all intents (backward-compat).

### 4.6 Command Buffer Format

Race Control's `POST .../commands` endpoint currently accepts `TTS_MESSAGE | SHOW_OVERLAY` with a custom schema. Since we're dropping legacy, this should use the shared intent vocabulary.

**Proposed:**
```json
POST /api/director/v1/sessions/{id}/commands
{
  "intent": "communication.announce",
  "payload": { "message": "Safety car deployed!" },
  "priority": 2
}
```

This is a `SequenceStep` with a priority. RC interlaces it into the next generated sequence at the appropriate offset. The Director executes it as a normal step — no special handling.

### 4.7 Items Needing Further Discussion

These are outstanding items that require input from both teams:

#### 1. Priority Semantics: Cancel-and-Replace vs. Parallel

The Director's Scheduler currently supports `priority: true` as "run in parallel with the current sequence." For broadcast, this is wrong — two sequences switching cameras simultaneously is chaos.

**Director proposes:** `priority: true` means **cancel the current sequence and run this one immediately.** The Scheduler's `executePriority()` method needs to call `cancelCurrent()` first.

**Question for RC:** What `priority` values does the AI emit, and when? Is it always boolean, or do you use the `LOW | NORMAL | HIGH | URGENT` enum from the current spec? We need to agree on one model.

#### 2. Session Lifecycle Push

The Director currently polls `GET /sessions` to discover active sessions. This is wasteful — sessions change infrequently.

**Director proposes:** RC exposes a lightweight session status mechanism. Options:

a. **Long-poll on sessions endpoint** — Director sends `If-None-Match` / `ETag`, RC returns 304 or updated list.
b. **Event on next-sequence endpoint** — If the session ends, RC returns a `410 Gone` instead of 204, signaling the Director to stop polling and re-discover.
c. **Cosmos Change Feed → webhook** — RC pushes session lifecycle events to a Director-registered webhook. (More complex, probably future.)

**Minimum viable:** Option (b) — the Director already polls this endpoint. Add `410 Gone` as a response code meaning "session is no longer active."

#### 3. PortableSequence in the OpenAPI Spec

The formal `openapi.yaml` only defines `DirectorSequence` / `DirectorCommand`. Now that we're committing to `PortableSequence` as the sole format, the spec needs:

- `PortableSequence` schema
- `SequenceStep` schema
- `SequenceVariable` schema
- Updated response types on `GET .../sequences/next`, `GET .../sequences`, `GET .../sequences/{id}`
- Removal of `DirectorCommandType`, `DirectorCommand`, `DirectorSequence` schemas (or deprecation)

**This is a blocking requirement.** The Director codes to the spec (per `copilot-instructions.md`). We cannot implement against the new contract until the spec reflects it.

#### 4. Session Context: Who Knows What?

The media control rig does NOT receive telemetry from the simulator rigs. The cloud is the sole aggregation point. The Director's local data is limited to connection state and hardware capability.

| Data | Director Has | RC Has | Source of Truth |
|:---|:---|:---|:---|
| Telemetry (gaps, positions, laps) | **No** — not received locally | Yes — aggregated from all rigs via Event Hub | **RC only** — this is the core reason the cloud exists |
| Driver-to-rig-to-OBS-scene mappings | No | Yes — session configuration | **RC only** — configured in Race Control portal |
| Which driver is interesting right now | No — no telemetry to analyze | Yes — AI scoring from aggregated data | **RC only** — the AI Director brain |
| Which camera group to use | No — only knows group names, not selection strategy | Yes — weighted-random from center camera config | **RC only** — the Director just executes the choice |
| Which OBS scene to switch to | No — doesn't know driver-to-scene mapping | Yes — resolves from session config | **RC only** — the Director just sends the command |
| Camera group names | Yes — can read from shared memory (UI convenience) | Yes — in session config | **RC is source of truth** — Director's local read is for UI labels only |
| Driver list (names, car numbers) | Yes — can read from shared memory (UI convenience) | Yes — in session config with rig mappings | **RC is source of truth** — Director's local read is for validation/UI only |
| OBS scene availability | Yes — OBS extension queries live | Yes — session config lists expected scenes | **Director confirms** — RC decides the scene, Director confirms it exists before switching |
| iRacing connection state | Yes — `FindWindowA` check | No — not visible to cloud | **Director only** — reported via capability reporting |
| OBS connection state | Yes — WebSocket state | No — not visible to cloud | **Director only** — reported via capability reporting |

---

## 5. Agreed Wire Format: PortableSequence

Based on the negotiation above, this is the committed wire format for the `GET .../sequences/next` response body (200 OK):

```typescript
interface PortableSequence {
  id: string;                                    // Unique sequence ID (uuid)
  name?: string;                                 // Human-readable name
  version?: string;                              // Semantic version
  description?: string;                          // What this sequence does
  category?: 'cloud' | 'builtin' | 'custom';    // Library category
  priority?: boolean;                            // true = cancel current + execute immediately
  variables?: SequenceVariable[];                // Unresolved variables (if any)
  steps: SequenceStep[];                         // Ordered execution steps
  metadata?: {
    totalDurationMs?: number;                    // Poll pacing hint
    generatedAt?: string;                        // ISO8601
    source?: string;                             // "ai-director" | "library" | "command-buffer"
    [key: string]: unknown;
  };
}

interface SequenceStep {
  id: string;                                    // Unique step ID (uuid)
  intent: string;                                // From the Shared Intent Registry (§4.2)
  payload: Record<string, any>;                  // Matches the intent's schema exactly
  metadata?: {
    label?: string;                              // Human-readable label for UI
    timeout?: number;                            // Max execution time in ms
    [key: string]: unknown;
  };
}

interface SequenceVariable {
  name: string;                                  // Variable identifier (alphanumeric, camelCase)
  label: string;                                 // Human-readable label for UI
  type: 'text' | 'number' | 'select' | 'boolean' | 'sessionTime' | 'sessionTick';
  required: boolean;
  defaultValue?: any;                            // Default if not provided
  source: 'cloud' | 'context' | 'user';         // Who resolves this
  contextKey?: string;                           // Dot-path for auto-population (limited — see note)
  constraints?: {
    min?: number;
    max?: number;
    options?: Array<{ label: string; value: string }>;
    pattern?: string;
  };
}
```

> **Variable source clarification:** For auto-director (cloud-generated) sequences, `source` should almost always be `'cloud'` — the AI pre-resolves all values because the Director has no telemetry to resolve from. `source: 'context'` is limited to what the local extensions can provide (camera group names, OBS scene list, iRacing connection state). `source: 'user'` is for manual execution via the runtime variables form. **RC should never send `$var()` placeholders in auto-director sequences expecting the Director to resolve telemetry values — the Director doesn't have them.**

**Example: AI-generated sequence (what RC returns):**
```json
{
  "id": "seq_ai_20260222_143012",
  "name": "Battle Cam — Car 63 vs Car 17",
  "priority": false,
  "steps": [
    {
      "id": "step_1",
      "intent": "obs.switchScene",
      "payload": { "sceneName": "Race Cam", "transition": "Cut" }
    },
    {
      "id": "step_2",
      "intent": "broadcast.showLiveCam",
      "payload": { "carNum": "63", "camGroup": "TV1" }
    },
    {
      "id": "step_3",
      "intent": "system.wait",
      "payload": { "durationMs": 5000 }
    },
    {
      "id": "step_4",
      "intent": "broadcast.showLiveCam",
      "payload": { "carNum": "17", "camGroup": "TV2" }
    },
    {
      "id": "step_5",
      "intent": "communication.talkToChat",
      "payload": { "message": "Close battle between Car 63 and Car 17! Gap: 0.3s" }
    }
  ],
  "metadata": {
    "totalDurationMs": 12000,
    "generatedAt": "2026-02-22T14:30:12.000Z",
    "source": "ai-director"
  }
}
```

No `commandType` enums. No `target` objects. No `offsetMs`. No `SWITCH_CAMERA` with embedded OBS scene IDs. Just intent + payload, matching the extension handler signatures exactly.

---

## 6. Implementation Plan

### Phase 1: Unify Execution Path (Internal — Director Only)
**Goal:** Route director-loop sequences through the Scheduler. No API changes needed.

1. Extract `CloudPoller` from `DirectorService.loop()`.
2. `CloudPoller.onSequence()` → `sequenceScheduler.enqueue(seq, {}, { source: 'director-loop' })`.
3. Remove direct `SequenceExecutor` usage from director layer.
4. Consolidate normalization into `director-types.ts` (merge the private method logic into the exported functions).
5. Director-loop sequences now appear in history, emit progress, support cancellation.

### Phase 2: Session Management (Internal — Director Only)
**Goal:** Single source of truth for session state.

1. Extract `SessionManager` from `DirectorService`.
2. Dashboard uses `SessionManager` state (no separate polling).
3. Session selection UI (if multiple active sessions exist).
4. Pass `status=ACTIVE` filter on session list queries.

### Phase 3: Director Orchestrator Shell (Internal — Director Only)
**Goal:** Clean public API for mode management.

1. Create `DirectorOrchestrator` as the thin coordinator.
2. Three modes: `stopped`, `manual`, `auto`.
3. IPC channels stay the same but delegate to orchestrator.
4. Add `director:mode` IPC for mode switching.
5. Add typed director config to `ConfigService` schema.

### Phase 4: API Contract (Joint — Both Teams)
**Goal:** Ship the agreed wire format.

1. RC updates `openapi.yaml` with `PortableSequence`, `SequenceStep`, `SequenceVariable` schemas.
2. RC updates `GET .../sequences/next` to return `PortableSequence` natively (no `format` parameter).
3. RC renames intents: `broadcast.switchCamera` → `broadcast.showLiveCam`, `broadcast.tts` → `communication.announce`.
4. RC unbundles SWITCH_CAMERA — emits separate `obs.switchScene` + `broadcast.showLiveCam` steps.
5. RC adopts Director payload field names (`carNum`, `camGroup`, `sceneName`, `message`).
6. Director adds `intents` query parameter to next-sequence polling.
7. Director deletes `normalizeApiResponse()`, `LEGACY_INTENT_MAP`, and all legacy normalization code.

### Phase 5: Cloud Sequence Library (Joint — Both Teams)
**Goal:** Connect the library's cloud tier.

1. RC adds `GET /api/director/v1/sequences` and `GET .../sequences/{id}` to the OpenAPI spec.
2. Director implements cloud fetch in `SequenceLibraryService`.
3. Director registers `system.executeSequence` built-in handler.
4. RC can emit `system.executeSequence` steps referencing library sequences.

### Phase 6: Overlay Intents & Command Buffer (Joint — Both Teams)
**Goal:** Complete the intent registry.

1. Director registers `overlay.show` and `overlay.hide` as built-in intents.
2. RC updates `POST .../commands` to accept `{ intent, payload, priority }` format.
3. RC interlaces command-buffer steps into generated sequences using semantic intents.

---

## 7. Open Items Tracker

| # | Item | Owner | Status | Blocking? |
|:---|:---|:---|:---|:---|
| 1 | `PortableSequence` schema in `openapi.yaml` | Race Control | Pending | **Yes** — Director codes to spec |
| 2 | Intent renames (`broadcast.switchCamera` → `broadcast.showLiveCam`, etc.) | Race Control | Pending | **Yes** — zero-normalization goal |
| 3 | Unbundle SWITCH_CAMERA from OBS scene | Race Control | Pending | **Yes** — separate extension concerns |
| 4 | Payload field name adoption (`carNum`, `sceneName`, `message`) | Race Control | Pending | **Yes** — handler compatibility |
| 5 | `intents` query parameter on next-sequence endpoint | Both | Proposed | No — graceful degradation |
| 6 | `Retry-After` header on 204 responses | Race Control | Proposed | No — Director has fallback |
| 7 | `410 Gone` for ended sessions | Race Control | Proposed | No — Director can re-discover |
| 8 | `system.executeSequence` built-in handler | Director | Planned | No — library sequences work without it |
| 9 | `overlay.show` / `overlay.hide` built-in handlers | Director | Planned | No — RC defers until Director registers |
| 10 | Sequence library endpoints in spec | Race Control | Pending | Yes — needed for Phase 5 |
| 11 | Command buffer format migration | Race Control | Proposed | No — current format still works |
| 12 | Priority semantics (cancel-and-replace vs. parallel) | Both | **Unresolved** | Yes — affects real-time behavior |

---

## 8. Summary

Both teams agree on the destination: **Race Control emits `PortableSequence` using the Director's canonical intents and payload schemas. The Director executes them with zero normalization.**

The fundamental architectural constraint is clear: **the Director has no telemetry.** It doesn't know who's in a battle, who's pitting, or what the flag state is. The cloud aggregates telemetry from potentially hundreds of rigs and makes all the intelligent decisions — which driver to show, which camera to use, which scene to switch to. The Director is a pure command executor: it receives sequences and dispatches them against local hardware (iRacing cameras, OBS scenes, Discord TTS, YouTube chat).

This clarifies every design decision:
- **Variables:** The cloud pre-resolves all values in auto-director sequences. No `$var()` placeholders expecting the Director to resolve telemetry data.
- **Capability reporting:** The Director's only contribution to the cloud is "here's what hardware I can control right now" via the `intents` query parameter.
- **`totalDurationMs`:** Essential — the Director has no context to estimate its own pacing. The cloud must tell it when to ask for the next sequence.
- **Session context:** Entirely cloud-owned. The Director doesn't understand sessions; it just executes sequences within them.

The negotiation surfaced one structural disagreement (priority semantics) and several items that need spec work before implementation can proceed. The critical path is:

1. **RC updates `openapi.yaml`** with PortableSequence schemas and updated response types.
2. **RC renames intents and unbundles SWITCH_CAMERA** in the sequence generator.
3. **Director unifies the execution path** (CloudPoller → Scheduler → Executor).
4. **Both sides delete legacy code** — RC drops legacy generation, Director drops normalization.

The cloud is the brain. The Director is the hands. The contract between them is now clearly defined — what remains is implementing it.
