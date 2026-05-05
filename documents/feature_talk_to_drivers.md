# Talk to Drivers — Discord Voice + TTS

> STATUS: IMPLEMENTED. Source of truth: `src/extensions/discord/index.ts`,
> `src/extensions/discord/package.json`,
> `src/main/discord-service.ts`, `src/main/auth-config.ts`.

Director can announce messages by speaking them into a Discord voice
channel that the race team is in. The text is synthesised by the Race
Control TTS API; the resulting audio is played by a Discord bot.

This is a **dual-component** feature, like OBS:

1. **The `director-discord` extension** — exposes the
   `communication.announce` broadcast intent. Has no Discord
   connection of its own; just delegates.
2. **The `DiscordService` singleton** — owns the single bot `Client`
   and the voice connection, fetches TTS audio, and plays it. Lives
   in the main process so it can spawn FFmpeg (which a utility
   process cannot do reliably).

The split is necessary because Discord.js needs a privileged
environment to spawn FFmpeg, and only one bot client may be alive at a
time per token.

## Extension

`name: "director-discord"`. Contributes a single broadcast intent:

```json
{
  "intent": "communication.announce",
  "title": "Announce Message",
  "category": "broadcast",
  "schema": {
    "type": "object",
    "properties": { "message": { "type": "string" } },
    "required": ["message"]
  }
}
```

The extension's `activate(api)` registers the handler and forwards via
the `invoke` bridge:

```ts
api.registerIntentHandler('communication.announce',
  async (payload: { message: string; context?: TtsContext; voice?: string }) => {
    await api.invoke('discordPlayTts', payload.message, payload.context, payload.voice);
  });
```

`api.invoke('discordPlayTts', …)` round-trips to the main process via
the `INVOKE` IPC message and is dispatched by the
`extensionHost.registerInvokeHandler('discordPlayTts', …)` handler
wired in `main.ts`:

```ts
extensionHost.registerInvokeHandler('discordPlayTts',
  async (args: any[]) => {
    const [text, context, voice] = args;
    return discordService.playTts(text, { context, voice });
  });
```

This is the **only** registered invoke handler in the codebase today.

The extension declares two settings: `discord.channelId` (plain) and
`discord.token` (secure, auto-routed through `safeStorage`).

## `DiscordService`

`src/main/discord-service.ts`. One instance per app launch.

### Lifecycle

```
constructor:    Build Client (with Guilds + GuildVoiceStates intents)
                Build AudioPlayer with NoSubscriberBehavior.Pause

connect(token, channelId):
  - logout existing client if any
  - client.login(token)
  - on 'ready':
      channels.fetch(channelId)
      joinVoiceChannel({ channelId, guildId, adapterCreator })
      entersState(VoiceConnectionStatus.Ready, 30_000ms)
      connection.subscribe(player)
      status.connected = true
  - on Disconnected: status.connected = false, no automatic reconnect

disconnect():
  - connection.destroy()
  - client.destroy()
  - status reset
```

`status` is `DiscordStatus = { connected, channelName?, lastMessage?,
messagesSent }` and is exposed via `discordGetStatus()` on the preload.

There is **no automatic reconnect** in `DiscordService`. If the bot
gets disconnected (e.g. token rotated, channel deleted), the operator
must explicitly call `discordConnect(...)` again. This is different
from `ObsService`, which polls every 5 s.

### Auto-connect on startup

In `src/main/main.ts`, after `extensionHost.start()`:

```ts
const discordConfig = configService.get('discord');
const token = await configService.getSecure('discord.token');
if (discordConfig?.autoConnect && discordConfig.channelId && token) {
  discordService.connect(token, discordConfig.channelId);
}
```

## TTS API contract

Used by `discordService.playTts(text, options)` and called against
`apiConfig.baseUrl + apiConfig.endpoints.tts` =
`https://simracecenter.com/api/tts`.

```http
POST /api/tts
Authorization: Bearer {rcAccessToken}
Content-Type: application/json
Accept: audio/wav

{
  "text": "Lap 12, P3 holding the gap",
  "context": { "type": "race_update", "urgency": "medium" },
  "voice": "rachel"   ← optional override
}
```

`context.type` enumeration (matches the Race Control OpenAPI spec):
`race_update`, `commentary`, `safety`, `driver_message`. `context.urgency`
is `low | medium | high`. If `options.context` is omitted, the service
defaults to `{ type: 'race_update', urgency: 'medium' }`.

### Response

| Status | Body | Behaviour |
|---|---|---|
| `200 OK` | `audio/wav` binary | Read as `arrayBuffer()`, wrapped in a Discord audio resource, played to the connected voice channel. |
| `4xx` / `5xx` | text/json error | Logged, exception thrown back to the caller. |

The service throws if not currently connected to a voice channel
(`status.connected === false`). The intent handler in the extension
catches and logs — sequences continue per soft-failure semantics.

### Voice preference

`window.electronAPI.discordUpdateVoicePreference(voice)` calls
`PUT /api/auth/user/voice` (`apiConfig.endpoints.userVoice`) to persist
the operator's preferred voice with their profile. Subsequent
`playTts` calls without an explicit `voice` argument rely on the cloud
having that preference on file (the API selects the voice
server-side based on the authenticated user's stored preference; the
client does not need to send it on every call).

## FFmpeg packaging

`@discordjs/voice` requires `ffmpeg` on the PATH or via
`ffmpeg-static`. In the packaged build, `ffmpeg-static`'s binary lives
under `app.asar` — which cannot be `spawn`ed. The fix is in
`src/main/discord-service.ts:24..57` and in `package.json`:

```json
"build": {
  "asarUnpack": [ "node_modules/ffmpeg-static/**" ]
}
```

In dev the binary is resolved by `require('ffmpeg-static')`. In a
packaged build, the path is reconstructed against
`process.resourcesPath/app.asar.unpacked/node_modules/ffmpeg-static/`
and `prism-media`'s internal FFmpeg cache is monkey-patched via
`PrismFFmpeg.getInfo = () => ({ command, output, version })` so the
library never tries to `require()` the binary at runtime.

If you forget the `asarUnpack` entry, the packaged app will:

- Connect to Discord successfully.
- Fail to play the first TTS call with `ENOENT spawn ffmpeg`.

## Status events

`DiscordService` does NOT emit on the extension event bus directly.
Connection state is reported via:

- `discordGetStatus()` polled by the renderer.
- `extensionHost.setConnectionHealth('director-discord', connected)`
  invoked from `main.ts:obs-extension toggle code` — but for Discord
  this is currently only set on connect/disconnect from the singleton,
  not on every state change. (Improvement opportunity: emit a synthetic
  `discord.connectionStateChanged` event for parity with OBS/iRacing.)

## Settings UI

The Discord settings page (`src/renderer/pages/settings/discord/`)
reads `discord.channelId` from `config.get('discord')` and the bot
token from `config.isSecureSet('discord.token')`. Saving the token
calls `config.saveSecure('discord.token', value)` which routes through
`safeStorage`.

## Voice channel lifecycle (operator workflow)

1. Operator pastes the bot token in Settings → Discord, ticks
   "Auto-connect", picks a voice channel id.
2. On next app launch, `DiscordService.connect(token, channelId)`
   joins the channel and stays joined for the whole session.
3. Each `communication.announce` intent triggers a TTS POST and plays
   the audio.
4. On app quit, `client.destroy()` runs — Discord considers the bot
   to have disconnected gracefully.

The bot does NOT leave the channel between announcements; this avoids
the 1–2 s reconnect penalty before each call.
