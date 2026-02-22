# Sequence Executor Feature Specification

## Overview
The Sequence Executor is responsible for processing and executing `PortableSequence` objects. It acts as a **headless runtime** — a central dispatch mechanism that routes steps to their respective handlers via the Extension System, ensuring modularity and separation of concerns.

The executor does not care *who* created the sequence. It can be produced by:
- The Race Control Cloud API (AI Director)
- A Visual Editor / Control Deck UI
- A manual JSON file
- An external webhook

## Data Protocol: The Portable Sequence

To decouple the **Sequence Generator** (UI, AI, Manual File) from the **Sequence Executor**, we define a strict **Portable Sequence Format**.

### 1. PortableSequence
A portable JSON object representing a full sequence.
```json
{
  "id": "seq_12345",
  "name": "Race Start Protocol",
  "version": "1.0.0",
  "steps": [
    {
      "id": "step_1",
      "intent": "system.log",
      "payload": { "message": "Starting Sequence", "level": "INFO" }
    },
    {
      "id": "step_2",
      "intent": "broadcast.showLiveCam",
      "payload": { "carNum": "63", "camGroup": "TV1" }
    },
    {
      "id": "step_3",
      "intent": "system.wait",
      "payload": { "durationMs": 3000 }
    },
    {
      "id": "step_4",
      "intent": "obs.switchScene",
      "payload": { "sceneName": "Race Cam" }
    }
  ]
}
```

### 2. Universal Command (Step)
The Executor operates on a normalized command structure. It does **not** rely on hardcoded TypeScript Enums for extension usage.

```typescript
interface SequenceStep {
  id: string;          // Unique step ID
  intent: string;      // Semantic Intent ID (e.g. "obs.switchScene")
  payload: Record<string, unknown>;  // Data matching the Extension's Input Schema
  metadata?: {
    label?: string;    // Human readable label for UI
    timeout?: number;  // Max execution time in ms
  };
}
```

### 3. Intent Naming Convention
Intents use **semantic `domain.action`** notation defined by extensions in their `package.json` manifests:
- `system.wait` — Built-in
- `system.log` — Built-in
- `broadcast.showLiveCam` — iRacing Extension
- `obs.switchScene` — OBS Extension
- `communication.announce` — Discord Extension
- `communication.talkToChat` — YouTube Extension

This naming is intentionally **not tied to extension IDs**. The AI can reason about `communication.announce` semantically without knowing it's the Discord extension.

### 4. API Backward Compatibility
The Race Control API sends legacy `DirectorCommand[]` with `commandType` enums. The `DirectorService` normalizes these to `PortableSequence` before passing them to the executor via a built-in adapter function (`normalizeApiResponse`).

### 5. Decoupling Guarantee
- **The Executor is Headless**: It does not know *how* the sequence was created. It only validates:
    1.  Does the `intent` have an active handler in the Registry?
    2.  Does the `payload` match the Schema? (Optional runtime validation)
- **The Extension System is the Definition**: The `package.json` manifest provides the *only* definition of valid intents and payloads. The Executor is merely a generic runtime engine.

## Scope & Acceptance Criteria

**Goal**: Implement the core executor logic and the command handler architecture using the new **Intent-based Extension System**.

**In Scope**:
- `SequenceExecutor` class implementation (iterating steps, error handling).
- **Built-in Handlers** (inline in executor, no separate handler classes):
  - `system.wait` — Non-blocking delay.
  - `system.log` — Write to application log.
- **Extension Integration**:
  - Dynamic lookup of Intent Handlers via `ExtensionHostService`.
  - Extensions register their handlers via `registerIntentHandler()` during `activate()`.
- **API Adapter**:
  - `normalizeApiResponse()` in `DirectorService` to convert legacy API format to `PortableSequence`.

**Out of Scope**:
- Implementation of specific extension handlers (these live in `extensions/iracing`, `extensions/obs`, etc.).
- Visual Editor / Control Deck UI (separate feature).

## Architecture

### Intent-Driven Dispatch
The `SequenceExecutor` iterates through the `steps` array. For each step, it checks the `intent` string:
1. If `system.*` — handled inline (built-in).
2. Otherwise — dispatched to `ExtensionHostService.executeIntent()`.

### Execution Logic (Soft Failures)
To support the dynamic nature of extensions (which may be disabled or uninstalled):

1.  **Lookup**: The executor checks `extensionHost.hasActiveHandler(intent)`.
2.  **Hit**: The handler is executed via `extensionHost.executeIntent(intent, payload)`.
3.  **Miss (Soft Fail)**: If no handler is registered (e.g., extension disabled):
    - Log a warning: `[SequenceExecutor] Skipping step: No active handler for intent '${intent}'`.
    - **continue** to the next step.
    - Do **not** throw an error or abort the sequence.

### Two-Tier Registry
The system uses a two-tier registry to manage capabilities:
1.  **Capability Catalog (Static)**: Derived from `package.json` manifests of ALL installed extensions. Used by the **Visual Editor** to show available intents even if the extension isn't active.
2.  **Handler Registry (Dynamic)**: Populated at runtime when extensions `activate()`. Used by the **Sequence Executor** to dispatch intents.

## Intent Catalog

### Built-in Intents

#### system.wait
**Description**: Non-blocking pause for the sequence execution.
**Payload**:
```json
{
  "durationMs": 1000
}
```

#### system.log
**Description**: Write a message to the application log.
**Payload**:
```json
{
  "message": "string",
  "level": "INFO | WARN | ERROR"
}
```

### Extension Intents (Examples)
These are defined by their respective extension manifests. The executor does not need to know about them at compile time.

#### broadcast.showLiveCam (iRacing)
```json
{ "carNum": "string", "camGroup": "string" }
```

#### obs.switchScene (OBS)
```json
{ "sceneName": "string", "transition": "string", "duration": "number" }
```

#### communication.announce (Discord)
```json
{ "message": "string" }
```

#### communication.talkToChat (YouTube)
```json
{ "message": "string" }
```

## Error Handling

- **Soft Failure**: Missing handlers result in a skip and log warning.
- **Handler Failure**: If an executed handler throws an error, the executor catches it, logs the error, and proceeds to the next step (unless configured to abort).
- **Timeout**: Steps can optionally specify a `metadata.timeout` for maximum execution time. (Future implementation.)

## Future Considerations
- **Parallel Execution**: Currently, steps are executed sequentially. Future versions might support `PARALLEL` blocks.
- **Conditional Logic**: Simple `IF` logic based on telemetry data (e.g., "If Leader Gap < 1s, use `broadcast.showLiveCam`").
- **Step Results**: Intent handlers could return result data for use in subsequent steps.

