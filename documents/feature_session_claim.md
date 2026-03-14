# Feature Proposal: Session Claim & Capability Exchange

**From:** Director Client Team  
**To:** Race Control API Team  
**Date:** 2026-03-14  
**Status:** RFC — Requesting Feedback  
**Depends On:** Director Loop v2 RFC, RC Response to Director Proposal  

---

## 0. Executive Summary

Today when a Director selects and starts a session, it simply begins polling `GET .../sequences/next`. Race Control has no knowledge that a Director has connected, what hardware it controls, or whether another Director is already operating on the same session. The first indication RC receives is the `intents` query parameter on the first poll — if it's even implemented yet.

**This proposal introduces a formal session lifecycle: Claim → Direct → Release.** Before any sequences flow, the Director claims a session and exchanges capabilities with Race Control. RC acknowledges the claim, returns session configuration, and from that point generates sequences tailored to the Director's actual hardware. On teardown, the Director releases the claim cleanly.

**Cost justification:** This handshake is a single HTTP round-trip at session setup. It eliminates blind sequence generation, prevents multi-Director conflicts, and gives both sides the information they need before the first sequence ever fires. The investment is one new endpoint and one new schema.

---

## 1. Problem Statement

### 1.1 Race Control Generates Sequences Blind

RC's AI Director currently generates sequences with no knowledge of which hardware is available. If OBS is disconnected, RC still emits `obs.switchScene` steps. The Director soft-fails them (skips with a warning), but the AI wasted a camera cut opportunity it could have filled with a different action.

The `intents` query parameter (accepted in the RC Response §5.1) partially addresses this, but it has limitations:

| Concern | `intents` Param Only | With Session Claim |
|:---|:---|:---|
| RC knows what Director can do | After first poll | Before first poll |
| RC knows Director version/identity | Never | At claim time |
| RC knows hardware connection state | Inferred (if intent is absent, maybe disconnected?) | Explicit structured health report |
| Protection against duplicate Directors | None | Exclusive claim |
| Director receives session config upfront | Never (must separately query sessions + guess mappings) | Returned in claim response |
| Clean session teardown signal | None (Director just stops polling) | Explicit release call |

### 1.2 No Mutual Exclusion on Sessions

Nothing prevents two Director instances from polling the same session simultaneously. Two Directors issuing competing camera commands to iRacing creates visual chaos — the camera teleports between targets on every frame.

### 1.3 Director Lacks Session Configuration

The `GET /api/director/v1/sessions` endpoint returns basic session metadata (name, status, centerId). But the Director never receives the operational configuration it needs:

- **Driver-to-rig-to-OBS-scene mappings:** Which OBS scene corresponds to which driver's rig?
- **Available OBS scenes:** What scene names should the Director expect?
- **OBS host address:** The session may specify a different OBS instance than the Director's default.
- **Polling configuration:** Should the Director poll every 5s or can RC suggest different intervals based on session type?

Today the Director operates with incomplete context. The claim response fills this gap.

### 1.4 No Clean Session Teardown

When the Director stops or crashes, RC has no signal. The `410 Gone` response (accepted in RC Response §5.3) handles session-initiated teardown (RC tells Director the session ended), but there is no Director-initiated teardown. RC continues generating sequences for a session that no Director is consuming.

---

## 2. Proposed Solution: Three-Phase Session Lifecycle

```
Phase 1: Claim (Pre-Race)
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  1. User selects session from dashboard                     │
│  2. Director collects capabilities (catalog + health)       │
│  3. POST /api/director/v1/sessions/{id}/claim               │
│  4. RC validates: session exists, no conflicting claim       │
│  5. RC responds: accepted + session config                  │
│  6. Director applies config (OBS host, scene mappings)      │
│  7. UI shows "Session Claimed — Ready" with green badge     │
│                                                             │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
Phase 2: Direct (Race)
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  1. User clicks "Start Engine" → auto mode                  │
│  2. CloudPoller begins polling GET .../sequences/next       │
│  3. intents param sent on each poll (lightweight delta)     │
│  4. Sequences arrive → Scheduler → Executor                 │
│  5. Capability changes mid-session sent via intents param   │
│                                                             │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
Phase 3: Release (Post-Race)
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  1. Session ends (410 Gone) → auto-release                  │
│     OR user clicks "Stop" → manual release                  │
│     OR Director process exits → TTL-based expiry            │
│  2. DELETE /api/director/v1/sessions/{id}/claim              │
│  3. RC clears the claim → session available to other        │
│     Directors                                               │
│  4. UI returns to session selection                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. API Specification

### 3.1 Claim Session

```
POST /api/director/v1/sessions/{raceSessionId}/claim
Authorization: Bearer <token>
Content-Type: application/json
```

#### Request Body

```typescript
interface SessionClaimRequest {
  /**
   * Stable identifier for this Director installation.
   * Generated once on first launch and persisted in electron-store.
   * Allows RC to distinguish between Director instances and detect
   * reconnections vs. new connections.
   */
  directorId: string;

  /**
   * Application version string (e.g., "0.1.0").
   * RC can use this for compatibility checks or future version-gated features.
   */
  version: string;

  /**
   * Capabilities snapshot at claim time.
   * This is the heavyweight handshake — full schema info, connection health.
   * Subsequent capability updates during active direction use the lightweight
   * `intents` query parameter on GET .../sequences/next.
   */
  capabilities: DirectorCapabilities;
}

interface DirectorCapabilities {
  /**
   * Active intent handlers at claim time.
   * Unlike the `intents` query parameter (comma-separated strings),
   * this includes metadata RC can use for intelligent generation:
   * - Schema information for payload validation
   * - Extension identity (which extension provides this intent)
   * - Enabled flag (installed but disabled extensions are included
   *   so RC can suggest enabling them)
   */
  intents: IntentCapability[];

  /**
   * Runtime connection state of each integration.
   * RC uses this to understand not just what intents are registered,
   * but whether the underlying hardware is actually reachable.
   *
   * Example: The OBS extension may be active (intent registered),
   * but the WebSocket to OBS may be disconnected. RC should know
   * the difference — "intent available but hardware offline" vs.
   * "intent not available at all."
   */
  connections: Record<string, ConnectionHealth>;
}

interface IntentCapability {
  /** Intent identifier (e.g., "broadcast.showLiveCam") */
  intent: string;
  /** Extension providing this intent (e.g., "iracing", "obs") */
  extensionId: string;
  /** Whether the extension is currently active (handler registered) */
  active: boolean;
  /** 
   * Optional: payload schema for this intent. 
   * Allows RC to validate its own output before sending.
   */
  schema?: Record<string, unknown>;
}

interface ConnectionHealth {
  /** Whether the integration is currently connected */
  connected: boolean;
  /** ISO8601 timestamp of last successful connection */
  connectedSince?: string;
  /** Integration-specific metadata */
  metadata?: Record<string, unknown>;
}
```

#### Example Request

```json
{
  "directorId": "d_inst_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "version": "0.1.0",
  "capabilities": {
    "intents": [
      {
        "intent": "broadcast.showLiveCam",
        "extensionId": "iracing",
        "active": true,
        "schema": {
          "type": "object",
          "properties": {
            "carNum": { "type": "string" },
            "camGroup": { "type": "string" },
            "camNum": { "type": "string" }
          },
          "required": ["carNum"]
        }
      },
      {
        "intent": "broadcast.replayFromTo",
        "extensionId": "iracing",
        "active": true
      },
      {
        "intent": "obs.switchScene",
        "extensionId": "obs",
        "active": true,
        "schema": {
          "type": "object",
          "properties": {
            "sceneName": { "type": "string" },
            "transition": { "type": "string" },
            "duration": { "type": "number" }
          },
          "required": ["sceneName"]
        }
      },
      {
        "intent": "communication.announce",
        "extensionId": "discord",
        "active": false
      },
      {
        "intent": "communication.talkToChat",
        "extensionId": "youtube",
        "active": true
      },
      {
        "intent": "system.wait",
        "extensionId": "built-in",
        "active": true
      },
      {
        "intent": "system.log",
        "extensionId": "built-in",
        "active": true
      }
    ],
    "connections": {
      "iracing": {
        "connected": true,
        "connectedSince": "2026-03-14T18:00:00Z",
        "metadata": { "sessionNum": 3 }
      },
      "obs": {
        "connected": true,
        "connectedSince": "2026-03-14T17:55:00Z",
        "metadata": { "host": "192.168.1.10:4455", "version": "30.2.3" }
      },
      "discord": {
        "connected": false
      },
      "youtube": {
        "connected": true,
        "connectedSince": "2026-03-14T18:01:00Z",
        "metadata": { "monitoring": true, "broadcastId": "dQw4w9WgXcQ" }
      }
    }
  }
}
```

#### Responses

**200 OK — Claim Accepted**

```typescript
interface SessionClaimResponse {
  /** Claim was accepted */
  claimed: true;

  /**
   * Unique claim identifier. The Director includes this in
   * subsequent requests as proof of ownership. RC can invalidate
   * claims server-side if needed.
   */
  claimId: string;

  /**
   * Claim TTL in seconds. The Director must refresh or release
   * before this expires. If the Director crashes without releasing,
   * the claim expires and the session becomes available again.
   *
   * The polling loop itself serves as the implicit heartbeat — 
   * each GET .../sequences/next resets the TTL. No separate 
   * keepalive endpoint is needed.
   */
  claimTtlSeconds: number;

  /**
   * Operational session configuration.
   * This contains data the Director needs to operate but does NOT
   * receive from the basic GET .../sessions endpoint.
   */
  sessionConfig: SessionOperationalConfig;
}

interface SessionOperationalConfig {
  /** Standard session fields (already known from list endpoint) */
  raceSessionId: string;
  name: string;
  status: string;
  simulator: string;

  /**
   * Driver-to-rig-to-scene mappings.
   * The Director's local extensions don't know which OBS scene
   * corresponds to which driver's rig. This mapping comes from
   * the Race Control session configuration.
   */
  drivers: SessionDriverMapping[];

  /**
   * Expected OBS scenes for this session.
   * RC populates this from the session's scene configuration.
   * The Director can validate against OBS's live scene list
   * and report mismatches.
   */
  obsScenes: string[];

  /**
   * OBS WebSocket host address for this session.
   * May differ from the Director's default if the center has
   * multiple OBS instances or the session uses a specific one.
   */
  obsHost?: string;

  /**
   * Suggested polling configuration.
   * RC may want to vary polling behavior based on session type,
   * expected telemetry density, or API load.
   * The Director treats these as suggestions — it has its own
   * hardcoded defaults as fallbacks.
   */
  pollingConfig?: {
    idleIntervalMs: number;    // Default: 5000
    busyIntervalMs: number;    // Default: 100
    maxBackoffMs?: number;     // Error backoff ceiling
  };
}

interface SessionDriverMapping {
  driverId: string;
  carNumber: string;
  rigId: string;
  /** OBS scene name for this driver's rig camera */
  obsSceneId: string;
  /** Display name for Director UI */
  displayName?: string;
}
```

#### Example Response (200 OK)

```json
{
  "claimed": true,
  "claimId": "claim_f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "claimTtlSeconds": 120,
  "sessionConfig": {
    "raceSessionId": "sess_a1b2c3d4",
    "name": "Saturday Night League Race — Round 7",
    "status": "ACTIVE",
    "simulator": "iracing",
    "drivers": [
      {
        "driverId": "drv_001",
        "carNumber": "63",
        "rigId": "rig-alpha",
        "obsSceneId": "Race Cam",
        "displayName": "Max Steele"
      },
      {
        "driverId": "drv_002",
        "carNumber": "17",
        "rigId": "rig-bravo",
        "obsSceneId": "Onboard 17",
        "displayName": "Ana Torres"
      },
      {
        "driverId": "drv_003",
        "carNumber": "44",
        "rigId": "rig-charlie",
        "obsSceneId": "Onboard 44",
        "displayName": "Kai Nakamura"
      }
    ],
    "obsScenes": [
      "Race Cam",
      "Onboard 17",
      "Onboard 44",
      "Pitlane",
      "Wide Shot",
      "Replay"
    ],
    "obsHost": "192.168.1.10:4455",
    "pollingConfig": {
      "idleIntervalMs": 5000,
      "busyIntervalMs": 100,
      "maxBackoffMs": 30000
    }
  }
}
```

**409 Conflict — Session Already Claimed**

Returned when another Director instance already holds an active claim on this session.

```json
{
  "error": "Session is already claimed by another Director",
  "existingClaim": {
    "directorId": "d_inst_99887766-...",
    "claimedAt": "2026-03-14T17:30:00Z",
    "expiresAt": "2026-03-14T18:30:00Z"
  }
}
```

The Director should display this to the user with options:
- **Wait** — Retry later (another operator may be using the session)
- **Force Claim** — If authorized, send `POST .../claim` with header `X-Force-Claim: true` to override (requires admin role)

**404 Not Found — Session Does Not Exist**

```json
{
  "error": "Session not found",
  "raceSessionId": "sess_nonexistent"
}
```

**410 Gone — Session Has Ended**

```json
{
  "error": "Session has ended",
  "sessionStatus": "COMPLETED"
}
```

**401 Unauthorized / 403 Forbidden** — Standard auth errors.

### 3.2 Release Session Claim

```
DELETE /api/director/v1/sessions/{raceSessionId}/claim
Authorization: Bearer <token>
X-Claim-Id: claim_f47ac10b-58cc-4372-a567-0e02b2c3d479
```

#### Responses

**204 No Content** — Claim released successfully.

**404 Not Found** — No active claim exists for this session (already expired or released).

**403 Forbidden** — The `X-Claim-Id` does not match the active claim (another Director owns it).

### 3.3 Heartbeat via Polling (Implicit — No New Endpoint)

No dedicated heartbeat endpoint is needed. The existing `GET .../sequences/next` polling loop serves as the implicit keepalive. RC resets the claim TTL on every successful poll from the claiming Director.

**RC implementation:** On each `GET .../sequences/next` request, if the `Authorization` token resolves to the same user that holds the claim, reset the `expiresAt` timestamp to `now + claimTtlSeconds`.

**Edge case: Director crashes.** The claim TTL expires naturally. With a 120-second TTL and 5-second polling, the Director has 24 missed polls before the claim lapses — ample margin for transient network issues.

### 3.4 Claim ID on Polling Requests

To tie the claim to the polling loop, the Director includes its claim ID as a header on sequence requests:

```
GET /api/director/v1/sessions/{id}/sequences/next
  ?lastSequenceId=abc-123
  &intents=broadcast.showLiveCam,obs.switchScene,...
X-Claim-Id: claim_f47ac10b-58cc-4372-a567-0e02b2c3d479
```

RC validates the claim on each poll:
- **Valid claim:** Normal response (200/204). TTL refreshed.
- **Expired claim:** `401` or `409` — Director must re-claim.
- **No claim header:** RC can choose to reject or allow (backward-compat for testing).

---

## 4. OpenAPI Specification Changes

### 4.1 New Schemas

```yaml
# Add to components/schemas

DirectorCapabilities:
  type: object
  properties:
    intents:
      type: array
      items:
        $ref: '#/components/schemas/IntentCapability'
    connections:
      type: object
      additionalProperties:
        $ref: '#/components/schemas/ConnectionHealth'
  required:
    - intents
    - connections

IntentCapability:
  type: object
  properties:
    intent:
      type: string
      description: Intent identifier (e.g., "broadcast.showLiveCam")
    extensionId:
      type: string
      description: Extension providing this intent
    active:
      type: boolean
      description: Whether the handler is currently registered and executable
    schema:
      type: object
      additionalProperties: true
      description: Optional JSON Schema for the intent's payload
  required:
    - intent
    - extensionId
    - active

ConnectionHealth:
  type: object
  properties:
    connected:
      type: boolean
    connectedSince:
      type: string
      format: date-time
    metadata:
      type: object
      additionalProperties: true
  required:
    - connected

SessionClaimRequest:
  type: object
  properties:
    directorId:
      type: string
      description: Stable identifier for this Director installation
    version:
      type: string
      description: Director application version
    capabilities:
      $ref: '#/components/schemas/DirectorCapabilities'
  required:
    - directorId
    - version
    - capabilities

SessionClaimResponse:
  type: object
  properties:
    claimed:
      type: boolean
    claimId:
      type: string
      format: uuid
      description: Unique claim identifier for subsequent requests
    claimTtlSeconds:
      type: integer
      description: Seconds before the claim expires without a polling heartbeat
    sessionConfig:
      $ref: '#/components/schemas/SessionOperationalConfig'
  required:
    - claimed
    - claimId
    - claimTtlSeconds
    - sessionConfig

SessionOperationalConfig:
  type: object
  properties:
    raceSessionId:
      type: string
      format: uuid
    name:
      type: string
    status:
      type: string
    simulator:
      type: string
    drivers:
      type: array
      items:
        $ref: '#/components/schemas/SessionDriverMapping'
    obsScenes:
      type: array
      items:
        type: string
    obsHost:
      type: string
    pollingConfig:
      type: object
      properties:
        idleIntervalMs:
          type: integer
        busyIntervalMs:
          type: integer
        maxBackoffMs:
          type: integer

SessionDriverMapping:
  type: object
  properties:
    driverId:
      type: string
    carNumber:
      type: string
    rigId:
      type: string
    obsSceneId:
      type: string
    displayName:
      type: string
  required:
    - driverId
    - carNumber
    - rigId
    - obsSceneId
```

### 4.2 New Endpoints

```yaml
/api/director/v1/sessions/{raceSessionId}/claim:
  post:
    summary: Claim a Session
    description: >
      Claims exclusive control of a race session for this Director instance.
      Exchanges capabilities (active intents, hardware connection state) with
      Race Control and receives operational session configuration in return.
      
      The claim provides mutual exclusion — only one Director can actively
      direct a session at a time. Claims have a TTL that is refreshed by
      the polling loop (GET .../sequences/next).
    tags:
      - Director
    parameters:
      - in: path
        name: raceSessionId
        schema:
          type: string
          format: uuid
        required: true
        description: The ID of the session to claim
      - in: header
        name: X-Force-Claim
        schema:
          type: boolean
        required: false
        description: >
          If true, overrides an existing claim (requires admin role).
          Use when recovering from a crashed Director that left a stale claim.
    requestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/SessionClaimRequest'
    responses:
      '200':
        description: Claim accepted. Director may begin polling for sequences.
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SessionClaimResponse'
      '401':
        description: Not authenticated.
      '403':
        description: >
          Access denied. User does not have RaceDirector role, or
          X-Force-Claim used without admin role.
      '404':
        description: Session not found.
      '409':
        description: >
          Session is already claimed by another Director instance.
          Response includes the existing claim details.
        content:
          application/json:
            schema:
              type: object
              properties:
                error:
                  type: string
                existingClaim:
                  type: object
                  properties:
                    directorId:
                      type: string
                    claimedAt:
                      type: string
                      format: date-time
                    expiresAt:
                      type: string
                      format: date-time
      '410':
        description: Session has ended. Cannot claim a completed or canceled session.
  delete:
    summary: Release a Session Claim
    description: >
      Releases the Director's exclusive claim on a session.
      Called when the Director stops directing, the user switches sessions,
      or the application exits gracefully.
    tags:
      - Director
    parameters:
      - in: path
        name: raceSessionId
        schema:
          type: string
          format: uuid
        required: true
        description: The ID of the session to release
      - in: header
        name: X-Claim-Id
        schema:
          type: string
          format: uuid
        required: true
        description: The claim ID received from the POST claim response
    responses:
      '204':
        description: Claim released successfully.
      '403':
        description: >
          The X-Claim-Id does not match the active claim.
          Another Director owns this session.
      '404':
        description: >
          No active claim exists for this session
          (already expired or released).
```

### 4.3 Modified Endpoints

Add `X-Claim-Id` header to existing `GET .../sequences/next`:

```yaml
# Add to existing parameters list
- in: header
  name: X-Claim-Id
  schema:
    type: string
    format: uuid
  required: false
  description: >
    Claim identifier from POST .../claim. When present, RC validates
    the claim and refreshes its TTL. If absent, RC may allow
    unauthenticated polling for backward compatibility / testing.
```

---

## 5. Director-Side Implementation

### 5.1 What Already Exists

| Component | Location | Readiness |
|:---|:---|:---|
| `CapabilityCatalog.toCapabilitiesPayload()` | `src/main/extension-host/capability-catalog.ts` | **Ready** — produces `{ intents, events }` with schema info |
| `CapabilityCatalog.setExtensionEnabled()` | Same file | **Ready** — tracks enabled/disabled state |
| `ExtensionHostService.hasActiveHandler()` | `src/main/extension-host/extension-host.ts` | **Ready** — checks runtime handler availability |
| `DirectorService.setSession()` | `src/main/director-service.ts` | **Needs expansion** — currently local-only |
| `AuthService.getAccessToken()` | `src/main/auth-service.ts` | **Ready** — for authenticated API calls |
| `electron-store` | Already a dependency | **Ready** — for persisting `directorId` |

### 5.2 What Needs to Be Built

| Component | Description |
|:---|:---|
| **Director Instance ID** | Generate a UUID on first launch, persist in `electron-store`. Include in all claim requests. |
| **Connection Health Collector** | Query each extension for connection state. Extensions already emit connection events — need a unified aggregator. |
| **Session Claim Service** | New service or method in `DirectorService`: `claimSession()`, `releaseSession()`. Makes the API calls, stores the `claimId`. |
| **Claim ID on Polling** | Add `X-Claim-Id` header to the `GET .../sequences/next` fetch call. |
| **Auto-Release on Exit** | Electron `before-quit` handler calls `releaseSession()`. |
| **Auto-Release on Session Change** | `setSession()` releases the old claim before claiming the new one. |
| **Session Config Application** | Use the claim response's `sessionConfig` to configure OBS host, populate driver mappings in UI, etc. |
| **UI: Claim Status Badge** | Show claimed/unclaimed state on the Director panel and dashboard card. |

### 5.3 Claim Flow Integration with Director Loop

```typescript
// In DirectorService (or future SessionManager)

async claimSession(raceSessionId: string): Promise<SessionClaimResponse> {
  const token = await this.authService.getAccessToken();
  
  const capabilities = this.buildCapabilities();
  
  const response = await fetch(
    `${apiConfig.baseUrl}/api/director/v1/sessions/${raceSessionId}/claim`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        directorId: this.getDirectorId(),
        version: app.getVersion(),
        capabilities,
      }),
    }
  );
  
  if (response.status === 409) {
    const conflict = await response.json();
    throw new SessionAlreadyClaimedException(conflict.existingClaim);
  }
  
  if (!response.ok) {
    throw new SessionClaimException(response.status, await response.text());
  }
  
  const claim = await response.json();
  this.claimId = claim.claimId;
  this.applySessionConfig(claim.sessionConfig);
  
  return claim;
}

private buildCapabilities(): DirectorCapabilities {
  const catalog = this.extensionHost.getCapabilityCatalog();
  const allIntents = catalog.getAllIntents();
  
  return {
    intents: [
      // Extension intents from catalog
      ...allIntents.map(entry => ({
        intent: entry.intent.intent,
        extensionId: entry.extensionId,
        active: entry.enabled && this.extensionHost.hasActiveHandler(entry.intent.intent),
        schema: entry.intent.schema,
      })),
      // Built-in intents (always active)
      { intent: 'system.wait', extensionId: 'built-in', active: true },
      { intent: 'system.log', extensionId: 'built-in', active: true },
    ],
    connections: this.extensionHost.getConnectionHealth(),
  };
}
```

### 5.4 setSession() Updated Flow

```typescript
async setSession(raceSessionId: string): Promise<DirectorState> {
  const wasRunning = this.isRunning;
  
  if (wasRunning) {
    this.stop();
  }
  
  // Release previous claim if any
  if (this.claimId && this.currentRaceSessionId) {
    await this.releaseSession().catch(err => 
      console.warn('[Director] Failed to release previous claim:', err.message)
    );
  }
  
  // Claim the new session
  const claim = await this.claimSession(raceSessionId);
  this.currentRaceSessionId = raceSessionId;
  
  if (wasRunning) {
    await this.start();
  }
  
  return this.getStatus();
}
```

---

## 6. Race Control Implementation Notes

### 6.1 Claim Storage

Claims are lightweight documents. Suggested Cosmos DB structure:

```json
{
  "id": "claim_f47ac10b-...",
  "raceSessionId": "sess_a1b2c3d4",
  "directorId": "d_inst_a1b2c3d4-...",
  "userId": "user_abc123",
  "capabilities": { /* ... */ },
  "claimedAt": "2026-03-14T18:00:00Z",
  "expiresAt": "2026-03-14T18:02:00Z",
  "lastPollAt": null
}
```

TTL-based expiry via Cosmos DB's native TTL feature ensures stale claims auto-clean without a background job.

### 6.2 Capability-Aware Sequence Generation

With the claim, RC has the full capability snapshot before generating the first sequence. The AI Director prompt can include:

```
Available hardware:
- iRacing: connected (broadcast.showLiveCam, broadcast.replayFromTo)
- OBS: connected (obs.switchScene) — scenes: Race Cam, Onboard 17, Onboard 44, Pitlane, Wide Shot, Replay
- YouTube Chat: connected (communication.talkToChat)
- Discord TTS: NOT connected (communication.announce unavailable)

Generate sequences using ONLY the connected capabilities.
Do NOT include communication.announce steps — Discord is offline.
```

This is far richer than a comma-separated `intents` string. The `intents` param on each poll then serves as the **lightweight update channel** — "Discord just connected, add `communication.announce` to the available intents."

### 6.3 Token Cost Impact

The claim data adds ~300 tokens to the AI Director's system prompt (cached per session). This is a one-time cost that **improves** sequence quality by preventing wasted steps on disconnected hardware. Net effect on the per-stream cost estimate: negligible (~$0.01 per 2-hour stream).

---

## 7. Questions for Race Control

| # | Question | Context |
|:---|:---|:---|
| 1 | **Claim exclusivity: hard or soft?** Should the claim be a hard lock (409 for any other Director) or a soft advisory (RC tracks the claim but doesn't reject others)? Hard lock prevents conflicts but adds operational complexity (stale claims blocking new Directors). | We propose **hard lock with TTL auto-expiry and force-claim override for admins.** |
| 2 | **Claim TTL duration?** We propose 120 seconds (24 missed polls at 5s intervals). Is this appropriate for RC's infrastructure? Too short risks false expiry; too long means a crashed Director blocks the session. | 120s seems reasonable. Open to RC's preference. |
| 3 | **Claim refresh mechanism?** We propose implicit refresh via polling (each `GET .../sequences/next` resets TTL). Alternative: explicit `PATCH .../claim` heartbeat. Implicit is simpler but couples claiming to polling. | We prefer implicit. The polling loop already runs at 5s intervals — piggybacking is natural. |
| 4 | **Session config in claim vs. separate endpoint?** Should the operational config (driver mappings, OBS scenes) be in the claim response, or should we use a separate `GET .../sessions/{id}/config` endpoint? Inline is simpler; separate allows refresh without re-claiming. | We propose inline in the claim response. If config changes mid-session, RC can push it via a new field on the `GET .../sequences/next` 200 response. |
| 5 | **Force-claim authorization?** What role should be required for `X-Force-Claim: true`? We suggest the existing admin role, distinct from the RaceDirector role. | Open to RC's RBAC model. |
| 6 | **Should RC validate capabilities on claim?** Example: if the Director reports no `broadcast.showLiveCam` intent, should RC reject the claim (can't direct without cameras) or accept with a warning? | We propose accept-with-warning. RC returns a `warnings` array in the response (e.g., `"Primary camera intent not available"`). The Director displays these in the UI. |

---

## 8. Acceptance Criteria

### Director-Side

- [ ] `directorId` is generated on first launch and persisted in `electron-store`.
- [ ] Selecting a session calls `POST .../claim` before any polling starts.
- [ ] Claim response `sessionConfig` is applied (OBS host, driver mappings).
- [ ] `claimId` is stored and sent as `X-Claim-Id` header on every `GET .../sequences/next` request.
- [ ] `409 Conflict` is handled in UI: shows existing claim info, offers retry/force-claim options.
- [ ] Switching sessions releases the old claim before claiming the new one.
- [ ] `before-quit` handler calls `DELETE .../claim` for graceful shutdown.
- [ ] Director panel shows claim status (unclaimed → claiming → claimed → released).
- [ ] Capabilities payload includes both catalog intents and runtime connection health.

### Race Control Side

- [ ] `POST .../claim` endpoint validates session exists and is not in terminal state.
- [ ] `POST .../claim` stores the claim with a TTL in Cosmos DB.
- [ ] `POST .../claim` returns `409` if another Director holds an active claim.
- [ ] `POST .../claim` with `X-Force-Claim: true` overrides existing claim (admin role required).
- [ ] `DELETE .../claim` clears the claim document.
- [ ] `GET .../sequences/next` with valid `X-Claim-Id` refreshes claim TTL.
- [ ] `GET .../sequences/next` from an un-claimed Director returns `401` or a warning (backward-compat TBD).
- [ ] AI Director prompt includes capability data from the active claim.
- [ ] Stale claims auto-expire via Cosmos DB TTL.
- [ ] `SessionOperationalConfig` is populated from the session's Cosmos DB document (drivers, scenes, OBS host).

### Integration

- [ ] End-to-end: Director claims session → polls → receives capability-tailored sequences → releases on stop.
- [ ] Director crash: claim expires after TTL → another Director can claim the session.
- [ ] Mid-session capability change: Discord connects → `intents` param on next poll includes `communication.announce` → RC begins including TTS steps.

---

## 9. Implementation Phases

| Phase | Owner | Description | Depends On |
|:---|:---|:---|:---|
| **1. Schema Agreement** | Both | Agree on `SessionClaimRequest`, `SessionClaimResponse`, `DirectorCapabilities` schemas. Add to `openapi.yaml`. | This RFC accepted |
| **2. RC Endpoint Implementation** | Race Control | Implement `POST .../claim`, `DELETE .../claim`. Claim storage in Cosmos DB with TTL. | Phase 1 |
| **3. Director Claim Flow** | Director | `claimSession()`, `releaseSession()`, `directorId` persistence, `X-Claim-Id` header on polls, `before-quit` release. | Phase 1, Phase 2 |
| **4. Connection Health API** | Director | Unified extension connection health query. Aggregate from per-extension status into `DirectorCapabilities.connections`. | None (can start immediately) |
| **5. Session Config Consumption** | Director | Apply `sessionConfig` from claim response — wire OBS host, populate driver mappings in UI, respect polling config. | Phase 3 |
| **6. Capability-Aware Generation** | Race Control | AI Director prompt includes claim capabilities. Sequence generation constrained by reported intents and connection state. | Phase 2 |
| **7. UI Polish** | Director | Claim status badges, 409 conflict handling, force-claim dialog, connection health display on Director panel. | Phase 3 |

---

## 10. Relationship to Existing Agreements

This proposal **extends** the existing Director Loop v2 RFC and RC Response. It does not contradict any previously accepted items:

| Existing Agreement | How This Proposal Relates |
|:---|:---|
| `intents` query parameter on `GET .../sequences/next` (RC Response §5.1) | **Unchanged.** The `intents` param remains the lightweight per-poll update channel. The claim is the heavyweight initial handshake. Both coexist. |
| `PortableSequence` as sole wire format (RFC §4.1) | **Unchanged.** The claim doesn't affect the sequence format. |
| `410 Gone` for ended sessions (RC Response §5.3) | **Extended.** `410` also prevents claiming ended sessions. |
| `Retry-After` on 204 (RC Response §5.2) | **Unchanged.** The claim response's `pollingConfig` supplements but doesn't replace `Retry-After`. |
| Priority semantics: cancel-and-replace (RC Response §6.1) | **Unchanged.** Priority behavior is independent of session claiming. |
| Shared Intent Registry (RFC §4.2) | **Leveraged.** The claim payload uses the same intent identifiers from the shared registry. |
