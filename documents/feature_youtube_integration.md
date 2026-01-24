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
    - `system.extension.login`: Trigger the OAuth login flow (generic pattern).
- **Events**:
    - `chat.messageReceived`: emitted when a new chat message is ingested (Scraper/API).

### Backend Implementation (`src/extensions/youtube/index.ts`)
- **Authentication**: Uses a localized OAuth strategy. Credentials are managed securely within the extension sandbox or passed via Settings.
- **Intent Handling**: The `talkToChat` intent calls the YouTube Data API to insert a message.

### Frontend Integration (Renderer)
The UI (`YoutubePage.tsx`) has been updated to be a pure "Control Deck" for the extension.
- **Status**: Visual indicator of whether the extension is Active and Authenticated.
- **Login**: A "Sign In" button triggers the `system.extension.login` intent, delegating the complex auth flow to the backend extension.
- **Migration**: Legacy chat service code has been removed from the Main process.

## Legacy Migration
The monolithic `YoutubeService` in the Main process has been deprecated and its IPC channels removed. The application now routes all YouTube interactions through the Extension Host.

