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

**`rigId` is required on lifecycle events** (not just recommended). Race Control's `event-synthesizer.ts` uses `rigId` to discriminate events from different physical rigs when synthesizing `STINT_BATON_PASS`, `RIG_FAILOVER`, and `STINT_HANDOFF_HANDOVER` cloud events. If `IRACING_CONNECTED` or `IRACING_DISCONNECTED` arrives without `rigId`, cross-rig synthesis goes silent with no error. The top-level orchestrator always generates `rigId` at startup, so this costs nothing — it just must be specified as required on these event types in the envelope, not merely "optional for debugging".


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
