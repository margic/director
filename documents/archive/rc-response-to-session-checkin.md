# Race Control API — Response to Session Check-In RFC

**From:** Race Control API Team  
**To:** Director Client Team  
**Date:** 2026-03-14  
**Re:** Session Check-In & Capability Exchange RFC + Director Feedback  
**Status:** Accepted — Open Items Below  

---

## 0. Executive Summary

We accept the Session Check-In & Capability Exchange proposal. The five-phase lifecycle (**Check In → On Standby → Start Agent → Directing → Wrap**) is well-designed, proportionate, and solves real operational problems.

We've incorporated the Director team's six feedback items into the RFC document:

1. ✅ `warnings` array added to `SessionCheckinResponse` schema
2. ✅ `displayName` added to 409 conflict response body
3. ✅ OBS host confirmed as session-scoped override
4. ✅ `configUpdate` field agreed for mid-session config changes on `GET .../sequences/next`
5. ✅ Backward compatibility transition plan added to §3.5 (permissive → enforced via feature flag)
6. ✅ "Director Loop" → "Director Agent" terminology adopted

All schema changes are reflected in the updated RFC document (`docs/features/feature_session_claim.md`).

**Items requiring agreement before implementation begins:** Two (heartbeat floor rate, intents precedence). Everything else is accepted or deferred cleanly.

---

## 1. Answers to Director's Six Feedback Items

### 1.1 `warnings` Array — Accepted and Applied

Correct catch — Q6 proposed accept-with-warning but the schema omitted the field. We've added `warnings?: string[]` to both the TypeScript interface and the OpenAPI `SessionCheckinResponse` schema.

**Warning conditions RC will emit in v1:**
- `"Primary camera intent (broadcast.showLiveCam) not available"` — if missing from capabilities
- `"OBS not connected — obs.switchScene steps will be omitted"` — if OBS shows `connected: false`
- `"No communication intents available — TTS and chat steps will be omitted"` — if all communication intents are inactive

The Director should display these prominently during the On Standby phase. The operator can remediate (connect OBS, enable an extension) and re-check-in if needed, or proceed to Start Agent with the known limitations.

### 1.2 Display Name in 409 — Accepted and Applied

We'll populate `existingCheckin.displayName` from the user profile associated with the active check-in. The auth token includes the user ID; we resolve the display name from the users container.

If the display name is unavailable (edge case: user profile deleted mid-session), we'll fall back to `"Unknown operator"` rather than exposing the raw `directorId` UUID.

### 1.3 OBS Host Session-Scoped — Confirmed

The `obsHost` field in `SessionOperationalConfig` is a **session-scoped override**. The Director applies it for the duration of the session and reverts to its locally stored default when the session wraps. RC will never emit an `obsHost` that should persist beyond the session.

### 1.4 `configUpdate` on Poll Responses — Accepted, Schema Deferred

We agree that mid-session config changes should flow via an optional `configUpdate` field on `GET .../sequences/next` 200 responses rather than requiring re-check-in.

**However, we propose deferring the `configUpdate` schema to a follow-up RFC.** Mid-race config changes are rare (driver swap, rig failure). For v1, the Director can re-check-in to get fresh config if needed — it's a single HTTP round-trip.

When we do define it, options are:
- Full `SessionOperationalConfig` replacement (simple, heavy)
- Partial patch with only changed fields (complex, lightweight)
- `configVersion` integer on each poll response — Director notices a version bump and calls `GET .../sessions/{id}/config` to fetch the update

We lean toward option 3 (version bump + separate fetch) for clean separation. We'll track this as a known gap.

### 1.5 Backward Compatibility — Accepted, Operational Rules Proposed

The transition matrix in §3.5 is agreed. Operational rules:

| Concern | Decision |
|:---|:---|
| **Toggle owner** | RC, via environment variable (`CHECKIN_ENFORCEMENT_MODE=permissive\|enforced`) |
| **Rollout signal** | Director team confirms their production build sends `X-Checkin-Id` on all polls → RC enables enforcement |
| **Staging first** | Enforcement enabled in staging environment first. Production follows after 1 week of clean operation in staging. |
| **Logging** | In permissive mode, RC logs a deprecation warning on every poll that lacks `X-Checkin-Id`. This gives both teams visibility into the transition. |

### 1.6 "Director Agent" Terminology — Adopted

We'll use "Director Agent" in place of "Director Loop" across RC documentation going forward. The RFC document has been updated.

---

## 2. Open Items Requiring Agreement

These do not block the Director team's Phase 1/Phase 4 work but **must be resolved before Phase 2 implementation begins.**

### 2.1 Heartbeat Floor Rate vs. `Retry-After` (Blocking)

RC can send `Retry-After: 30` during caution periods (per RC Response §5.2). If the Director obeys it literally, it polls every 30s. With a 120s TTL, that's only 4 heartbeats of margin — a single network hiccup or slow DNS resolution could cause the check-in to expire mid-race.

**We propose a contractual invariant:**

> The Director MUST poll at `min(Retry-After, checkinTtlSeconds / 4)` regardless of the `Retry-After` value, to maintain the check-in heartbeat.

With `checkinTtlSeconds: 120`, this means the Director polls at most every 30s — which happens to equal the worst-case `Retry-After`. But if we tune `Retry-After` higher in the future (e.g., 60s during long cautions), this invariant ensures the heartbeat doesn't lapse.

The extra 204 responses from "too-frequent" polling are cheap: no body, no sequence generation, just a TTL refresh.

**Question:** Does the Director team accept this floor rate contract? Or would you prefer a dedicated lightweight heartbeat mechanism (e.g., `HEAD .../checkin`) decoupled from sequence polling?

### 2.2 `intents` Param Supersedes Check-In Snapshot (Blocking)

The check-in exchanges the full capability snapshot, including `active: false` entries for disabled extensions and `connections` health data. The `intents` query parameter on each poll conveys only currently active handlers as a comma-separated string.

Mid-session, hardware state changes: OBS disconnects, Discord reconnects. The two data sources can diverge.

**We propose this precedence model:**

| Data Source | When Used | Authoritative For |
|:---|:---|:---|
| **Check-in snapshot** | From check-in until the first poll arrives | Full capability picture (intents, schemas, health) |
| **`intents` param on each poll** | Every poll after check-in | Real-time intent availability — **supersedes** the check-in snapshot |
| **Check-in `connections` health** | Until a future refresh mechanism is added | Hardware connected/disconnected distinction (not refresh-able in v1) |

In practice: if the check-in reports `communication.announce` as `active: false` but the next poll includes `communication.announce` in `intents`, RC treats it as available and begins emitting TTS steps.

**Question:** Does the Director team agree with this precedence model?

---

## 3. Commitments

### 3.1 RC Deliverables

| # | Item | When |
|:---|:---|:---|
| 1 | Update `openapi.yaml` with check-in schemas (§4.1, §4.2, §4.3 of RFC) | Phase 1 — first commit |
| 2 | Implement `POST .../checkin` endpoint | Phase 2 |
| 3 | Implement `DELETE .../checkin` endpoint | Phase 2 |
| 4 | Check-in storage in Cosmos DB with TTL | Phase 2 |
| 5 | `X-Checkin-Id` validation + TTL refresh on `GET .../sequences/next` | Phase 2 |
| 6 | Capability-aware AI Director prompt injection | Phase 6 |
| 7 | Staging test session with populated `SessionDriverMapping` data (3 drivers, 3 rigs, 6 OBS scenes) | When Phase 2 endpoint is live |
| 8 | Permissive mode feature flag (`CHECKIN_ENFORCEMENT_MODE`) | Phase 2 |

### 3.2 `X-Checkin-Id` Header Passthrough — RC Will Validate

Custom headers can be stripped by CDN/proxy layers. We're routing through Azure Static Web Apps → Azure Functions. We will validate that SWA passes `X-Checkin-Id` through during Phase 2 development.

**Fallback plan:** If SWA strips the header, we switch to a `checkinId` query parameter. Both sides should code defensively — check header first, fall back to query param.

We'll also ask the Director team to test header passthrough from their side when running against the local SWA CLI proxy.

---

## 4. Items We Consider Resolved

| Item | Resolution |
|:---|:---|
| Hard lock with TTL | Agreed by both sides. §7 Q1. |
| 120s TTL | Agreed. §7 Q2. Subject to tuning via `pollingConfig`. |
| Implicit heartbeat via polling | Agreed. §7 Q3. Subject to floor rate contract (§2.1 above). |
| Inline config in check-in response | Agreed. §7 Q4. `configUpdate` deferred. |
| Admin role for force-check-in | Agreed. §7 Q5. Requires `Admin` role, distinct from `RaceDirector`. |
| Accept-with-warnings | Agreed. §7 Q6. `warnings` array in schema. |
| OBS host session-scoped | Confirmed. §1.3 above. |
| Display name in 409 | Applied. §1.2 above. |
| Backward compat transition | Applied in §3.5. Operational rules in §1.5 above. |
| "Director Agent" terminology | Adopted. §1.6 above. |
| Driver mappings test data | Committed. §3.1 item 7 above. |

---

## 5. Summary of Open Items

| # | Item | Owner | Blocks |
|:---|:---|:---|:---|
| 1 | **Heartbeat floor rate contract** — `min(Retry-After, checkinTtlSeconds / 4)` | Director to confirm | Phase 2 impl |
| 2 | **`intents` supersedes check-in snapshot** — precedence model | Director to confirm | Phase 6 impl |
| 3 | **`configUpdate` schema** — deferred to follow-up RFC | Both | Future |
| 4 | **`X-Checkin-Id` header passthrough** — SWA validation | Both | Phase 2 impl |

Items 1 and 2 need explicit Director team agreement. Items 3 and 4 are tracked but non-blocking for Phase 1/Phase 4 work.
