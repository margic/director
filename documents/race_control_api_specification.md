# Race Control API Specification for Director Integration

## Overview

This document specifies the REST API endpoints that need to be implemented in the Race Control backend to support the Director Loop feature. The Director application (Electron client) will poll these endpoints to fetch and execute sequences of commands for orchestrating broadcast operations.

## Base URL

```
https://api.simracecenter.com
```

or for development:

```
https://dev-api.simracecenter.com
```

## Authentication

All API endpoints require **Microsoft Entra ID (formerly Azure AD)** authentication. The Director application will acquire an access token through the MSAL library and include it in all API requests.

### Authentication Header

```
Authorization: Bearer <access_token>
```

### Token Requirements

- **Token Type**: OAuth 2.0 Bearer Token
- **Issuer**: Microsoft Entra ID
- **Scopes**: User.Read (minimum)
- **Claims Expected**:
  - `oid` (Object ID): Unique user identifier
  - `preferred_username`: User's email or username
  - `name`: User's display name

### Director Identification

The backend should identify the Director instance using one of the following methods (in order of preference):

1. **User Identity from Token**: Extract the user's Object ID (`oid`) or email from the token claims
2. **Query Parameter**: Accept an optional `directorId` query parameter as a fallback
3. **Custom Claim**: If Director instances are pre-registered, use a custom claim in the token

For the initial implementation, using the user's Object ID (`oid`) from the token is recommended.

---

## API Endpoints

### 1. Discover Active Session

**Purpose**: Determines if the Director (identified by the authenticated user) is assigned to an active race session. This is called once when the Director service starts.

#### Request

```http
GET /api/director/v1/sessions/active
```

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `directorId` | string | No | Optional Director identifier (if not extracted from token) |

#### Request Headers

```http
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGc...
```

#### Response (200 OK)

**Description**: An active session is found for this Director.

```json
{
  "raceSessionId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Practice Session A",
  "status": "ACTIVE",
  "createdAt": "2025-12-28T10:00:00Z",
  "scheduledStartTime": "2025-12-28T14:00:00Z"
}
```

**Response Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `raceSessionId` | string (UUID) | Unique identifier for the race session |
| `name` | string | Human-readable name of the session |
| `status` | enum | Session status: `PLANNED`, `ACTIVE`, `COMPLETED`, `CANCELED` |
| `createdAt` | string (ISO 8601) | Timestamp when the session was created |
| `scheduledStartTime` | string (ISO 8601) | Optional scheduled start time for the session |

#### Response (404 Not Found)

**Description**: No active session is assigned to this Director.

```json
{
  "error": "NO_ACTIVE_SESSION",
  "message": "No active race session found for this Director",
  "timestamp": "2025-12-28T10:00:00Z"
}
```

#### Response (401 Unauthorized)

**Description**: Invalid or missing authentication token.

```json
{
  "error": "UNAUTHORIZED",
  "message": "Invalid or expired authentication token",
  "timestamp": "2025-12-28T10:00:00Z"
}
```

#### Response (500 Internal Server Error)

**Description**: Server error occurred while processing the request.

```json
{
  "error": "INTERNAL_SERVER_ERROR",
  "message": "An unexpected error occurred",
  "timestamp": "2025-12-28T10:00:00Z"
}
```

---

### 2. Fetch Next Sequence

**Purpose**: Retrieves the next sequence of commands for execution. The Director polls this endpoint continuously (every 5 seconds) during operation. Returns a sequence if available, or 204 No Content if no new sequence is pending.

#### Request

```http
GET /api/director/v1/sessions/{raceSessionId}/sequences/next
```

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `raceSessionId` | string (UUID) | Yes | The race session ID returned from the active session endpoint |

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `directorId` | string | No | Optional Director identifier (if not extracted from token) |
| `currentSequenceId` | string (UUID) | No | ID of the last successfully executed sequence (for tracking/debugging) |
| `status` | enum | No | Current status of the Director: `IDLE`, `BUSY`, `ERROR` |

**Status Parameter Values**:
- `IDLE`: Director is waiting for new sequences
- `BUSY`: Director is currently executing a sequence
- `ERROR`: Director encountered an error during execution

#### Request Headers

```http
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGc...
```

#### Request Example

```http
GET /api/director/v1/sessions/550e8400-e29b-41d4-a716-446655440000/sequences/next?status=IDLE&currentSequenceId=a1b2c3d4-e5f6-4789-a012-3456789abcde
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGc...
```

#### Response (200 OK)

**Description**: A new sequence is available for execution.

```json
{
  "sequenceId": "b2c3d4e5-f6a7-4890-b123-456789abcdef",
  "createdAt": "2025-12-28T10:05:30Z",
  "priority": "NORMAL",
  "commands": [
    {
      "id": "c3d4e5f6-a7b8-4901-c234-56789abcdef0",
      "type": "LOG",
      "payload": {
        "message": "Starting broadcast sequence for driver change",
        "level": "INFO"
      }
    },
    {
      "id": "d4e5f6a7-b8c9-4012-d345-6789abcdef01",
      "type": "WAIT",
      "payload": {
        "durationMs": 2000
      }
    },
    {
      "id": "e5f6a7b8-c9d0-4123-e456-789abcdef012",
      "type": "LOG",
      "payload": {
        "message": "Broadcast sequence completed successfully",
        "level": "INFO"
      }
    }
  ]
}
```

**Response Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `sequenceId` | string (UUID) | Unique identifier for this sequence |
| `createdAt` | string (ISO 8601) | Timestamp when the sequence was created |
| `priority` | enum | Optional priority level: `LOW`, `NORMAL`, `HIGH`, `URGENT` |
| `commands` | array | Ordered list of commands to execute |

**Command Structure**:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Unique identifier for this command |
| `type` | enum | Command type (see Command Types section) |
| `payload` | object | Command-specific parameters |

#### Response (204 No Content)

**Description**: No new sequence is available at this time. The Director should continue polling.

**Body**: Empty

#### Response (404 Not Found)

**Description**: The specified race session does not exist or is not assigned to this Director.

```json
{
  "error": "SESSION_NOT_FOUND",
  "message": "Race session not found or not assigned to this Director",
  "timestamp": "2025-12-28T10:05:30Z"
}
```

#### Response (401 Unauthorized)

**Description**: Invalid or missing authentication token.

```json
{
  "error": "UNAUTHORIZED",
  "message": "Invalid or expired authentication token",
  "timestamp": "2025-12-28T10:05:30Z"
}
```

#### Response (500 Internal Server Error)

**Description**: Server error occurred while processing the request.

```json
{
  "error": "INTERNAL_SERVER_ERROR",
  "message": "An unexpected error occurred",
  "timestamp": "2025-12-28T10:05:30Z"
}
```

---

## Command Types

The Director supports various command types for orchestrating broadcast operations. Initially, two command types are implemented: `WAIT` and `LOG`. Additional command types can be added in the future.

### 1. WAIT Command

**Purpose**: Pauses execution for a specified duration. Useful for timing sequences.

**Type**: `WAIT`

**Payload**:

```json
{
  "durationMs": 1000
}
```

**Payload Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `durationMs` | number | Yes | Duration to wait in milliseconds (min: 0, max: 300000 = 5 minutes) |

**Example**:

```json
{
  "id": "d4e5f6a7-b8c9-4012-d345-6789abcdef01",
  "type": "WAIT",
  "payload": {
    "durationMs": 2000
  }
}
```

---

### 2. LOG Command

**Purpose**: Logs a message to the Director's local console and log files. Useful for debugging and tracking sequence execution.

**Type**: `LOG`

**Payload**:

```json
{
  "message": "Operation started successfully",
  "level": "INFO"
}
```

**Payload Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | Yes | The message to log (max length: 1000 characters) |
| `level` | enum | Yes | Log level: `INFO`, `WARN`, `ERROR` |

**Example**:

```json
{
  "id": "c3d4e5f6-a7b8-4901-c234-56789abcdef0",
  "type": "LOG",
  "payload": {
    "message": "Starting broadcast sequence for driver change",
    "level": "INFO"
  }
}
```

---

## Data Models

### DirectorCommand

Base structure for all command types.

```typescript
interface DirectorCommand {
  id: string;          // UUID
  type: CommandType;   // 'WAIT' | 'LOG' | ...future types
  payload: object;     // Command-specific data
}
```

### DirectorSequence

A collection of commands to be executed in order.

```typescript
interface DirectorSequence {
  sequenceId: string;           // UUID
  createdAt: string;            // ISO 8601 timestamp
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  commands: DirectorCommand[];  // Ordered array of commands
}
```

### RaceSession

Represents an active race session.

```typescript
interface RaceSession {
  raceSessionId: string;           // UUID
  name: string;                    // Human-readable name
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELED';
  createdAt: string;               // ISO 8601 timestamp
  scheduledStartTime?: string;     // Optional ISO 8601 timestamp
}
```

---

## Implementation Considerations

### 1. Queue Management

The backend should maintain a **queue of sequences** for each race session. When a Director requests the next sequence:

1. Check if there are pending sequences in the queue
2. Return the oldest undelivered sequence (FIFO order)
3. Mark the sequence as "delivered" to prevent duplicate delivery
4. Consider implementing a delivery acknowledgment mechanism in a future iteration

**Recommendation**: Use a database table or distributed queue (Azure Service Bus, Azure Queue Storage) to manage sequences reliably.

### 2. Sequence Creation

Sequences can be created by:

1. **Manual Creation**: Via a Race Control UI where operators create sequences
2. **Automated Events**: Triggered by race events (e.g., driver change, incident, session start/end)
3. **Broadcast Agent**: AI-powered assistant that generates sequences based on context

The API should support a separate endpoint for sequence creation (not covered in this spec, as it's internal to Race Control).

### 3. Polling vs. Push

The current design uses **polling** (Director requests sequences every 5 seconds). This is simple and reliable but not as real-time as push-based solutions.

**Future Enhancement**: Consider implementing WebSocket or Server-Sent Events (SSE) for push-based sequence delivery to reduce latency and server load.

### 4. Error Handling

The Director should implement retry logic for failed API calls:

- **Transient Errors** (network issues, 5xx errors): Retry with exponential backoff
- **Permanent Errors** (401, 404): Stop polling and notify the user
- **Rate Limiting**: Respect `Retry-After` headers if rate limiting is implemented

**Recommendation**: Implement standard HTTP rate limiting (429 Too Many Requests) on the backend.

### 5. Security Considerations

- **Token Validation**: Validate the Entra ID token on every request
- **Authorization**: Ensure Directors can only access sessions assigned to them
- **Rate Limiting**: Prevent abuse by limiting requests per Director
- **Audit Logging**: Log all sequence deliveries for compliance and debugging

### 6. Monitoring and Observability

The backend should expose metrics for:

- **Sequence Queue Depth**: Number of pending sequences per session
- **Delivery Latency**: Time from sequence creation to delivery
- **Director Polling Rate**: Requests per minute per Director
- **Error Rate**: Failed requests by type (401, 404, 500, etc.)

**Recommendation**: Use Azure Application Insights or similar for centralized monitoring.

### 7. Database Schema

Suggested tables for implementation:

#### `RaceSessions` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | string | Session name |
| `status` | enum | PLANNED, ACTIVE, COMPLETED, CANCELED |
| `director_id` | string | Assigned Director identifier |
| `created_at` | timestamp | Creation time |
| `scheduled_start_time` | timestamp | Optional start time |

#### `DirectorSequences` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `race_session_id` | UUID | Foreign key to RaceSessions |
| `priority` | enum | LOW, NORMAL, HIGH, URGENT |
| `created_at` | timestamp | Creation time |
| `delivered_at` | timestamp | Delivery timestamp (null if not delivered) |
| `commands` | JSON | Serialized array of commands |

**Note**: Azure Cosmos DB can be used instead of a relational database, storing sequences as JSON documents.

---

## Example Flow

### 1. Director Starts

```
Director → GET /api/director/v1/sessions/active
← 200 OK { raceSessionId: "550e8400...", name: "Practice A", status: "ACTIVE" }
```

### 2. Director Begins Polling

```
Director → GET /api/director/v1/sessions/550e8400.../sequences/next?status=IDLE
← 204 No Content (no sequences yet)
```

### 3. Operator Creates a Sequence in Race Control

Backend creates a sequence with 3 commands and adds it to the queue.

### 4. Director Polls Again (5 seconds later)

```
Director → GET /api/director/v1/sessions/550e8400.../sequences/next?status=IDLE
← 200 OK {
  sequenceId: "b2c3d4e5...",
  createdAt: "2025-12-28T10:05:30Z",
  commands: [...]
}
```

### 5. Director Executes Sequence

Director processes each command in order, updating its status to `BUSY`.

### 6. Director Reports Completion

```
Director → GET /api/director/v1/sessions/550e8400.../sequences/next?status=IDLE&currentSequenceId=b2c3d4e5...
← 204 No Content (no new sequences)
```

---

## Future Enhancements

### 1. Sequence Acknowledgment

Add a POST endpoint for the Director to acknowledge sequence completion:

```http
POST /api/director/v1/sessions/{raceSessionId}/sequences/{sequenceId}/ack
```

This enables:
- Tracking sequence execution history
- Retry logic for failed sequences
- Analytics on sequence success rates

### 2. Command Expansion

Additional command types to support:

- **OBS_SCENE**: Switch OBS broadcast scene
- **OBS_SOURCE**: Toggle OBS source visibility
- **IRACING_CAMERA**: Control iRacing camera position
- **IRACING_REPLAY**: Trigger replay playback
- **DISCORD_MESSAGE**: Send voice/text message to Discord
- **YOUTUBE_CHAT**: Post message to YouTube live chat

### 3. Real-Time Push

Implement WebSocket or SSE for real-time sequence delivery:

```http
GET /api/director/v1/sessions/{raceSessionId}/sequences/stream
```

### 4. Director Health Monitoring

Add a heartbeat endpoint for the backend to monitor Director health:

```http
POST /api/director/v1/heartbeat
```

### 5. Sequence Prioritization

Support urgent sequences that jump the queue (already included in schema).

---

## Testing Recommendations

### Unit Tests

- Token validation logic
- Sequence queue management
- Command serialization/deserialization

### Integration Tests

- End-to-end sequence delivery flow
- Error handling (401, 404, 500)
- Concurrent Director polling

### Load Tests

- Simulate 10+ Directors polling simultaneously
- Test queue performance with 100+ pending sequences
- Measure API latency under load

### Security Tests

- Invalid/expired tokens
- Cross-Director session access attempts
- SQL injection in query parameters (if applicable)

---

## Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-28 | Initial API specification based on Director mock implementation |

---

## References

- [Feature Specification: Director Loop](./feature_director_loop.md)
- [Project Overview](./overview.md)
- [Microsoft Entra ID Documentation](https://learn.microsoft.com/en-us/entra/identity/)
- [Azure Cosmos DB Best Practices](https://learn.microsoft.com/en-us/azure/cosmos-db/)

---

## Contact

For questions or clarifications about this API specification, please contact the Race Control development team or create an issue in the GitHub repository.
