# Race Control API — Formal Response to Director Loop v2 RFC

**From:** Race Control API Team  
**To:** Director Client Team  
**Date:** 2026-02-22  
**Re:** Director Loop v2 — State Assessment & RFC Proposal  
**Status:** Response to Director counter-proposal  

---

## 0. Executive Summary

We have reviewed the Director team's comprehensive RFC response. The document is excellent — the architectural self-assessment is honest, the multi-simulator constraint is clearly articulated, and the proposal is actionable. We accept the vast majority as-is.

**Key outcome:** Both teams commit to `PortableSequence` as the sole wire format using the Director's canonical intent names and payload schemas. Race Control will update its sequence generator, OpenAPI spec, and command buffer to match. Legacy types will be removed.

**Items requiring further discussion:** One (priority semantics). Everything else is accepted or accepted with minor clarifications.

---

## 1. Response to Director's Architectural Assessment (§1–§3)

### 1.1 Current State Assessment — Acknowledged

We appreciate the Director team's candid assessment of the `DirectorService` monolith. The identification of the five architectural sins — Scheduler bypass, duplicate normalization, disconnected session discovery, missing configuration, and unconnected library — gives us confidence that the Director team understands the integration seams precisely. This informs our API design: we now know the CloudPoller will be the sole consumer of our sequence endpoint, feeding into the existing Scheduler/Executor pipeline.

**No RC action required.** This is internal Director refactoring.

### 1.2 Multi-Simulator Constraint — Fully Accepted

The architecture diagram in §2 and the responsibility matrix are now the canonical reference for both teams. We accept without reservation:

- **The Director has no telemetry.** We will never emit `$var()` placeholders in auto-director sequences that expect the Director to resolve telemetry values.
- **Race Control is the sole intelligence.** We own driver scoring, camera selection, scene resolution, and sequence pacing.
- **The Director is a pure command executor.** It receives sequences and dispatches them to local hardware.
- **`totalDurationMs` is mandatory** on all auto-director sequences. The Director cannot estimate pacing without race context.

This constraint was implicit in our opening statement but the Director team has made it explicit and architectural. We adopt their framing entirely.

### 1.3 Proposed Architecture (§3) — No Concerns

The Director Orchestrator decomposition (CloudPoller → Scheduler → Executor) is clean and aligns perfectly with what we need from a consumer. Specific observations:

- **CloudPoller as the sole consumer** of `GET .../sequences/next` is exactly right. No more dual polling.
- **Mode model (stopped/manual/auto)** clarifies when the Director is polling vs. idle. This helps us reason about load patterns.
- **Session state model** — we note `session.status: 'searching' | 'discovered' | 'selected' | 'none'`. This matches our session lifecycle and informs the `410 Gone` proposal (see §3.2).

---

## 2. Response to §4.1 — Points of Agreement

All six of our original proposals are accepted. We confirm acceptance of the Director's clarifications:

| RC Proposal | Director Accepted With | RC Confirms |
|:---|:---|:---|
| **1. PortableSequence sole format** | Drop legacy now, no migration period | **Confirmed.** We will remove the `format` query parameter, `DirectorSequence` generation path, and `convertToPortableSequence()`. The generator will build `PortableSequence` natively. |
| **2. Shared Intent Registry** | Director names are canonical | **Confirmed.** We adopt all Director intent names. See §3 below for full mapping. |
| **3. Unbundle SWITCH_CAMERA** | Separate steps for OBS + camera | **Confirmed.** We will emit two distinct steps. See §3.1 for the exact sequence structure. |
| **4. Payload field names** | Exact schemas provided in §4.3 | **Confirmed.** We adopt every field name. See §3 for the rename mapping. |
| **5. Sequence Library read-write** | Read immediately, write future | **Confirmed.** Read endpoints are already live. We will add write endpoints in Phase 5 once the Director has a visual editor ready to consume them. |
| **6. Variable resolution** | Cloud pre-resolves for auto-director; `$var()` only for manual/library | **Confirmed with stronger commitment.** For auto-director sequences, every payload value will be concrete. We will never emit `$var()` in auto-generated sequences. Variables remain only on library sequences for manual execution. |

---

## 3. Response to §4.2 — Shared Intent Registry

### 3.1 Intent Renames — All Accepted

We confirm we will rename our intents to match the Director's canonical names:

| Current RC Intent | New RC Intent (Director Canonical) | Implementation Impact |
|:---|:---|:---|
| `broadcast.switchCamera` | `broadcast.showLiveCam` | Rename in `LEGACY_INTENT_MAP` → becomes the native intent in the new generator |
| `broadcast.tts` | `communication.announce` | Rename in `LEGACY_INTENT_MAP` and pending command conversion |
| *(not mapped)* | `communication.talkToChat` | Add to command buffer accepted types |
| `sequence.execute` | `system.executeSequence` | Rename. We agree — this is an executor concern, not an extension domain |
| `broadcast.chat` | `communication.talkToChat` | We accept the Director's naming. Drop `broadcast.chat`. |

### 3.2 New Intents — Accepted With Notes

| Intent | Director Decision | RC Response |
|:---|:---|:---|
| `overlay.show` / `overlay.hide` | Adopt as built-in. Payload: `{ overlayId, data? }` / `{ overlayId }` | **Accepted.** We will emit these when the Director reports them in the `intents` parameter. Until then, we defer. |
| `system.executeSequence` | Adopt. Payload: `{ sequenceId, variables? }` | **Accepted.** The AI Director can reference library sequences instead of inlining all steps. |
| `audio.play` | Defer — no handler exists | **Accepted.** We will not emit this intent until the Director registers a handler and reports it via capabilities. |

### 3.3 Finalized Intent Registry — Confirmed

We commit to the full registry in §4.2 of the Director's document. For absolute clarity, here is what Race Control will emit:

**Intents RC will emit in auto-director sequences:**

| Intent | When | Payload RC Will Send |
|:---|:---|:---|
| `broadcast.showLiveCam` | Every sequence (primary camera command) | `{ carNum: "63", camGroup: "TV1" }` |
| `obs.switchScene` | When OBS scene differs from current | `{ sceneName: "Race Cam" }` |
| `communication.announce` | When TTS command is pending | `{ message: "Safety car deployed!" }` |
| `communication.talkToChat` | When chat command is pending | `{ message: "Watch the battle!" }` |
| `overlay.show` / `overlay.hide` | When overlay command is pending | `{ overlayId: "lower-third", data: {...} }` |
| `system.wait` | Between steps for timing | `{ durationMs: 5000 }` |
| `system.log` | Diagnostic/audit | `{ message: "...", level: "INFO" }` |
| `system.executeSequence` | When AI references a library sequence | `{ sequenceId: "seq_123", variables: { driverNumber: "63" } }` |

**Intents RC will NOT emit** (Director-only or deferred):
- `broadcast.replayFromTo`, `broadcast.setReplaySpeed`, `broadcast.setReplayPosition`, `broadcast.setReplayState` — These are future AI capabilities. We will not emit them until the AI Director supports replay logic.
- `obs.getScenes` — Read-only, Director-initiated. Not a sequence step.
- `audio.play` — Deferred per agreement.

### 3.4 Payload Field Name Renames — All Accepted

We will update our sequence generator to use the Director's exact field names:

| Current RC Field | New Field | Intent Context |
|:---|:---|:---|
| `carNumber` | `carNum` | `broadcast.showLiveCam` |
| `cameraGroupName` / `cameraGroup` | `camGroup` | `broadcast.showLiveCam` |
| `cameraGroupNumber` | *(dropped from payload)* | Was redundant. `camGroup` name is sufficient — the Director's iRacing extension resolves group numbers from shared memory. |
| `carIndex` | *(dropped from payload)* | Director doesn't need the internal carIdx integer for camera commands. `carNum` is the identifier. |
| `obsSceneId` | `sceneName` | `obs.switchScene` (now a separate step) |
| `sceneType` | *(dropped)* | Internal to RC's scene selection logic. Not relevant to the Director. |
| `driverName` | *(moved to step metadata)* | Not a handler field. Useful for UI labels → `metadata.label`. |
| `text` | `message` | `communication.announce`, `communication.talkToChat` |

**Note on `cameraGroupNumber` / `carIndex`:** The Director's proposal drops these from the payload because the iRacing extension operates on `carNum` + `camGroup` strings. We confirm we will stop sending them in the payload. If the Director later discovers it needs numerical IDs (e.g., for direct `broadcast` SDK calls), we can add them as optional fields. For now, strings only.

### 3.5 Rule on Unknown Intents — Accepted

> "Race Control MUST NOT emit intents that are not in this registry."

**Accepted.** We will validate emitted intents against the registry at generation time. If the AI Director generates a step with an unregistered intent, we will either:
1. Drop the step with a server-side warning log, or
2. Emit it as `system.log` with the original intent as a diagnostic message

We prefer option 1 (silent drop) to keep sequences clean. The Director's soft-failure model (skip + warning) provides the safety net on the client side regardless.

---

## 4. Response to §4.4 — Answers to Our Questions

### Q1: `totalDurationMs` as sequence metadata — Accepted

We will emit `totalDurationMs` inside `metadata`:

```json
{
  "metadata": {
    "totalDurationMs": 12000,
    "generatedAt": "2026-02-22T14:30:12.000Z",
    "source": "ai-director"
  }
}
```

This replaces the top-level `totalDurationMs` field on the legacy `DirectorSequence`. The field is **mandatory on all auto-director sequences** (we accept the Director's constraint — they have no telemetry to estimate pacing).

For library sequences, `totalDurationMs` may be absent. The Director's fallback (sum `system.wait` durations + per-step estimate) is reasonable.

**`metadata.source` values we will use:**
- `"ai-director"` — Primary auto-director loop sequences
- `"command-buffer"` — Sequences generated entirely from pending commands (edge case: no telemetry, only injected commands)
- `"library"` — When returning a library sequence via `GET .../sequences/{id}`

### Q2: 204 No Content — Accepted

**We will continue returning `204 No Content` when there is nothing to show.** The Director's reasoning is sound: execution history cleanliness, semantic clarity, and polling interval control.

We accept the `Retry-After` header proposal (see §5.2).

### Q3: Addressed by Q1

Confirmed.

### Q4: Director fetches for `system.executeSequence` — Accepted

When we emit `system.executeSequence`, we provide only the `sequenceId` and optional `variables` map. The Director fetches the full sequence definition from `GET /api/director/v1/sequences/{id}`.

**RC commitment:** The `GET /api/director/v1/sequences/{id}` endpoint already exists and returns `PortableSequence`. We confirm it will remain stable and returns the format exactly as defined in §5 of the Director's document.

### Q5: Payload field names — Addressed in §3.4

Fully adopted.

---

## 5. Response to Director's New Proposals (§4.5–§4.7)

### 5.1 Capability Reporting via `intents` Query Parameter — Accepted

We accept the `intents` query parameter on `GET .../sequences/next`:

```
GET /api/director/v1/sessions/{id}/sequences/next
  ?lastSequenceId=abc-123
  &intents=broadcast.showLiveCam,obs.switchScene,communication.announce,system.wait,system.log
```

**Implementation plan:**

1. The `intents` parameter is **optional**. If absent, RC generates with all registered intents (backward-compat for testing and non-Director clients).
2. When present, RC **constrains sequence generation** to only emit steps whose `intent` is in the provided list.
3. Specifically:
   - If `obs.switchScene` is absent → RC omits the OBS scene switch step (the camera switch still happens; OBS just doesn't change).
   - If `communication.announce` is absent → RC does not interlace TTS pending commands.
   - If `broadcast.showLiveCam` is absent → RC returns `204 No Content` (there's nothing useful to do without camera control).
4. `system.wait` and `system.log` are always valid even if not reported — they're built-in and the Director guarantees them.

**OpenAPI spec update:** We will add `intents` as a query parameter (type: string, description: "Comma-separated list of active intent handlers") on the `GET .../sequences/next` endpoint.

### 5.2 `Retry-After` Header on 204 — Accepted

We will include `Retry-After` (in seconds) on `204 No Content` responses:

```
HTTP/1.1 204 No Content
Retry-After: 5
```

The default will be `5` (matching the Director's current idle polling interval). We reserve the right to vary this dynamically based on:
- **Session state:** Higher value during caution periods (less camera switching needed), lower during restarts.
- **Telemetry availability:** If no telemetry is flowing (session not started), we may suggest a longer interval (e.g., `30`).
- **API load:** Under high load, we may increase the interval to throttle polling.

If absent, the Director falls back to its own default (5s). This keeps the contract loosely coupled.

### 5.3 `410 Gone` for Ended Sessions — Accepted

We will return `410 Gone` from `GET .../sequences/next` when the session is in a terminal state (`COMPLETED` or `CANCELED`):

```
HTTP/1.1 410 Gone
Content-Type: application/json

{
  "error": "Session has ended",
  "sessionStatus": "COMPLETED"
}
```

**Trigger conditions:**
- Session status is `COMPLETED` or `CANCELED`
- Session has been deleted

The Director should stop polling and transition to `session.status: 'none'` to trigger re-discovery.

**Note:** We will NOT use 410 for `PLANNED` sessions that haven't started yet. For those, we return `204 No Content` (no telemetry to analyze yet) with a higher `Retry-After` value.

### 5.4 Command Buffer Format Migration (§4.6) — Accepted

We agree that the command buffer should use the shared intent vocabulary. We will update `POST .../commands`:

**New request schema:**
```json
{
  "intent": "communication.announce",
  "payload": { "message": "Safety car deployed!" },
  "priority": 2
}
```

**Migration details:**
- The `type` field (`TTS_MESSAGE | SHOW_OVERLAY`) is replaced by `intent` (string, from the shared registry).
- The `payload` field matches the intent's schema exactly.
- The `priority` field (integer, 1-10) is unchanged.
- Internally, we store the command as-is and interlace the `{ intent, payload }` directly as a `SequenceStep` in the next generated sequence. No more `convertPendingToDirectorCommand()` translation.

**Accepted intents for command buffer:**
- `communication.announce` (replaces `TTS_MESSAGE`)
- `communication.talkToChat` (new)
- `overlay.show` (replaces `SHOW_OVERLAY`)
- `overlay.hide` (new)
- `system.log` (diagnostic injection)

We will **not** accept `broadcast.showLiveCam` or `obs.switchScene` via the command buffer — camera and scene decisions are owned by the AI Director, not external agents.

---

## 6. Answers to Director's Open Questions (§4.7)

### 6.1 Priority Semantics: Cancel-and-Replace vs. Parallel

> "The Director proposes: `priority: true` means cancel the current sequence and run this one immediately."

**RC Position: We agree — cancel-and-replace.**

Two sequences switching cameras simultaneously is indeed chaos. When the AI Director detects an incident and emits `priority: true`, the intent is "stop what you're doing and show this instead" — not "do both at once."

**What we emit:**
- `priority: false` (default) — Normal auto-director sequence. The Director's CloudPoller enqueues it in the Scheduler. If a previous sequence is running, this waits in queue.
- `priority: true` — Urgent sequence (incident, race restart, major overtake). The Director's Scheduler should cancel the current execution and run this immediately.

**We will NOT use the `LOW | NORMAL | HIGH | URGENT` enum from the legacy spec.** The boolean model is simpler and matches the Director's Scheduler API. The old enum is removed with the legacy format.

**Regarding your question "What priority values does the AI emit, and when?":**
- Currently, all auto-director sequences are `priority: false`. The AI doesn't yet have incident detection sophisticated enough to warrant urgent sequences.
- When we add incident-aware generation (future), `priority: true` will be used for: caution flags, major contact events, dramatic position changes (leader change, last-lap pass).
- The `priority` field on pending commands (1-10 integer) is a **different concern** — it controls interlacing offset within a single sequence, not interruption semantics between sequences. We propose keeping both: `PortableSequence.priority` (boolean, cancel-and-replace) and pending command priority (integer, interlacing offset).

### 6.2 Session Lifecycle Push

> "Minimum viable: Option (b) — add 410 Gone as a response code."

**Accepted.** See §5.3 above.

For the future, we note that Cosmos DB Change Feed → Event Hub already publishes session document changes. A webhook mechanism for the Director to subscribe to session lifecycle events is architecturally feasible but out of scope for this RFC. We'll track it as a future enhancement.

**ETag-based long-polling on the sessions endpoint** is also feasible and low-cost. We'll add `ETag` headers to `GET /api/director/v1/sessions` responses so the Director can send `If-None-Match` and receive `304 Not Modified` when sessions haven't changed. This is a low-priority enhancement that we can add independently.

### 6.3 PortableSequence in the OpenAPI Spec

> "This is a blocking requirement. The Director codes to the spec."

**Accepted. We commit to updating `openapi.yaml` as part of this RFC implementation.**

Current state of the spec:
- `PortableSequence`, `SequenceStep`, and `SequenceVariable` schemas **already exist** in `openapi.yaml` (lines 178–226).
- However, the `GET .../sequences/next` response still references `DirectorSequence` via `oneOf` and defaults to the `format=legacy` parameter.
- The `DirectorCommandType`, `DirectorCommand`, `DirectorSequence`, and `NextSequenceResponse` schemas still exist.

**What we will do:**

1. **Remove** `DirectorCommandType`, `DirectorCommand`, `DirectorSequence`, and `NextSequenceResponse` schemas.
2. **Remove** the `format` query parameter from `GET .../sequences/next`.
3. **Update** the `GET .../sequences/next` 200 response to reference `PortableSequence` only (not `oneOf`).
4. **Add** `204 No Content` response with `Retry-After` header.
5. **Add** `410 Gone` response for ended sessions.
6. **Add** `intents` query parameter.
7. **Update** `PortableSequence` schema:
   - Remove `name`, `version`, `category`, `priority` from `required` (they're optional on auto-generated sequences). Only `id` and `steps` remain required.
   - Add `metadata` property with `totalDurationMs`, `generatedAt`, `source`.
   - Update `priority` description: "If true, the client should cancel any in-progress execution and run this sequence immediately."
8. **Update** `SequenceVariable.source` enum: add `'cloud'` alongside `'context'` and `'user'`.
9. **Update** `POST .../commands` request schema to use `{ intent, payload, priority }` instead of `{ type, payload, priority }`.
10. **Add** `ExecuteSequencePayload` to `SequenceStep` documentation showing the payload shape for `system.executeSequence`.

**Timeline:** We will ship the spec update as the first commit of this feature branch, before any implementation changes. The Director team can begin coding to the spec immediately.

---

## 7. Agreed Wire Format (§5) — Confirmed

We confirm the `PortableSequence` definition in §5 of the Director's document as the committed wire format. One minor refinement to the Director's proposed `SequenceVariable`:

**We accept the Director's expanded `SequenceVariable` with `constraints`:**
```typescript
interface SequenceVariable {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'sessionTime' | 'sessionTick';
  required: boolean;
  defaultValue?: any;
  source: 'cloud' | 'context' | 'user';
  contextKey?: string;
  constraints?: {
    min?: number;
    max?: number;
    options?: Array<{ label: string; value: string }>;
    pattern?: string;
  };
}
```

Changes from our current spec:
- Added `'boolean'` to the `type` enum.
- Changed `source` enum from `'context' | 'user'` to `'cloud' | 'context' | 'user'`.
- Added `constraints` object (not in our current schema).

### Example Auto-Director Sequence (what RC returns)

We confirm the example in §5 of the Director's document. Here is a more complete example showing the unbundled SWITCH_CAMERA pattern and pending command interlacing:

```json
{
  "id": "seq_ai_20260222_143012",
  "name": "Battle Cam — Car 63 vs Car 17",
  "steps": [
    {
      "id": "step_1",
      "intent": "obs.switchScene",
      "payload": { "sceneName": "Race Cam" },
      "metadata": { "label": "Switch to Race Cam scene" }
    },
    {
      "id": "step_2",
      "intent": "broadcast.showLiveCam",
      "payload": { "carNum": "63", "camGroup": "TV1" },
      "metadata": { "label": "Camera on Car 63 — TV1" }
    },
    {
      "id": "step_3",
      "intent": "communication.announce",
      "payload": { "message": "Close battle between Car 63 and Car 17!" },
      "metadata": { "label": "TTS — battle callout" }
    },
    {
      "id": "step_4",
      "intent": "system.wait",
      "payload": { "durationMs": 5000 },
      "metadata": { "label": "Hold shot for 5s" }
    },
    {
      "id": "step_5",
      "intent": "broadcast.showLiveCam",
      "payload": { "carNum": "17", "camGroup": "TV2" },
      "metadata": { "label": "Reverse angle — Car 17" }
    }
  ],
  "metadata": {
    "totalDurationMs": 12000,
    "generatedAt": "2026-02-22T14:30:12.000Z",
    "source": "ai-director"
  }
}
```

**Key differences from today's output:**
- No `commandType` enums. No `target` objects. No `offsetMs`.
- OBS scene switch is a separate first step, not embedded in the camera command.
- `carNum` instead of `carNumber`. `camGroup` instead of `cameraGroupName`.
- `communication.announce` instead of `TTS_MESSAGE`. `message` instead of `text`.
- `metadata.totalDurationMs` instead of top-level `totalDurationMs`.
- No `raceSessionId` on the sequence body (the session context is in the URL).
- Pending commands are interlaced as steps with proper intents, not converted from a separate type system.

---

## 8. Implementation Plan — Confirmed With RC Phasing

We accept the Director's phasing (§6). Here is Race Control's commitment per phase:

### Phase 1: Director Internal (No RC Changes)
**RC Work:** None. Director unifies execution path.

### Phase 2: Director Internal (No RC Changes)
**RC Work:** None. Director extracts SessionManager.

### Phase 3: Director Internal (No RC Changes)
**RC Work:** None. Director creates Orchestrator shell.

### Phase 4: API Contract (Joint — Both Teams) ← **Critical Path**
**RC Deliverables (in order):**

1. **Update `openapi.yaml`** — Remove legacy schemas, update response types, add `intents` param, add 204/410 responses. *Target: First commit on feature branch.*
2. **Update TypeScript types** (`api/src/types/director.ts`) — Remove `DirectorCommandType`, `DirectorCommand`, `DirectorSequence`, legacy `PendingCommand` types. Update `PortableSequence` to match agreed schema.
3. **Rewrite sequence generator** (`api/src/functions/director-sequences.ts`) — Build `PortableSequence` natively. Unbundle SWITCH_CAMERA into `obs.switchScene` + `broadcast.showLiveCam`. Use Director field names. Add `intents` filtering. Add `Retry-After` on 204. Add 410 for ended sessions.
4. **Update command buffer** (`api/src/lib/command-buffer.ts`, `api/src/functions/command-buffer.ts`) — Accept `{ intent, payload, priority }` format. Interlace as native `SequenceStep` objects.
5. **Remove legacy code** — Delete `convertToPortableSequence()`, `convertPendingToDirectorCommand()`, `LEGACY_INTENT_MAP`, `PRIORITY_OFFSET_CONFIG`, `format` parameter handling.
6. **Delete legacy TypeScript types** — Remove `DirectorCommandType`, `DirectorCommand`, `DirectorSequence` interfaces and OpenAPI annotations.

### Phase 5: Cloud Sequence Library (Joint)
**RC Deliverables:**
1. Sequence library endpoints already exist and return `PortableSequence`.
2. Add `POST /api/director/v1/sequences` for creating cloud sequences (when Director has visual editor).
3. Add `PUT /api/director/v1/sequences/{id}` for updating.
4. Add `DELETE /api/director/v1/sequences/{id}` for removal.

### Phase 6: Overlay Intents & Command Buffer (Joint)
**RC Deliverables:**
1. Command buffer migration (included in Phase 4 deliverable 4).
2. Emit `overlay.show` / `overlay.hide` when Director reports capability.

---

## 9. Open Items Tracker — RC Status Update

| # | Item | Owner | Status | RC Response |
|:---|:---|:---|:---|:---|
| 1 | `PortableSequence` schema in `openapi.yaml` | **RC** | **Committed** | First commit on feature branch |
| 2 | Intent renames | **RC** | **Committed** | Part of Phase 4 |
| 3 | Unbundle SWITCH_CAMERA | **RC** | **Committed** | Part of Phase 4 |
| 4 | Payload field name adoption | **RC** | **Committed** | Part of Phase 4 |
| 5 | `intents` query parameter | **Both** | **RC Accepted** | RC adds parameter, Director sends it |
| 6 | `Retry-After` header on 204 | **RC** | **Committed** | Part of Phase 4 |
| 7 | `410 Gone` for ended sessions | **RC** | **Committed** | Part of Phase 4 |
| 8 | `system.executeSequence` built-in | Director | Planned | RC will emit when appropriate |
| 9 | `overlay.show`/`overlay.hide` built-in | Director | Planned | RC waits for capability report |
| 10 | Sequence library endpoints in spec | **RC** | **Already in spec** | Endpoints exist at `GET /api/director/v1/sequences` and `GET .../sequences/{id}`. Will add write endpoints in Phase 5. |
| 11 | Command buffer format migration | **RC** | **Committed** | Part of Phase 4 |
| 12 | Priority semantics | **Both** | **Agreed** | Cancel-and-replace. Boolean only. See §6.1. |

**All four blocking items (1, 2, 3, 4) are committed by RC for Phase 4.**

---

## 10. Items We Disagree With or Need Clarification

### 10.1 `PortableSequence.name`, `version`, `category` as Required

The Director's agreed wire format in §5 shows `name?`, `version?`, `category?` as optional. Our current `openapi.yaml` has them as required. **We agree to make them optional.** Auto-generated sequences don't always have meaningful names or versions. We'll generate a name (e.g., "Battle Cam — Car 63 vs Car 17") when we can, but it won't be required.

New required fields for `PortableSequence`: **`id` and `steps` only.**

### 10.2 `offsetMs` Removal

The Director's example sequences in §5 contain no `offsetMs` on steps. We confirm this is intentional — the new model is **sequential execution** (step-by-step) with explicit `system.wait` steps for timing, not parallel offset-based execution.

Our current generator uses `offsetMs` to interlace pending commands at priority-based time offsets (0ms, 2s, 4s). In the new model, we will instead:
- **High priority pending commands** → Insert immediately after the first camera step.
- **Medium priority** → Insert after a `system.wait` step.
- **Low priority** → Insert at the end of the sequence.

This is a behavioral change but produces equivalent results. The Director executes steps sequentially, so positioning in the step array controls timing.

### 10.3 No Remaining Disagreements

We have no items to reject or counter-propose. The Director's RFC response is thorough and well-reasoned. The one outstanding discussion point (priority semantics) has been resolved by mutual agreement on cancel-and-replace.

---

## 11. Summary of RC Commitments

| Commitment | Scope | When |
|:---|:---|:---|
| Update `openapi.yaml` to PortableSequence-only | Spec | Phase 4, first commit |
| Remove `DirectorSequence`, `DirectorCommand`, legacy schemas | Spec + Types | Phase 4 |
| Rename all intents to Director canonical names | Generator | Phase 4 |
| Unbundle SWITCH_CAMERA into separate OBS + camera steps | Generator | Phase 4 |
| Adopt Director payload field names (`carNum`, `sceneName`, `message`) | Generator | Phase 4 |
| Add `intents` query parameter | Endpoint | Phase 4 |
| Add `Retry-After` on 204 responses | Endpoint | Phase 4 |
| Add `410 Gone` for ended sessions | Endpoint | Phase 4 |
| Migrate command buffer to `{ intent, payload, priority }` | Command Buffer | Phase 4 |
| Delete all legacy generation and conversion code | Cleanup | Phase 4 |
| Add write endpoints for sequence library | Library | Phase 5 |
| `totalDurationMs` mandatory on auto-director sequences | Generator | Phase 4 |
| Never emit `$var()` in auto-director sequences | Generator | Phase 4 |
| Validate emitted intents against registry | Generator | Phase 4 |
| Emit `overlay.*` only when Director reports capability | Generator | Phase 6 |

**The contract is agreed. We proceed to implementation.**
