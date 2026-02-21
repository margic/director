# Feature: Talk to Drivers (Communication System)

> **Status:** Active (Implemented via Discord Extension + DiscordService)
> **Extension Location:** `src/extensions/discord`
> **Core Service:** `src/main/discord-service.ts`
> **Primary Intent:** `communication.announce`

## 1. Feature Overview
The "Talk to Drivers" feature allows the Race Control system (Director) to broadcast audible messages to race participants. This is critical for conveying high-priority instructions that might be missed in text chat, such as "Red Flag", "Safety Car Deployed", or "Driver Briefing Started".

### User Story
> "As a Race Director, I want to automatically or manually broadcast voice messages to the drivers' specified voice channel so that I can issue penalties, safety car instructions, or start/stop commands clearly."

## 2. Abstraction & Intents
To align with the **Director Extension System**, this feature is defined by its *Intent*, not its implementation. The Core system issues a command to "Announce", and the loaded Communication Extension handles the delivery.

### Defined Intents
The feature contributes the following intents to the Director ecosystem:

#### `communication.announce`
Broadcasting a message to the entire field.
*   **Parameters**:
    *   `message` (string, required): Text to be converted to speech via the Race Control TTS API.
*   **Behavior**: The active communication provider takes the input and broadcasts it to the configured voice channel.

#### `communication.direct` (Future)
Talking to a specific driver or team.
*   **Parameters**: `driverId`, `message`.

## 3. Architecture

The Discord integration follows a **split-responsibility** pattern consistent with other Director integrations (e.g., OBS):

| Layer | Component | Responsibility |
|:------|:----------|:---------------|
| **Main Process** | `DiscordService` (`discord-service.ts`) | Owns the single `discord.js` Client, voice connection, audio player, FFmpeg bridge, TTS API calls, and connection status. |
| **Extension** | `director-discord` (`extensions/discord/index.ts`) | Lightweight adapter — registers the `communication.announce` intent handler and delegates TTS playback to `DiscordService` via the `invoke()` bridge. |
| **Renderer** | Status & Settings panels (`extensions/discord/renderer/`) | UI for connection status, manual TTS testing, and configuration (token, channel ID, auto-connect). |

### 3.1 Why a Single Client?

An earlier revision had the extension spawn its own `discord.js` Client in the Extension Host child process, while `DiscordService` maintained a separate Client in the main process for the panel UI. This caused:

- **Status mismatch**: The panel polled `DiscordService.getStatus()` which never reflected the extension's connection.
- **Double login**: Two bot clients consumed resources and could conflict.
- **FFmpeg duplication**: The packaged-app FFmpeg workaround (asar-unpack + prism-media monkey-patch) only existed in `DiscordService`.

The current architecture unifies everything under `DiscordService`. The extension is a thin intent-routing layer — no networking dependencies of its own.

### 3.2 Invoke Bridge

Extensions run in an Electron `utilityProcess` and cannot directly import main-process singletons. The `invoke()` bridge solves this:

```
Extension (child process)                    Main Process
─────────────────────────                    ─────────────
director.invoke('discordPlayTts', text)  →   extensionHost.handleInvoke()
                                              → customInvokeHandlers['discordPlayTts']
                                              → discordService.playTts(text)
```

The handler is registered in `main.ts` at startup:
```ts
extensionHost.registerInvokeHandler('discordPlayTts', async ([text]) => {
  return discordService.playTts(text);
});
```

## 4. Connection Lifecycle

### 4.1 Auto-Connect
Discord auto-connect mirrors the OBS pattern and is controlled by the `discord.autoConnect` config setting:

```
App Start → Extension Host starts → Extensions loaded → Sequence Library initialized
  → Check: discord extension enabled? AND discord.autoConnect === true?
    → Yes: Read token (secure store) + channelId (config)
      → discordService.connect(token, channelId)
    → No: Skip (user can connect manually from the panel)
```

### 4.2 Manual Connect / Disconnect
The panel's Connect and Disconnect buttons invoke `discord:connect` / `discord:disconnect` IPC handlers in `main.ts`, which call `discordService.connect()` / `discordService.disconnect()`.

### 4.3 Extension Enable/Disable
When the Discord extension is toggled via the Extensions panel:
- **Disabled**: `discordService.disconnect()` is called.
- **Enabled**: If `autoConnect` is on and credentials are present, `discordService.connect()` is called.

## 5. Configuration

Settings are stored via `ConfigService` (`electron-store`):

| Key | Type | Storage | Description |
|:----|:-----|:--------|:------------|
| `discord.enabled` | `boolean` | Config | Extension enabled/disabled |
| `discord.channelId` | `string` | Config | Target Discord voice channel ID |
| `discord.autoConnect` | `boolean` | Config | Connect automatically on startup |
| `discord.token` | `string` | Secure (safeStorage) | Discord bot token |

The Settings panel (`extensions/discord/renderer/Settings.tsx`) provides inputs for the token, channel ID, and an auto-connect toggle.

## 6. TTS Pipeline

1. **Trigger**: A Sequence step (e.g., "Full Course Yellow") fires the `communication.announce` intent with `{ message: "Safety car deployed" }`.
2. **Routing**: The Extension Host dispatches to the `director-discord` extension's registered handler.
3. **Delegation**: The extension calls `director.invoke('discordPlayTts', message)`.
4. **API Call**: `DiscordService.playTts()` obtains an auth token via `AuthService`, then POSTs to the Race Control TTS API (`/api/tts`) with the text.
5. **Audio Playback**: The returned WAV audio buffer is wrapped in a `Readable` stream, turned into a `createAudioResource`, and played through the `AudioPlayer` subscribed to the voice connection.

### FFmpeg in Packaged Builds
`@discordjs/voice` depends on `prism-media` which requires FFmpeg. In packaged Electron apps, the `ffmpeg-static` binary is inside the asar archive and cannot be spawned. The solution:
- `ffmpeg-static/**` is listed in `asarUnpack` in `package.json`.
- `discord-service.ts` monkey-patches `PrismFFmpeg.getInfo()` at module load to point at the unpacked binary path.

## 7. Panel UI

### Status Tab
- Polls `discord:get-status` IPC every 3 seconds.
- Shows **ONLINE** / **OFFLINE** badge, channel name, messages sent count.
- Connect / Disconnect buttons.
- Manual TTS test input with broadcast button.
- Event log of recent TTS operations.

### Settings Tab
- Bot Token (password field, shows "Token is set" when stored).
- Voice Channel ID.
- Auto-Connect toggle (`Switch` component).
- Save button persists all fields.

## 8. Manifest Definition

```json
{
  "name": "director-discord",
  "version": "1.0.0",
  "main": "index.js",
  "displayName": "Discord Integration",
  "description": "Provides Discord features including text-to-speech announcements.",
  "contributes": {
    "intents": [
      {
        "intent": "communication.announce",
        "title": "Announce Message",
        "description": "Announces a message via Discord TTS.",
        "schema": {
          "type": "object",
          "properties": {
            "message": { "type": "string" }
          },
          "required": ["message"]
        }
      }
    ],
    "settings": {
      "discord.channelId": {
        "type": "string",
        "description": "The Voice Channel ID to join."
      },
      "discord.token": {
        "type": "string",
        "description": "Bot Token (Secure)"
      }
    }
  }
}
```

## 9. Alternative Implementations (Future)
By focusing on the "Talk to Drivers" feature set, we allow for future drivers to be swapped in without changing the core automation sequences:
*   **TeamSpeak Integration**: Common in older leagues.
*   **iRacing Radio**: Using the iRacing SDK to transmit directly to the in-game radio frequency (if API permits).
*   **SRS / SRCom**: Integration with dedicated Sim Racing voice tools.

