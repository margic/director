# Director Loop Feature Specification

## Overview
This feature implements the core 'Director Loop' which fetches sequences from the server and executes them locally.

## API Specification

### Authentication
All endpoints require Entra ID authentication. The Electron client (Main Process) must include the access token in the Authorization header.

**Header**: `Authorization: Bearer <access_token>`

### 1. Discover Active Session
**Endpoint**: `GET /api/director/v1/sessions/active`

**Description**: Checks if the current Director (identified by the auth token or machine ID) is assigned to an active race session.

**Query Parameters**:
- `directorId`: `string` (Optional, if not extracted from token)

**Response Body (200 OK)**:
```json
{
  "raceSessionId": "string (uuid)",
  "name": "Practice Session A",
  "status": "ACTIVE"
}
```

**Response Body (404 Not Found)**:
- No active session found for this director.

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
