# Director Loop Feature Specification

## Overview
This feature implements the core 'Director Loop' which fetches sequences from the server and executes them locally.

## Loop Timing & Adaptive Polling

The Director Loop employs an **adaptive polling strategy** to balance responsiveness with network efficiency.

### 1. Execution Blocking
The loop is **synchronous with respect to execution**. It must strictly wait for the current sequence to fully complete (including all `WAIT` commands) before attempting to fetch the next sequence. This ensures that commands are executed in the exact order they are received and that the local state is consistent.

### 2. Adaptive Intervals
The polling interval changes based on the result of the previous fetch:

*   **Idle State (No Content)**:
    *   Condition: API returns `204 No Content`.
    *   Action: Wait for `POLL_INTERVAL_MS` (default: **5000ms**) before the next fetch.
    *   Reason: Reduces unnecessary network traffic when the queue is empty.

*   **Busy State (Sequence Executed)**:
    *   Condition: API returns `200 OK` and a sequence is executed.
    *   Action: If `totalDurationMs` is provided in the response, wait for that duration. Otherwise, wait for `BUSY_INTERVAL_MS` (default: **100ms**).
    *   Reason: Allows the server to control the pacing of the director loop.

## API Specification

### Authentication
All endpoints require Entra ID authentication. The Electron client (Main Process) must include the access token in the Authorization header.

**Header**: `Authorization: Bearer <access_token>`

### 1. List Active Sessions
**Endpoint**: `GET /api/director/v1/sessions`

**Description**: Lists active race sessions for a specific center. The Director Service currently selects the first available active session.

**Query Parameters**:
- `centerId`: `string` (Required, ID of the center)
- `status`: `string` (Optional, default: "ACTIVE")

**Response Body (200 OK)**:
```json
[
  {
    "raceSessionId": "string (uuid)",
    "name": "Practice Session A",
    "status": "ACTIVE",
    "centerId": "string (uuid)",
    "createdAt": "string (ISO8601)",
    "scheduledStartTime": "string (ISO8601)"
  }
]
```

**Response Body (200 OK - Empty)**:
- `[]` (No active sessions found)

### 2. Fetch Next Sequence
**Endpoint**: `GET /api/director/v1/sessions/{raceSessionId}/sequences/next`

**Description**: Fetches the next sequence of commands for the specific session.

**Query Parameters**:
- `directorId`: `string` (Optional, if not extracted from token)
- `currentSequenceId`: `string` (Optional, ID of the last executed sequence)
- `status`: `IDLE | BUSY | ERROR` (Current status of the director)

**Response Body (200 OK)**:
```json
{
  "sequenceId": "string (uuid)",
  "createdAt": "string (ISO8601)",
  "priority": "LOW | NORMAL | HIGH | URGENT",
  "totalDurationMs": 14629,
  "commands": [
    {
      "id": "string (uuid)",
      "type": "WAIT | LOG",
      "payload": {
        // Command specific data
      }
    }
  ]
}
```

**Response Body (204 No Content)**:
- No new sequence available.

## Data Models

### DirectorCommand
Base interface for all commands.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for the command |
| `type` | string | The type of command (e.g., 'WAIT', 'LOG') |
| `payload` | object | Command-specific parameters |

### Command Types

#### 1. WAIT
Pauses execution for a specified duration.

**Payload**:
```json
{
  "durationMs": 1000
}
```

#### 2. LOG
Logs a message to the local console/logs.

**Payload**:
```json
{
  "message": "Operation started",
  "level": "INFO | WARN | ERROR"
}
```

### DirectorSequence
A collection of commands to be executed in order.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for the sequence |
| `commands` | DirectorCommand[] | Ordered list of commands |
| `metadata` | object | Optional metadata (e.g., source, priority) |

## Testing

A standalone test script is available to verify the Director Loop logic in isolation, mocking the Electron environment and API dependencies.

### Running the Test
```bash
npm run test:director-loop
```

### Test Scope
The test (`scripts/test-director-loop.ts`):
1. Mocks `AuthService` to provide a dummy token.
2. Mocks the global `fetch` to simulate Race Control API endpoints:
   - `GET /sessions`: Returns a mock active session.
   - `GET /sequences/next`: Returns a mock sequence with a LOG command.
3. Initializes `DirectorService` and starts the loop.
4. Verifies that the service:
   - Discovers the session.
   - Polls for sequences.
   - Executes the received commands.
