# Discord & Driver Voice Integration Feature Specification

## Overview
This feature implements the **"Driver Voice" Output System**, enabling the Race Director to broadcast audio announcements directly to a Discord Voice Channel where drivers are listening.

Unlike the previous POC (which was a standalone service), this implementation integrates the Discord Voice client directly into the **Director Application**. The Director app receives commands from the Race Control API (as part of `DirectorSequence`) and relays the audio to the active Discord session.

## Feature Intent
*   **Direction**: Output (Director -> Discord).
*   **Content**: Audio messages (TTS or Pre-recorded) generated or specified by Race Control.
*   **Audience**: Drivers in the Discord Voice Channel.

## Architecture

1.  **Race Control API**: Generates a `DirectorSequence` containing `DRIVER_TTS` (or `PLAY_AUDIO`) commands.
    *   *Logic*: The API decides *what* to say and *when*.
    *   *Payload*: Contains text (for local synthesis) or an audio URL.
2.  **Director (Main Process)**:
    *   Maintains a persistent connection to the Discord Gateway (Bot).
    *   Joins the configured Voice Channel.
    *   Executes the command by playing the audio stream to the channel.

## Scope

### 1. Backend (Main Process)
- **Service**: `DiscordService`.
    - **Connection**: Connects to Discord using a Bot Token (from Settings/Env).
    - **Voice Management**: Joins/Leaves Voice Channels.
    - **Playback**: Streams audio to the Voice Connection.
- **Dependencies**: TBD (Likely `discord.js` + `@discordjs/voice` + `ffmpeg-static` or `sodium`). *Note: Current implementation uses stubs/mocks until dependencies are added.*
- **Commands**:
    - `DRIVER_TTS`: Synthesize text (using system TTS or cloud API) -> Stream to Discord.
    - `PLAY_AUDIO`: Stream provided URL -> Discord.

### 2. Frontend (Renderer)
- **Navigation**: "Driver Voice" (Mic Icon).
- **Preview Module**:
    - Status: Connected/Disconnected (Voice Channel).
    - Data: "Channel: #drivers-briefing".
- **Detail Page (`DiscordPage.tsx`)**:
    - **Connection Config**: Bot Token (masked), Guild ID, Channel ID input.
    - **Status Panel**: Connection State, Current Channel, Latency.
    - **Manual Override**: Text input to manually send a TTS announcement to the channel.
    - **Logs**: History of messages sent.

## API & Data Types

**Command Payload (`DRIVER_TTS`)**:
```typescript
interface DriverTtsCommandPayload {
  text: string;      // The message to speak
  voiceId?: string;  // Preferred voice
  channelId?: string;// Target channel override
}
```

## Comparisons to Legacy POC (`ttsdiscord`)
*   **Legacy**: Separate Python Microservice listening to NATS.
*   **New**: Integrated Electron Module polling HTTP API.
*   **Commonality**: Both output audio to Discord.

## Implementation Status (Current)
- [x] **Architecture Refactor**: Updated to Output-only model.
- [x] **Backend Service**: `DiscordService` implemented (Stubbed logic).
- [x] **UI**: `DiscordPage` implemented with connection controls and manual TTS test.
- [x] **Command Handler**: `DriverTtsHandler` routed to service.
- [x] **Verification**: Logic verified via headless test script (`scripts/test-discord-integration.ts`).
