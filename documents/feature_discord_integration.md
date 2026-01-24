# Discord Integration

> **Status: Active Extension**
> This feature is implemented as an extension located at `src/extensions/discord`.
> It provides generic Audio/Communication capabilities.

## Architecture: Extension Extension
The Discord integration is now a standard extension using the `communication.announce` intent.

### Manifest (`package.json`)
- **ID**: `director-discord`
- **Intents**:
    - `communication.announce`: Play an audio message (TTS or File) to the configured Discord channel.

### Backend Implementation (`src/extensions/discord/index.ts`)
The extension wraps the `discord.js` library.
- **Connection**: Managed via Settings configuration passed to the extension.
- **Audio**: Streams audio data to the Discord Voice Connection when the intent is received.

### Frontend Integration
The Discord controls currently reside in the generic Settings or Dashboard area. As it is primarily an Output-only extension (Command driven), it does not require a complex Control Deck like iRacing.

