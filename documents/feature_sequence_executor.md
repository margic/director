# Sequence Executor

> STATUS: IMPLEMENTED. Source of truth: `src/main/sequence-executor.ts`.

The executor is a **headless, intent-driven runtime**. It does not
care how a sequence was authored — it walks `PortableSequence.steps`
and dispatches each step to either a built-in handler or the extension
host. The author-time authoring tools (Visual Editor, AI Planner,
JSON import, REST sync) are all upstream of this layer.

For data shapes, see `data-models.md`. For queueing, history,
variable resolution, priority preemption and progress events, see
`feature_sequence_scheduler.md` (the executor is invoked by the
scheduler, not directly).

## Dispatch table

For each step, the executor looks at `step.intent`:

| Prefix / value | Handler | Description |
|---|---|---|
| `system.wait` | built-in | Sleeps for `payload.durationMs`. |
| `system.log` | built-in | Logs `payload.message` at `payload.level` (`INFO` / `WARN` / `ERROR`, default `INFO`). |
| `system.executeSequence` | built-in | Looks up `payload.sequenceId` in the `SequenceLibraryService` and recurses into `execute()`. |
| `overlay.show` | built-in | `overlayBus.showOverlay(payload.extensionId, payload.overlayId)`. |
| `overlay.hide` | built-in | `overlayBus.hideOverlay(payload.extensionId, payload.overlayId)`. |
| anything else | extension host | If `intentRegistry.getIntent(intent)` returns a handler, dispatched via `extensionHost.executeIntent(intent, payload)`. Otherwise, **soft-skip** with a warning. |

### Built-in payload schemas

```ts
// system.wait
{ durationMs: number }              // 0 or missing = no-op

// system.log
{ message: string; level?: 'INFO' | 'WARN' | 'ERROR' }

// system.executeSequence
{ sequenceId: string }              // resolved via SequenceLibraryService.getSequence

// overlay.show / overlay.hide
{ extensionId: string; overlayId: string }
```

Missing required fields cause a warning and a no-op (consistent with
soft-failure).

## Soft-failure

The executor's contract is: **a sequence never aborts because of one
bad step.** Every failure path is logged and skipped:

- Unknown intent → `console.warn` and continue.
- Built-in payload missing required fields → `console.warn` and continue.
- Handler throws → caught in the per-step `try { await this.executeStep(step) }`,
  logged, and the loop advances.

This is what makes Director Loop usable when an extension is disabled
or disconnected: the AI planner can still emit a sequence that
references OBS scenes and Discord announcements; if Discord is down,
the OBS step still fires.

The trade-off: there is **no transactional semantics**. If your
sequence depends on step N+1 only running when step N succeeded, you
must either author the dependency into your extension (e.g. an OBS
intent that no-ops if disconnected) or use `priority: true` to allow a
new sequence to preempt a partially-failed one.

## Step execution flow

```
async executeStep(step):
  if intent is system.wait      → setTimeout(payload.durationMs)
  if intent is system.log       → console[level](formatted message)
  if intent is system.executeSequence → recurse on getSequence(payload.sequenceId)
  if intent is overlay.show/hide → overlayBus.show/hideOverlay(...)
  else:
    if !extensionHost.hasActiveHandler(intent):
      warn "No active handler for intent X"; return     // soft skip
    await extensionHost.executeIntent(intent, payload)
```

The extension-host call returns immediately after posting the
`EXECUTE_INTENT` IPC message — there is no acknowledgement round-trip.
This means **`durationMs` in step metadata is not enforced**; long-
running intents block the next step only if they `await` something
the executor can observe (e.g. `system.wait` after them).

## Progress reporting

`execute(sequence, onProgress?)` invokes the optional callback with
`(completed, total)` after each step. The scheduler uses this to emit
`SequenceProgress` events on the `'progress'` event emitter (which the
preload surfaces as `sequences.onProgress`).

## What the executor does NOT do

These responsibilities belong to the scheduler, not the executor:

- Variable resolution (`$var()`).
- Cancellation.
- Queueing or priority preemption.
- History tracking.
- Per-step timing and `ExecutionResult` aggregation.

If you need any of those, call `scheduler.enqueue(sequence, vars,
opts)`, not `executor.execute(sequence)` directly. The orchestrator,
event mapper, and IPC layer all go through the scheduler.

## Wiring

```
src/main/main.ts
  sequenceExecutor = new SequenceExecutor(extensionHost, overlayBus);
  sequenceLibrary  = new SequenceLibraryService(capabilityCatalog, authService);
  sequenceExecutor.setSequenceLibrary(sequenceLibrary);  // for system.executeSequence
  sequenceScheduler = new SequenceScheduler(sequenceExecutor);
```

The library is wired in *after* construction to break a circular
dependency (the library references stored sequences, which can be
nested via `system.executeSequence`, which the executor needs).
