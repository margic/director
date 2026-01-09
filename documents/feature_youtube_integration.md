# YouTube Integration Feature Specification

## Overview
This feature implements a hybrid integration with **YouTube Live Chat**. To bypass strict API quota limits, it uses a **Hidden Window Scraper** for reading chat messages (Ingest) and the **YouTube Data API v3** solely for posting responses (Command Execution).

## Design Pattern: Module-Based Dashboard
This feature follows the standard "Module-Based Dashboard" pattern:
1.  **Sidebar**: Adds a YouTube icon (Play Button/Video) to the main navigation.
2.  **Preview Module**: Adds a "YouTube Chat" card to the main dashboard.
    - Displays a metric of chat messages received (e.g., "152 MPs").
    - Displays the configuration status (e.g., "Video Configured" or "No Video").
    - Clicking it navigates to the Detail Page.
3.  **Detail Page**: A dedicated view (`/youtube`) for configuration and selection of the active live broadcast.

## Scope

### 0. Authentication & Security
The application must manage persistent credentials for YouTube without requiring the user to login on every launch.
- **Reference**: See [`documents/security_design.md`](./security_design.md) for full implementation details.
- **Account Type**: Supports standard Google Accounts (does not require Channel Owner status, just a manager/editor with rights).
- **Persistence**: 
    - Use `electron-store` for general configuration (Channel ID, Video ID).
    - Use Electron's `safeStorage` API to encrypt and store the `refresh_token` and `access_token` on the local filesystem.
    - On app launch, attempt to decrypt and load tokens. If valid, auto-connect.
- **Scope**: `https://www.googleapis.com/auth/youtube.force-ssl` (send/receive chat).

### 1. Configuration & UI (Settings Page)
The configuration is moved from a dedicated YouTube detail page to a centralized **Settings Page**.
- **New Page**: Create `src/renderer/pages/SettingsPage.tsx`.
- **Navigation**: Wire up the existing "Settings" cog icon in the sidebar to navigate to this view.
- **Section**: "Linked Accounts".
- **YouTube Card**:
    - **State: Disconnected**:
        - Button: "Connect YouTube Account".
        - Action: Initiates the OAuth flow (opens system browser).
    - **State: Connected**:
        - Display: "Connected as [Channel Name/User Name]".
        - Button: "Disconnect / Sign Out" (Clears stored tokens).
    - **Settings**:
        - Input: "Target Channel ID" (The channel to monitor).
        - Toggle: "Auto-Connect at Startup".

### 2. Backend (Main Process)
- **Library**: Use `googleapis` (official Google Node.js client) for interacting with the YouTube Data API v3.
- **Service**: Create `YoutubeService` class.
    - **Authentication**: Usage of `googleapis` OAuth2 client. 
      - Must handle the "Connect" flow described in section 0.
      - *Note: Requires distinct scope `https://www.googleapis.com/auth/youtube.force-ssl`.*
    - **Video Discovery**:
        - Method `fetchActiveVideos()`: Queries the API for live broadcasts associated with the configured `channelId`.
    - **Chat Ingest (Hidden Window Strategy)**:
        - **Mechanism**: Instead of using the API to poll messages (which consumes massive quota), create a hidden Electron `BrowserWindow`.
        - **URL**: Load `https://www.youtube.com/live_chat?v={VIDEO_ID}`.
        - **Preload Script**: Inject a script to observe the DOM (`#items` container) for new messages using `MutationObserver`.
        - **Data Extraction**: Parse the DOM nodes to extract Author, Text, and Timestamp.
        - **IPC**: The hidden window sends new messages to the Main process via `ipcRenderer.send('youtube-chat-scraper:message', payload)`.
    - **Chat Forwarding**:
        - Receiver in Main process listens for the scraped messages.
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
          } (API)**:
        - Implement `postMessage(text)` using the `googleapis` client.
        - This operation costs ~50 quota units but is low volume.
        - **Command Execution**:
        - Implement `postMessage(text)` to send messages to the chat.
- **IPC Handlers**:
    - `youtube:get-status`: Returns `{ connected: boolean, videoId: string | null, messageCount: number }`.
    - `youtube:search-videos`: Trigger a search for active live streams on the channel. returns list of videos `{ id, title }`.
    - `youtube:set-video`: Sets the active `videoId` for chat polling.

### 3. Frontend (Renderer)
- **Navigation**: 
    - Add `Settings` view state to `App.tsx`.
    - Activate the Settings Cog button.
    - Add `YouTube` view state for the monitoring dashboard.
- **Preview Module (Dashboard)**:
    - **Metrics**: Big number for "Messages Received".
    - **Status Badge**:
        - Green: "Live" (Video ID configured).
        - Grey: "Idle" (No Video ID).
- **Detail Page (`YoutubePage.tsx`)**:
    - **Purpose**: Operational monitoring (Chat stream, status), *not* configuration.
    - **Action**: "Fetch Live Video" (Uses the authenticated account from Settings).
    - **Status Panel**:
        - Current Status (Active/Idle).
        - Live Chat ID.
        - Message Counter.
- **Settings Page (`SettingsPage.tsx`)**:
    - Implement the "Linked Accounts" UI described in Section 1.

### 4. Error Handling & Edge Cases
- **Quota Exceeded**:
    - If API returns 403 (Quota Exceeded) during SEND operations:
    - Log error to telemetry.
    - Disable further "Send" attempts for 1 hour.
    - Show a toast notification to the user: "YouTube Daily Quota Reached - Chat Responses Disabled".
- **Token Expiry**:
    - `YoutubeService` must capture 401 errors.
    - Automatically attempt `oAuthClient.refreshAccessToken()`.
    - If refresh fails, transition state to "Disconnected" and prompt user to re-link.
- **Broadcast Ended**:
    - If the scraper detects a "Stream Offline" DOM state or API returns "video not found":
    - Transition Status Badge to "Ended".
    - Stop the scraper hidden window.

### 5. Acceptance Criteria
- [ ] **Config**: User can link a standard Google Account via Settings Page.
- [ ] **Config**: Tokens survive application restart (encrypted).
- [ ] **Config**: User can search/select a Live broadcast from the specific Channel ID.
- [ ] **Ingest**: Dashboard displays a real-time count of incoming messages without using API quota (Hybrid Verification).
- [ ] **Ingest**: Incoming messages are successfully forwarded to the Race Control API `POST /chat/ingest`.
- [ ] **Output**: The "Broadcast Agent" sends a `VIEWER_CHAT` command which successfully posts a comment to the live YouTube stream.
- [ ] **Security**: Tokens are NOT stored in plain text in `config.json` or `localStorage`.

### 6. IPC Channels Summary
| Channel | Direction | Payload |
| :--- | :--- | :--- |
| `youtube:auth-start` | Renderer -> Main | void |
| `youtube:auth-disconnect` | Renderer -> Main | void |
| `youtube:status-change` | Main -> Renderer | `{ connected, videoId, messageCount }` |
| `youtube:search-videos` | Renderer -> Main | `{ channelId }` |
| `youtube:set-video` | Renderer -> Main | `{ videoId }` |
| `youtube-scraper:message` | Hidden -> Main | `{ author, text, timestamp }` |

### 7. Comamnd Handler Integration
- Update `ViewerChatHandler` in `src/main/handlers/viewer-chat-handler.ts`.
- **Logic**:
    - Integrate `YoutubeService` to actually send the message when a `VIEWER_CHAT` command is processed.
