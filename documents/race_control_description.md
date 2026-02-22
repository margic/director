---

## Race Control API — Context for Director Client Integration

### What Is Race Control?

Race Control is the backend API (Azure Functions + Cosmos DB) for **Sim RaceCenter**. It manages race sessions, drivers, rigs, OBS scenes, and centers. Its primary consumer is the **Sim RaceCenter Director** — an Electron app that automates broadcast direction for iRacing events.

The API is hosted on Azure Static Web Apps with a Functions backend. Authentication uses **Microsoft Entra ID** (via Azure SWA Easy Auth in production, Bearer JWT in development). Director endpoints require the `RaceDirector` role and center-scoped access.

---

### Director-Relevant API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/director/v1/sessions` | List sessions for the director's center. Query: `centerId`, `status?` |
| `GET` | `/api/director/v1/sessions/{id}/sequences/next` | Poll for the next AI-generated sequence. Query: `lastSequenceId?`, `format?` (`legacy`\|`portable`) |
| `GET` | `/api/director/v1/sequences` | List the portable sequence library. Query: `centerId?`, `category?` (`cloud`\|`builtin`\|`custom`) |
| `GET` | `/api/director/v1/sequences/{id}` | Get a specific portable sequence by ID |
| `POST` | `/api/director/v1/sessions/{id}/commands` | Queue an async command (TTS/overlay) into the next sequence |
| `GET` | `/api/auth/user` | Get authenticated user profile with roles and permissions |

---

### Two Sequence Formats

The API serves sequences in two formats. The Director already supports both via its `normalizeApiResponse()` adapter.

#### 1. Legacy Format (`DirectorSequence`) — Current Default

```typescript
interface DirectorSequence {
  sequenceId: string;
  raceSessionId: string;
  commands: DirectorCommand[];
  totalDurationMs: number;
  generatedAt: string;
}

interface DirectorCommand {
  commandType: 'SWITCH_CAMERA' | 'PLAY_AUDIO' | 'SHOW_OVERLAY' | 'HIDE_OVERLAY' | 'TTS_MESSAGE' | 'EXECUTE_SEQUENCE';
  target: {
    carIndex?: number;
    carNumber?: string;
    driverName?: string;
    cameraGroupName?: string;
    cameraGroupNumber?: number;
    sceneType?: string;
    obsSceneId?: string;
    sequenceId?: string;       // For EXECUTE_SEQUENCE
    variables?: Record<string, any>; // For EXECUTE_SEQUENCE
    [key: string]: any;
  };
  durationMs?: number;
  offsetMs: number;
}
```

#### 2. Portable Format (`PortableSequence`) — Modern, Opt-In via `format=portable`

```typescript
interface PortableSequence {
  id: string;
  name: string;
  version: string;
  description?: string;
  category: 'cloud' | 'builtin' | 'custom';
  priority: boolean;            // true = execute even during auto-director loop
  centerId?: string;
  variables?: SequenceVariable[];
  steps: SequenceStep[];
  createdAt?: string;
  updatedAt?: string;
}

interface SequenceStep {
  id: string;
  intent: string;               // Semantic: "obs.switchScene", "broadcast.showLiveCam", etc.
  payload: Record<string, any>; // Supports $var(name) substitution
  metadata?: { label?: string; timeout?: number; [key: string]: any };
}

interface SequenceVariable {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'sessionTime' | 'sessionTick';
  required: boolean;
  source: 'context' | 'user';
  contextKey?: string;          // e.g., "iracing.drivers"
  defaultValue?: any;
}
```

---

### How the Director Consumes Sequences Today

1. **Director Loop** (`DirectorService.loop()`) polls `GET .../sequences/next` using adaptive intervals:
   - **204 No Content** → wait 5s (idle)
   - **200 OK** → normalize response → execute → wait `totalDurationMs` or 100ms
2. **Normalization** — `normalizeApiResponse()` in `DirectorService` maps legacy `DirectorCommand` types to semantic intents via `LEGACY_INTENT_MAP`:
   - `SWITCH_CAMERA` → `broadcast.showLiveCam`
   - `SWITCH_OBS_SCENE` → `obs.switchScene`
   - `DRIVER_TTS` → `communication.announce`
   - `VIEWER_CHAT` → `communication.talkToChat`
3. **Execution** — `SequenceExecutor.execute(portable)` dispatches each step's `intent` to the Extension Host. Built-in `system.wait` and `system.log` are handled internally; all others go to registered extension intent handlers.
4. **Manual execution** — `executeSequenceById(id)` fetches a specific portable sequence from the library and executes it directly.

---

### Intent Catalog (Extension-Provided)

| Intent | Extension | Payload |
|--------|-----------|---------|
| `broadcast.showLiveCam` | iRacing | `{ carNum, camGroup }` |
| `obs.switchScene` | OBS | `{ sceneName, transition?, duration? }` |
| `communication.announce` | Discord | `{ message }` |
| `communication.talkToChat` | YouTube | `{ message }` |
| `system.wait` | Built-in | `{ durationMs }` |
| `system.log` | Built-in | `{ message, level }` |

---

### Key Architectural Details

- **Auth header**: `Authorization: Bearer <token>` (Entra ID access token). The API also reads `x-ms-client-principal` from SWA Easy Auth.
- **API base URL**: Configured in Director's `auth-config.ts` as `apiConfig.baseUrl` + `apiConfig.endpoints.*`.
- **Center-scoped**: Director endpoints verify the user's `centerId` matches the session's `centerId`. Sessions from other centers are filtered out.
- **Command Buffer**: External agents (chat bots, AI) inject commands via `POST .../commands`. These get interlaced into the next auto-generated sequence based on priority (1-10, lower = higher priority).
- **Cosmos DB Change Feed** publishes session changes to Azure Event Hub for external consumers.

---

### What We're Negotiating: Updated Sequence Feature

We are aligning the Race Control API's sequence output with what the Director's Sequence Executor natively consumes. The goal is to reduce or eliminate the client-side normalization layer by having the API serve `PortableSequence` as the primary format. Key discussion areas:

1. **Default format migration** — Moving from legacy to portable as the default `format` parameter
2. **Intent naming alignment** — Ensuring API intent names match the Director's registered extension intents (currently there's a mismatch: API uses `broadcast.switchCamera` while Director maps to `broadcast.showLiveCam`)
3. **Sequence library CRUD** — Whether the API should support creating/updating portable sequences (currently read-only)
4. **Variable resolution contract** — Cloud AI sends sequence ID + variable bindings; Director resolves `$var()` from live telemetry. Need to finalize which variables the API populates vs. which the Director resolves
5. **`EXECUTE_SEQUENCE` command** — How the Director fetches and executes a referenced sequence by ID with variable bindings


---



---

## Opening Statement: Race Control API — Sequence Generation for the Director

### Who We Are

Race Control is the cloud backend for Sim RaceCenter. We generate broadcast sequences, manage the sequence library, and serve as the AI Director brain — analyzing live telemetry to decide what the audience should see. The **Sim RaceCenter Director** is our sole consumer for real-time sequence execution.

We are pre-release. Nothing is frozen. This RFC exists to align our output with what the Director actually executes, eliminating unnecessary translation layers and establishing a shared contract we both commit to.

---

### What Race Control Does Today

**On every poll** to `GET /api/director/v1/sessions/{id}/sequences/next`, Race Control:

1. **Authenticates** the caller (Entra ID, `RaceDirector` role, center-scoped)
2. **Loads the race session** and its configured drivers, rigs, and OBS scene mappings
3. **Queries 5 seconds of telemetry** from Cosmos DB (gap data, positions, track surface)
4. **Scores each configured driver** by proximity — close gaps produce `battle_ahead`/`battle_behind` scores; isolated drivers get `lonely`
5. **Selects a target driver** (best score) and a **scene type** (Forward / Rear / General)
6. **Selects a camera group** via weighted-random from the center's `CameraSettings` (forward, rear, general pools)
7. **Resolves the OBS scene** — defaults to `directorSceneId` unless it's a cockpit cam mapped to a specific driver's scene
8. **Pops pending commands** — atomically dequeues async commands (TTS, overlays) injected by chat bots or AI agents
9. **Builds the sequence** — a primary `SWITCH_CAMERA` command plus interlaced pending commands at priority-based offsets (0ms / 2s / 4s)
10. **Persists** the sequence to Cosmos DB for audit
11. **Returns** the sequence in either legacy or portable format

**The Sequence Library** (`GET /api/director/v1/sequences`) serves pre-configured portable sequences that can be fetched by ID and executed manually or referenced via `EXECUTE_SEQUENCE`.

---

### The Format Gap We Need to Close

Race Control currently generates sequences internally using the **legacy `DirectorSequence`** format and optionally converts to `PortableSequence` on the way out. Meanwhile, the Director's Sequence Executor natively operates on `PortableSequence`. This creates two problems:

**Problem 1: Double conversion.** Race Control builds legacy → converts to portable. The Director receives legacy (default) → normalizes to portable. The portable format should be the native wire format.

**Problem 2: Intent name mismatch.** The two sides independently defined intent mappings and they don't agree:

| Command | Race Control API Intent | Director Client Intent |
|---------|------------------------|----------------------|
| Switch camera | `broadcast.switchCamera` | `broadcast.showLiveCam` |
| Switch OBS scene | *(embedded in SWITCH_CAMERA target)* | `obs.switchScene` |
| TTS | `broadcast.tts` | `communication.announce` |
| Chat message | *(not mapped)* | `communication.talkToChat` |

These are cosmetic differences, but they mean every sequence requires a client-side translation table. We should agree on canonical intent names once and use them end-to-end.

---

### Race Control's Proposal

**1. PortableSequence becomes the sole wire format.**
We stop generating legacy `DirectorSequence` internally. The AI Director engine builds `PortableSequence` directly. The `format` query parameter is deprecated — clients always receive portable. Legacy support is dropped (pre-release, no backward-compat obligation).

**2. We agree on a shared Intent Registry.**
Race Control proposes these canonical intent names, but we're open to adopting the Director's existing naming if it's better established:

| Intent | Domain | Description |
|--------|--------|-------------|
| `broadcast.switchCamera` | iRacing | Change the in-sim camera target + group |
| `obs.switchScene` | OBS | Switch the OBS scene |
| `broadcast.tts` | Audio | Text-to-speech announcement |
| `broadcast.chat` | Chat | Send a message to stream chat |
| `overlay.show` / `overlay.hide` | Graphics | Control broadcast overlays |
| `sequence.execute` | Meta | Execute a referenced sequence by ID |
| `system.wait` / `system.log` | Built-in | Timing and logging |

**3. SWITCH_CAMERA no longer bundles OBS scene switching.**
Today, Race Control embeds `obsSceneId` inside the `SWITCH_CAMERA` command target. This conflates two independent operations. We propose emitting separate steps:
- Step 1: `obs.switchScene` with `{ sceneName }` 
- Step 2: `broadcast.switchCamera` with `{ carNum, camGroup, camGroupNum }`

This lets the Director's extension system handle each concern independently (OBS extension handles scene, iRacing extension handles camera).

**4. Payload field names align with the Director's extension expectations.**
The Director's iRacing extension expects `{ carNum, camGroup }`. Race Control currently sends `{ carNumber, cameraGroupName, cameraGroupNumber }`. We'll adopt whatever field names the Director's intent handlers actually consume.

**5. Sequence Library becomes read-write.**
Currently the library is read-only. We propose adding `POST /api/director/v1/sequences` and `PUT /api/director/v1/sequences/{id}` so sequences created in the Director's visual editor can be synced to the cloud for cross-device and team sharing.

**6. Variable resolution contract stays as-is.**
Race Control populates concrete values for AI-generated sequences (the AI already knows which driver to show). For library sequences with `$var()` placeholders, the Director resolves them locally from live telemetry — this is correct because temporal accuracy matters and the Director has the freshest data.

---

### What We Need From the Director Team

1. **Canonical intent names** — Which names are already wired into extension manifests? We'll adopt them rather than force a rename on the client side.
2. **Payload schemas per intent** — The exact field names and types each extension handler expects. We'll emit payloads that match exactly.
3. **`totalDurationMs` handling** — Today we send this as a top-level field so the Director knows how long to wait before the next poll. Should this become a `metadata` field on the sequence, or a separate response envelope field?
4. **204 vs empty sequence** — When there's nothing interesting to show, should we return `204 No Content` (current behavior when no telemetry) or a sequence with a single `system.wait` step? The latter is more self-describing.
5. **Sequence execute flow** — When we emit `sequence.execute` with a `{ sequenceId, variables }` payload, does the Director fetch the referenced sequence from our library endpoint, or should we inline the full sequence definition?

---

We're ready to adapt. The goal is: Race Control emits sequences that the Director can execute with zero normalization. Tell us what shape you need, and we'll build it.



