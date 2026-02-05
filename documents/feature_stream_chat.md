# Feature: Stream Chat Management

> **Status:** Active (Implemented via YouTube Extension)
> **Extension Location:** `src/extensions/youtube`
> **Primary Intents:** `communication.chat.send`, `communication.chat.monitor`

## 1. Feature Overview
The "Stream Chat Management" feature enables the Race Control system (Director) to interact with the audience on the live broadcast platform. This includes monitoring the chat for questions or issues and responding automatically (via AI/Director sequences) or manually.

### User Story
> "As a Race Director, I want to be able to monitor the live stream chat and respond, both manually and automatically, so that I can engage with the audience and provide updates without leaving the Director console."

## 2. Abstraction & Intents
This feature abstracts the broadcast platform (YouTube, Twitch, Kick) into a generic "Stream Chat" interface.

### Defined Intents
The feature contributes the following intents:

#### `communication.chat.send`
Post a text message to the live stream chat.
*   **Parameters**:
    *   `message` (string): The content to post.
*   **Behavior**: The active chat provider posts the message as the authenticated channel owner (or bot).

#### `communication.chat.monitor`
Actively listen for new chat messages.
*   **Parameters**:
    *   `enable` (boolean): Start or stop the monitoring process.
    *   `videoId` (string, optional): Specific stream to monitor (if platform requires).
*   **Events Emitted**:
    *   `chat.message`: Fired when a new message is detected. Includes `user`, `text`, `timestamp`.

## 3. Current Implementation: YouTube & Scraper
The reference implementation is the **YouTube Extension**. Due to YouTube API quota limitations, this implementation uses a hybrid approach.

### 3.1 Technical Architecture
1.  **Sending (API)**:
    *   Uses the official YouTube Data API V3 (via OAuth) to post messages reliably.
2.  **Monitoring (Scraper)**:
    *   Uses a hidden Electron `BrowserWindow` to load the live chat popout.
    *   Injects a script to observe the DOM for new messages.
    *   This bypasses polling limits and provides real-time updates without consuming API quota.

### 3.2 Manifest Definition
```json
{
  "name": "director-youtube",
  "displayName": "YouTube Live Stream Integration",
  "contributes": {
    "intents": [
      {
        "name": "communication.chat.send",
        "description": "Send a message to the YouTube Live Chat",
        "schema": { "type": "object", "properties": { "message": { "type": "string" } } }
      },
      {
        "name": "communication.chat.monitor",
        "description": "Start/Stop the chat scraper"
      }
    ],
    "views": [
      { "id": "youtube-controls", "type": "panel" },
      { "id": "youtube-widget", "type": "widget" }
    ]
  }
}
```

## 4. Alternative Implementations (Future)
*   **Twitch Integration**: IRC-based connection (simpler than YouTube).
*   **Kick/Facebook/Trovo**: Other streaming platforms using similar bot/scraper mechanics.



