# Sequence Scheduler

> STATUS: IMPLEMENTED. Source of truth: `src/main/sequence-scheduler.ts`.

The scheduler sits between callers (renderer, `EventMapper`,
`DirectorOrchestrator`, REST imports) and the `SequenceExecutor`. It
owns:

- The execution **queue** (FIFO, default mode).
- **Priority preemption** (cancel-and-replace).
- **Variable resolution** (`$var(name)` substitution).
- **Cancellation** of the currently running execution.
- **History** as an in-memory ring buffer (default 25 entries).
- **Progress events** consumed by the renderer (`sequence:progress`)
  and the overlay system.

If you are looking at the executor directly, you have probably gone
one layer too deep — almost everything in this app talks to the
scheduler.

## API

```ts
class SequenceScheduler extends EventEmitter {
  enqueue(seq: PortableSequence, vars?: Record<string, unknown>,
          opts?: { source?: ExecutionSource; priority?: boolean }): Promise<string>;
  getQueue(): QueuedSequence[];
  isExecuting(): boolean;
  cancelCurrent(): Promise<void>;
  cancelQueued(executionId: string): Promise<void>;
  getExecutingSequence(sequenceId: string): PortableSequence | null;
  getHistory(): ExecutionResult[];

  // events
  on('queueChanged',   (q: QueuedSequence[]) => void);
  on('progress',       (p: SequenceProgress) => void);
  on('historyChanged', (h: ExecutionResult[]) => void);
}
```

`enqueue` returns the `executionId` (a uuid v4). The renderer uses
this id to call `cancelQueued`.

## Queue model

```
                              ┌────────────────────────┐
   enqueue(priority=false) ──▶│  FIFO queue (in-mem)   │
                              └─────────┬──────────────┘
                                        │ processQueue()
                                        ▼
                              ┌────────────────────────┐
   enqueue(priority=true)  ──▶│  cancel current,       │
   (or sequence.priority=true)│  clear queue,          │──▶ executor.executeStep × N
                              │  execute immediately   │
                              └────────────────────────┘
```

- The queue is processed strictly serially: the scheduler will not run
  two non-priority sequences in parallel. `processQueue()` re-runs as
  long as `queue.length > 0`.
- Priority sequences **preempt** by:
  1. Calling `cancel()` on the in-flight execution (drops out of the
     for-loop on next iteration).
  2. Truncating the queue to zero.
  3. Running the priority sequence on a fresh promise (still serial
     w.r.t. itself — the scheduler does not run priority sequences in
     parallel either).
- A sequence can be marked priority via `opts.priority` or via
  `sequence.priority: true` in its JSON.

## Variable resolution (`$var()`)

Implemented in `resolveVariables()` and `substitutePayload()`
(`sequence-scheduler.ts:25..92`). Substitution-only — there is **no**
expression evaluator, **no** arithmetic, **no** member access.

### Resolution algorithm

```
For each varDef in sequence.variables:
  if varDef.name in providedVars:    resolved[name] = providedVars[name]
  else if varDef.default !== undefined: resolved[name] = varDef.default
  // else: unset

For each varDef:
  if varDef.required && !(name in resolved):
    throw new Error("Missing required variable: <name> (<label>)")

For each step:
  step.payload = substitutePayload(step.payload, resolved)
```

### Substitution algorithm

`substitutePayload` walks the payload object recursively:

| Value form | Result |
|---|---|
| `"$var(name)"` (string is exactly one reference) | The raw typed value (`number`, `boolean`, `null` preserved). |
| `"foo $var(name) bar"` (interpolation) | `String(value)` interpolated into the string. Unknown names left as `"$var(name)"`. |
| Nested object | Recurse. |
| Array | Pass through unchanged (arrays are NOT walked). |
| Anything else | Pass through. |

If variable resolution throws (a required variable was missing), the
scheduler emits a single `progress` event with `stepIntent: 'system.error'`,
pushes a `failed` `ExecutionResult` into history, and does **not**
invoke the executor.

### What is NOT supported

- `$var(name + 1)` — no expressions.
- `$var(name.foo)` — no nested access.
- `${name}` — only `$var(...)` syntax is recognised.
- Cross-step references (a step cannot read the result of a previous
  step). Use `metadata` for documentation; use the orchestrator for
  cross-sequence data flow.

## Cancellation

`cancelCurrent()` flips a per-execution `cancelController.cancelled`
flag. The executor checks this between steps. **Steps are not
interruptible mid-flight** — if `system.wait` is mid-`setTimeout`, it
will complete before the cancellation is honoured. Long-running
extension intents (e.g. an OBS scene-switch with a 2 s transition)
similarly run to completion.

`cancelQueued(executionId)` removes a not-yet-running entry from the
queue and recomputes `position` for the rest. Emits `queueChanged`.

## History (ring buffer)

Configurable via `SequenceSchedulerOptions.historyConfig.maxEntries`
(default 25, see `executeSequence` and `pushHistory`). Implemented as
an array with `shift()` when over capacity.

Each `ExecutionResult` is pushed **after** the executor finishes,
regardless of `completed` / `partial` / `failed` / `cancelled`. The
`historyChanged` event fires on every push; the orchestrator uses this
to auto-hide the overlay 3 s after a sequence ends.

## Progress events

`SequenceProgress` is emitted at three points per step:

1. `running` — before the executor is called.
2. `success` / `skipped` / `failed` — after the executor returns or
   throws.

Plus two synthetic events per sequence:

1. `sequence.start` (`stepIntent`) — emitted with `currentStep: 0`
   before the first real step.
2. `sequence.end` (`stepIntent`) — emitted with `currentStep: totalSteps`
   after the last step.

The orchestrator hooks `sequence.start` / `sequence.end` to drive the
`CloudPoller` prefetch (see `architecture-orchestrator.md`).

## Soft skip vs hard fail in history

The executor's "no active handler" warning is **also** propagated as
an exception (caught by the scheduler's per-step `try/catch`). The
scheduler distinguishes the two:

```ts
const isSkip = err.message?.includes('No active handler');
// status: 'skipped' if isSkip, 'failed' otherwise
```

Aggregate `ExecutionResult.status` rules:

| Step outcomes | `ExecutionResult.status` |
|---|---|
| All `success` | `completed` |
| ≥1 `success` + ≥1 non-success | `partial` |
| 0 `success` (all skipped/failed) | `failed` |
| Cancelled mid-execution | `cancelled` (regardless of prior outcomes) |

## Wiring

```
sequenceScheduler = new SequenceScheduler(sequenceExecutor);
// ipcMain handlers in main.ts:
//   sequence:execute      → scheduler.enqueue(seq, vars, opts)
//   sequence:cancel       → scheduler.cancelCurrent()
//   sequence:cancel-queued→ scheduler.cancelQueued(id)
//   sequence:queue        → scheduler.getQueue()
//   sequence:history      → scheduler.getHistory()
//   sequence:get-executing→ scheduler.getExecutingSequence(id)
// renderer push: 'sequence:progress' from scheduler.on('progress', …)
```

The orchestrator does NOT subscribe to `progress` directly; it watches
`sequence.start` / `sequence.end` synthetic events to drive the cloud
prefetch.
