# Director Response: Session Check-In & Capability Exchange RFC

**From:** Director Client Team  
**To:** Race Control API Team  
**Date:** 2026-03-14  
**Re:** Session Check-In & Capability Exchange RFC  
**Status:** Accepted with Feedback  

---

## Overall

We accept the proposal. The five-phase lifecycle (Check In → On Standby → Start Agent → Directing → Wrap) maps cleanly onto our existing architecture. Our `CapabilityCatalog`, `IntentRegistry`, auth service, and polling loop are all in place. We can begin work on Phases 1 (types) and 4 (Connection Health API) immediately.

---

## Answers to Section 7 Questions

| # | Our Position |
|:---|:---|
| 1 | **Hard lock with TTL auto-expiry.** Agree. The force-check-in escape hatch covers the operational risk. |
| 2 | **120s TTL is fine.** 24 missed polls is generous margin. If RC wants to tune this per-session via `pollingConfig`, we'll respect it. |
| 3 | **Implicit refresh via polling.** Agree — no separate heartbeat endpoint. The polling loop already runs at 5s. |
| 4 | **Inline in check-in response.** Agree. For mid-session config changes, we'd like RC to include an optional `configUpdate` field on `GET .../sequences/next` 200 responses rather than requiring re-check-in. |
| 5 | **Admin role for force-check-in.** Open to RC's RBAC model. |
| 6 | **Accept with warnings.** Agree. See schema note below. |

---

## Items We'd Like RC to Address

### 1. Add `warnings` array to `SessionCheckinResponse` schema

Question 6 proposes accept-with-warning, but the `SessionCheckinResponse` schema in Section 4.1 has no `warnings` field. We suggest:

```yaml
SessionCheckinResponse:
  properties:
    # ...existing fields...
    warnings:
      type: array
      items:
        type: string
      description: Non-fatal warnings about the check-in (e.g., "Primary camera intent not available")
```

The Director will display these in the UI during the On Standby phase so the operator can remediate before starting the agent.

### 2. Include operator display name in 409 Conflict response

The current 409 body returns `directorId` (a UUID). When an operator sees "Session already checked in," a raw UUID isn't helpful. Could the `existingCheckin` object include a `displayName` or `userId` so the Director UI can show "Session in use by Ana Torres" instead of "Session in use by `d_inst_99887766-...`"?

### 3. OBS host override: session-scoped vs. persistent

The check-in response may return an `obsHost` that differs from the operator's locally configured default. We will treat this as a **session-scoped override** — applied for the duration of the session but not persisted to the user's default config. When the session wraps, the OBS extension reverts to its stored default. Please confirm this is the intended behavior.

### 4. Driver mappings are new territory for the Director

The `SessionDriverMapping` schema (driverId, carNumber, rigId, obsSceneId) is entirely new data the Director hasn't consumed before. We'll build the UI for it, but we need sample data in a staging session to test against. Can RC provide a test session with populated driver mappings once the endpoint is live?

### 5. Backward compatibility window

During rollout, the Director and RC won't ship simultaneously. We need agreement on the transition:

- **Director deploys first:** Sends `X-Checkin-Id` header, RC ignores it (unknown header, no-op). Safe.
- **RC deploys first:** RC accepts polls without `X-Checkin-Id` (backward-compat mode per Section 3.4). Eventually RC logs a deprecation warning.
- **Both live:** Full check-in enforcement.

We propose RC defaults to **permissive mode** (accept polls without check-in) until both sides confirm readiness, then switches to **enforced mode** via a feature flag.

### 6. Terminology: "Director Loop" → "Director Agent"

We've adopted "Director Agent" in place of "Director Loop" across our documentation. The `Depends On` line and Section 10 references updated accordingly. Flagging so RC's docs stay aligned.

---

## What We'll Start Building Now (No RC Dependency)

| Item | Description |
|:---|:---|
| **Connection Health API (Phase 4)** | Unified `getConnectionHealth()` aggregator in `ExtensionHostService`. Extensions already emit connection events (`obs.connectionStateChanged`, etc.); we'll wire a collector. |
| **Phase 1 Types** | `SessionCheckinRequest`, `SessionCheckinResponse`, `DirectorCapabilities`, `ConnectionHealth` interfaces in `director-types.ts`. |
| **`directorId` Persistence** | UUID generation on first launch in `ConfigService`. |

These can be completed and merged before the RC endpoint exists.

---

## Response to RC Open Items (2026-03-14)

Following RC's acceptance and response (`rc-response-to-session-checkin.md`), we address the two blocking open items.

### Open Item 2.1: Heartbeat Floor Rate Contract — Accepted

We accept the invariant:

> **The Director MUST poll at `min(Retry-After, checkinTtlSeconds / 4)` regardless of the `Retry-After` value.**

This is straightforward to implement. Our `loop()` method in `DirectorService` already computes the next poll interval from `Retry-After` — we'll add a floor:

```typescript
const retryAfterMs = retryAfterSeconds * 1000;
const heartbeatFloorMs = (this.sessionConfig?.pollingConfig?.idleIntervalMs ?? this.POLL_INTERVAL_MS);
const maxIntervalMs = (this.checkinTtlSeconds ?? 120) * 1000 / 4;  // TTL / 4
const interval = Math.min(retryAfterMs, maxIntervalMs);
```

We prefer the polling-based approach over a dedicated `HEAD .../checkin` heartbeat endpoint. The extra 204 responses are negligible cost and avoid adding another endpoint to the contract.

The RFC document has been updated with this invariant in §3.3.

### Open Item 2.2: `intents` Supersedes Check-In Snapshot — Accepted

We accept the precedence model:

| Data Source | Authoritative For |
|:---|:---|
| **Check-in snapshot** | Full capability picture until first poll (intents + schemas + health) |
| **`intents` param on each poll** | Real-time intent availability — **supersedes** check-in snapshot |
| **Check-in `connections` health** | Hardware connected/disconnected (not refreshable in v1) |

This matches our implementation naturally. The Director's `getActiveIntents()` method already recomputes the active intent list on every poll cycle from the live `CapabilityCatalog` state. When an extension connects or disconnects mid-session, the next poll's `intents` param automatically reflects the change — no special code needed.

**One note on `connections` health in v1:** Since connection health from the check-in is not refreshable mid-session, we want to ensure RC doesn't use stale `connections` data to contradict the live `intents` param. Specifically: if `connections.obs.connected` was `false` at check-in time but `obs.switchScene` appears in `intents` on a subsequent poll, RC should trust the `intents` param (OBS reconnected) rather than the stale `connections` snapshot. We believe that's what the precedence model already implies, but want to confirm explicitly.

The RFC document has been updated with this precedence model in §3.6.

### Open Item 3: `configUpdate` Schema — Agreed to Defer

We agree with deferring to a follow-up RFC. RC's preference for option 3 (version bump + separate fetch) is sensible — clean separation, no schema bloat on the poll response.

For v1, if config changes mid-session (driver swap, rig failure), the operator can wrap and re-check-in. Single HTTP round-trip, acceptable UX.

### Open Item 4: `X-Checkin-Id` Header Passthrough — We'll Test

We'll validate that `X-Checkin-Id` passes through from our Electron `fetch()` calls when running against the SWA CLI proxy during Phase D integration testing.

We've coded defensively per RC's suggestion: our implementation will send `X-Checkin-Id` as a header, and we'll add a fallback `checkinId` query parameter if header passthrough fails. The check order (header first, query param fallback) is clean.

---

## Updated Resolved Items

All items from the original RFC are now resolved:

| Item | Status |
|:---|:---|
| Hard lock with TTL | ✅ Agreed |
| 120s TTL | ✅ Agreed |
| Implicit heartbeat via polling | ✅ Agreed + floor rate contract |
| Inline config in check-in response | ✅ Agreed, `configUpdate` deferred |
| Admin role for force-check-in | ✅ Agreed |
| Accept-with-warnings | ✅ `warnings` array in schema |
| OBS host session-scoped | ✅ Confirmed |
| Display name in 409 | ✅ Applied |
| Backward compat transition | ✅ Permissive → enforced via feature flag |
| "Director Agent" terminology | ✅ Adopted |
| Driver mappings test data | ✅ RC committed |
| **Heartbeat floor rate** | ✅ **Accepted** |
| **`intents` supersedes check-in** | ✅ **Accepted** |
| `configUpdate` schema | ⏳ Deferred to follow-up RFC |
| `X-Checkin-Id` header passthrough | ⏳ Both sides testing during Phase 2/D |

---

## Final Confirmation from RC (2026-03-14)

RC confirmed all blocking items resolved — green light for implementation.

- **Heartbeat floor rate:** `min(Retry-After, checkinTtlSeconds / 4)` is now contractual. Polling-based, no separate heartbeat endpoint.
- **`intents` supersedes check-in snapshot:** Confirmed explicitly — live `intents` always wins over stale `connections` data. RC will never refuse to emit a step for an intent present in the poll's `intents` param based on an outdated check-in snapshot.
- **`configUpdate` schema:** Deferred. Option 3 (version bump + separate fetch) when ready.
- **`X-Checkin-Id` header passthrough:** Both sides testing. Query param fallback agreed.

**No blocking items remain.** Implementation proceeds:
- Director: Phase A types, Phase B Connection Health, `directorId` persistence
- RC: Phase 1 OpenAPI schemas, then Phase 2 endpoint implementation
