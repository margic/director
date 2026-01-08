# YouTube Integration Feature Specification

## Overview
This feature implements the integration with **YouTube Live Chat** API. This allows the Director application to monitor incoming chat messages from a live broadcast and execute `VIEWER_CHAT` commands to post messages back to the stream.

## Design Pattern: Module-Based Dashboard
This feature follows the standard "Module-Based Dashboard" pattern:
1.  **Sidebar**: Adds a YouTube icon (Play Button/Video) to the main navigation.
2.  **Preview Module**: Adds a "YouTube Chat" card to the main dashboard.
    - Displays a metric of chat messages received (e.g., "152 MPs").
    - Displays the configuration status (e.g., "Video Configured" or "No Video").
    - Clicking it navigates to the Detail Page.
3.  **Detail Page**: A dedicated view (`/youtube`) for configuration and selection of the active live broadcast.

## Scope

### 0. Authentication Experience (User Flow)
Since YouTube requires a separate Google OAuth token with write permissions (`force-ssl`), the authentication flow is distinct from the main application login:
1.  **Initiation**: On the YouTube Detail Page (`/youtube`), if not authenticated, the user sees a "Connect YouTube Account" button.
2.  **Browser Flow**: Clicking the button opens the user's default system browser to the Google OAuth consent screen.
3.  **Consent**: The user logs in to Google and grants permission to the Director app to manage their YouTube account.
4.  **Callback**: 
    - The browser redirects to a lightweight local web server started by the app (e.g., `http://localhost:3000/callback`).
5.  **Completion**: The Director app receives the tokens (access & refresh), stores them securely, and the UI updates to show "Connected".

### 1. Configuration
- **Channel ID**: "RaceCenter" (the remote configuration source or local settings) must provide the target `channelId`.
- **Video ID**: The specific live video ID to connect to. This is dynamic and selected by the Director.

### 2. Backend (Main Process)
- **Library**: Use `googleapis` (official Google Node.js client) for interacting with the YouTube Data API v3.
- **Service**: Create `YoutubeService` class.
    - **Authentication**: Usage of `googleapis` OAuth2 client. 
      - Must handle the "Connect" flow described in section 0.
      - *Note: Requires distinct scope `https://www.googleapis.com/auth/youtube.force-ssl`.*
    - **Video Discovery**:
        - Method `fetchActiveVideos()`: Queries the API for live broadcasts associated with the configured `channelId`.
    - **Chat Polling**:
        - Once a `videoId` is selected, fetch the `liveChatId`.
        - Implement a polling loop (respecting API quota/poll rates) to fetch new messages.
        - Track "Messages Received" metric.
    - **Chat Forwarding (Ingest)**:
        - Identify new unique messages during polling.
        - Forward them to the Race Control API to enable AI Agent responses.
        - **Endpoint**: `POST /api/director/v1/chat/ingest`
        - **Payload**:
          ```json
          {
            "raceSessionId": "active-session-guid",
            "source": "YOUTUBE",
            "authorName": "Display Name",
            "authorAvatarUrl": "https://...",
            "messageContent": "The original text message",
            "externalId": "unique-youtube-message-id",
            "timestamp": "ISO-8601-Date-Time"
          }
          ```
    - **Command Execution**:
        - Implement `postMessage(text)` to send messages to the chat.
- **IPC Handlers**:
    - `youtube:get-status`: Returns `{ connected: boolean, videoId: string | null, messageCount: number }`.
    - `youtube:search-videos`: Trigger a search for active live streams on the channel. returns list of videos `{ id, title }`.
    - `youtube:set-video`: Sets the active `videoId` for chat polling.

### 3. Frontend (Renderer)
- **Navigation**: Update `App.tsx` and Sidebar to include the YouTube section.
- **Preview Module**:
    - **Metrics**: Big number for "Messages Received".
    - **Status Badge**:
        - Green: "Live" (Video ID configured).
        - Grey: "Idle" (No Video ID).
- **Detail Page (`YoutubePage.tsx`)**:
    - **Configuration Section**:
        - Display current `channelId`.
        - **Action**: "Fetch Live Video" button.
        - **Selection**: A list/dropdown of found live videos to "Attatch" the Director to.
    - **Status Panel**:
        - Current Status (Active/Idle).
        - Live Chat ID.
        - Message Counter.

### 4. Command Handler Integration
- Update `ViewerChatHandler` in `src/main/handlers/viewer-chat-handler.ts`.
- **Logic**:
    - Integrate `YoutubeService` to actually send the message when a `VIEWER_CHAT` command is processed.
