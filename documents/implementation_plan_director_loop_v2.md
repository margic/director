# Implementation Plan: Director Loop v2

## Overview

This document describes the implementation of the **Director Loop** — the cloud-driven automation engine that connects the Director App to the Sim RaceCenter Race Control API. The loop polls for sequences, executes them using the Sequence Executor, and reports status back to the cloud.

## Background

### Architecture Context

The Director App operates in two modes:
- **Manual Mode**: Operators trigger sequences manually via the UI ("Control Deck")
- **Auto Mode (Director Loop)**: The app polls the Race Control cloud API for AI-generated sequences and executes them automatically

### Cloud vs. Local Telemetry

- The **Sim RaceCenter Cloud** (Race Control) receives live telemetry from each simulator rig
- The **Media Control Rig** (running the Director App) does **not** receive iRacing telemetry due to processing overhead constraints
- As a result, the Director App relies on the cloud for sequencing decisions; it does not compute them locally

### Race Control API Integration

All sequence decisions are made server-side. The Director App:
1. Discovers active race sessions via `GET /api/director/v1/sessions`
2. Polls for the next sequence via `GET /api/director/v1/sessions/{sessionId}/sequences/next`
3. Reports its current status and last completed sequence to the server with each poll

## Implementation Details

### 1. Session Discovery

**Endpoint**: `GET /api/director/v1/sessions?centerId={centerId}`

The director auto-selects the first active session. The `centerId` is retrieved from the authenticated user's profile.

**Status**: ✅ Implemented in `DirectorService.listSessions()`

### 2. Director Loop — Adaptive Polling

The loop is **synchronous with respect to execution**: it waits for the current sequence to fully complete before fetching the next one.

**Polling strategy**:
| Condition | Interval |
|:---|:---|
| API returns `204 No Content` | `POLL_INTERVAL_MS` (5000ms) |
| API returns `200 OK` with `totalDurationMs` | `totalDurationMs` |
| API returns `200 OK` without `totalDurationMs` | `BUSY_INTERVAL_MS` (100ms) |

**Status**: ✅ Implemented in `DirectorService.loop()` and `DirectorService.fetchAndExecuteNextSequence()`

### 3. Status Reporting (v2 Enhancement)

Each poll to the `sequences/next` endpoint now includes the director's current state as query parameters:

| Parameter | Type | Description |
|:---|:---|:---|
| `status` | `IDLE \| BUSY \| ERROR` | Current status of the director |
| `currentSequenceId` | `string` (optional) | ID of the last successfully executed sequence |

**Example request**:
```
GET /api/director/v1/sessions/abc-123/sequences/next?status=IDLE&currentSequenceId=seq-456
```

This allows the Race Control server to:
- Know whether the director is ready to accept a new sequence
- Track sequence acknowledgement and prevent re-delivery
- Build an accurate picture of director health

**Status**: ✅ Implemented — `DirectorService` tracks `lastCompletedSequenceId` and includes both `status` and `currentSequenceId` in every poll request

### 4. Sequence Execution Engine

The Director Loop uses the existing `SequenceExecutor` (intent-driven, headless runtime) to execute sequences received from the API.

**Normalization flow**:
```
Race Control API Response (legacy CommandType[])
    ↓  DirectorService.normalizeApiResponse()
PortableSequence (intent-based)
    ↓  SequenceExecutor.execute()
Extension Intents dispatched to handlers
```

The `normalizeApiResponse()` adapter maps legacy command types to semantic intents:
| API Command Type | Intent |
|:---|:---|
| `SWITCH_CAMERA` | `broadcast.showLiveCam` |
| `SWITCH_OBS_SCENE` | `obs.switchScene` |
| `DRIVER_TTS` | `communication.announce` |
| `VIEWER_CHAT` | `communication.talkToChat` |
| `WAIT` | `system.wait` |
| `LOG` | `system.log` |
| `EXECUTE_INTENT` | *(passthrough — unwrapped)* |

**Status**: ✅ Implemented

### 5. OBS Session Configuration

If the active session includes an `obsHost` field, the director logs the OBS host for future use. Full dynamic OBS configuration (via extension intent) is a future enhancement once the OBS extension supports a `connect` intent.

**Status**: 🔲 Deferred — placeholder logging exists in `DirectorService.start()`

## Testing

A standalone integration test verifies the director loop in isolation:

```bash
npm run test:director-loop
```

The test (`scripts/test-director-loop.ts`):
1. Mocks `AuthService` with a dummy token
2. Mocks `ExtensionHostService` with stub handlers for all intents
3. Mocks `global.fetch` to simulate the Race Control API
4. Starts `DirectorService`, waits for the loop to run, then stops it
5. Verifies session discovery, polling, and sequence execution

## API Specification Reference

The official source of truth for the Race Control API is the OpenAPI specification:
- **Spec**: https://api.simracecenter.com/api/openapi.yaml
- **Docs**: https://api.simracecenter.com/api/docs

If the API behaviour differs from the spec, raise an issue at:
- https://github.com/margic/racecontrol/issues

## Future Enhancements

| Item | Description |
|:---|:---|
| OBS Dynamic Config | Dispatch `obs.connect` intent when session provides an `obsHost` |
| Multi-Session Support | Allow director to join a specific session (not just the first one) |
| Reconnect on Session End | Auto-discover a new session when the current one ends |
| Priority Queue | Support `URGENT` priority sequences that interrupt the current queue |
