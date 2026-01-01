# Sequence Executor Feature Specification

## Overview
The Sequence Executor is responsible for processing and executing `DirectorSequence` objects received from the Race Control API via the Director Loop. It acts as the central dispatch mechanism that routes specific commands to their respective handlers, ensuring modularity and separation of concerns.

## Scope & Acceptance Criteria

**Goal**: Implement the core executor logic and the command handler architecture.

**In Scope**:
- `SequenceExecutor` class implementation (iterating commands, error handling).
- `CommandHandler` interface definition.
- `CommandHandlerRegistry` implementation.
- **Full Implementation**:
  - `WAIT` command handler.
  - `LOG` command handler.
- **Stub Implementation** (Log intent only):
  - `SWITCH_CAMERA` (iRacing integration).
  - `SWITCH_OBS_SCENE` (OBS integration).
  - `DRIVER_TTS` (Discord/LLM integration).
  - `VIEWER_CHAT` (YouTube integration).

**Out of Scope**:
- Actual integration with external services (iRacing SDK, OBS WebSocket, Discord Bot, YouTube API). These will be implemented in separate, dedicated feature branches.

## Architecture

### Command Pattern
The feature implements the **Command Pattern**. The `SequenceExecutor` iterates through the list of commands in a sequence. For each command, it identifies the `type` and delegates execution to a registered **Command Handler**.

### Handler Interface
Each command type has a dedicated handler implementing a common interface:

```typescript
interface CommandHandler<T extends BaseCommand> {
  execute(command: T): Promise<void>;
}
```

### Registry
A `CommandHandlerRegistry` maps `CommandType` strings to their corresponding handler instances. This allows for easy extension of new command types without modifying the core executor logic.

## Command Types & Specifications

The following command types are supported. All types must be aligned with the OpenAPI specification.

### 1. SWITCH_CAMERA
**Description**: A camera switch request used to switch the camera view being rendered in the race directors iRacing session used to provide the director view for the broadcast output.
**Payload**:
```json
{
  "carNumber": "string", // Target car number (e.g. "63")
  "cameraGroup": "string", // e.g., "TV1", "Cockpit", "Rear Chase"
  "cameraNumber": "number" // Optional specific camera index
}
```
**Implementation Notes**:
- **Current Feature**: Implement as a **STUB**. Log the camera switch request to the console (e.g., `[STUB] Switching camera to Car 63 - TV1`).
- **Future Integration**: Direct integration with iRacing SDK (via `node-irsdk` or similar).
- **Logic**:
  - On receiving a SWITCH_CAMERA message, the director app will create an iRacing windows command event message (or use SDK broadcast messages) to send a command to iRacing to switch camera.
  - Must handle cases where the car is not on track.

### 2. WAIT
**Description**: A generic wait request that will cause the sequencer to add a pause to the sequence execution for the appropriate time.
**Payload**:
```json
{
  "durationMs": 1000
}
```
**Implementation Notes**:
- **Full Implementation Required**.
- Non-blocking for the main thread (use `setTimeout` / `Promise` delay).
- Essential for pacing sequences.

### 3. SWITCH_OBS_SCENE
**Description**: A command that changes the OBS scene using a WebSocket integration with OBS to allow the director to control the OBS broadcast output.
**Payload**:
```json
{
  "sceneName": "string",
  "transition": "string", // Optional transition override
  "duration": "number" // Optional transition duration
}
```
**Implementation Notes**:
- **Current Feature**: Implement as a **STUB**. Log the scene switch request (e.g., `[STUB] Switching OBS Scene to 'Driver 1'`).
- **Future Integration**:
  - **Library**: Use `obs-websocket-js` (Node.js equivalent of `obsws-python`).
  - **Connection**: Requires `host`, `port`, and `password` configuration.
  - **Logic**:
    - Maintain a persistent connection or connect on demand (persistent preferred).
    - `SetCurrentProgramScene` request to switch scenes.
    - `GetSceneList` to verify scene existence before switching.
    - Handle connection failures gracefully (log error, continue sequence).

### 4. LOG
**Description**: Log a message in the log for the director. This is a command message added for convenience to allow the Race Control to embed logging statements into sequence executions.
**Payload**:
```json
{
  "message": "string",
  "level": "INFO | WARN | ERROR"
}
```
**Implementation Notes**:
- **Full Implementation Required**.
- Writes to the application's internal log.

### 5. DRIVER_TTS (Text-to-Speech)
**Description**: A driver text-to-speech function that receives a text message that needs to be conveyed to the drivers. It is converted to audio and fed to the Discord race channel.
**Payload**:
```json
{
  "text": "string",
  "voiceId": "string", // Optional voice selection
  "channelId": "string" // Optional target Discord channel
}
```
**Implementation Notes**:
- **Current Feature**: Implement as a **STUB**. Log the TTS request (e.g., `[STUB] TTS: "Gentlemen, start your engines"`).
- **Future Integration**:
  - **TTS Generation**: Use Google Gemini API (or similar) to generate audio from text.
    - Model: `gemini-2.0-flash-exp` (or current available model).
    - Output: WAV format (48kHz, mono, 16-bit preferred for Discord).
  - **Discord Playback**:
    - Requires a Discord Bot Token.
    - Use a library like `discord.js` (Node.js) to connect to the voice channel.
    - `joinVoiceChannel` -> `createAudioResource` -> `player.play()`.
    - **Latency**: This is a high-latency operation. The executor should probably *start* the process and not block the entire sequence for the duration of the speech, unless specifically desired. However, for simple sequences, awaiting completion is safer.
    - **Fallback**: If Gemini fails, log error.

### 6. VIEWER_CHAT
**Description**: Send a chat message to the live stream chat in the YouTube channel.
**Payload**:
```json
{
  "platform": "YOUTUBE | TWITCH",
  "message": "string"
}
```
**Implementation Notes**:
- **Current Feature**: Implement as a **STUB**. Log the chat message request (e.g., `[STUB] Posting to YouTube: "Welcome to the stream!"`).
- **Future Integration**:
  - **YouTube API**:
    - Requires OAuth 2.0 credentials (`client_secrets.json`).
    - Scope: `https://www.googleapis.com/auth/youtube.force-ssl` (or similar write scope).
    - Endpoint: `liveChatMessages.insert`.
    - Needs `liveChatId` from the active broadcast. This might need to be fetched first via `liveBroadcasts.list`.
  - **Twitch API** (Future/Optional):
    - IRC based or Helix API.
  - **Logic**:
    - Ensure OAuth token is valid (refresh if needed).
    - Resolve `liveChatId` if not cached.
    - Post message.
    - Handle rate limits and quota errors.

## Error Handling

- **Individual Command Failure**: If a command fails (e.g., OBS not connected), the executor should log the error.
- **Sequence Continuation**: By default, failure of a non-critical command (like LOG) should not stop the sequence. Critical failures (like WAIT failing?) might need different handling.
- **Timeout**: Commands should have a default timeout to prevent the executor from hanging indefinitely.

## Future Considerations
- **Parallel Execution**: Currently, commands are executed sequentially. Future versions might support `PARALLEL` blocks.
- **Conditional Logic**: Simple `IF` logic based on telemetry data (e.g., "If Leader Gap < 1s, Switch to Camera X").
