# YouTube Integration

> **Status: Active Extension**
> This feature is fully implemented as an extension located at `src/extensions/youtube`.
> It provides generic Chat Context and Communication capabilities to the Director.

## Architecture: Extension Extension
The YouTube integration runs as an isolated extension, handling authentication, polling (future), and message posting.

### Manifest (`package.json`)
- **ID**: `director-youtube`
- **Intents**:
    - `communication.talkToChat`: Post a message to the active live chat.
    - `youtube.startMonitor`: Start the hidden scraper to listen for chat.
    - `youtube.stopMonitor`: Stop/Close the scraper.
- **Commands**:
    - `director.youtube.login`: Trigger the OAuth login flow. (Internal Configuration Command).

### Backend Implementation (`src/extensions/youtube/index.ts`)
- **Authentication**: Uses a localized OAuth strategy for SENDING messages.
- **Monitoring**: Uses a **Hidden Browser Window (Scraper)** to listen for live chat events without quota limits.
   - The Scraper injects a script into the Live Dashboard or Popout Chat.
   - New messages are emitted as `chat.messageReceived` events.

### Frontend Integration (Renderer)
The UI (`YoutubePage.tsx`) has been updated to be a pure "Control Deck" for the extension.
- **Broadcast Monitor**: Controls to start/stop the scraper process.
- **Chat Control**: Manual input to send messages to the stream via the API.
- **Status Preview**: Widget displays "Messages Sent" and "Messages Received" counts.



