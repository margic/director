# Stream Chat — YouTube Live

> STATUS: PARTIAL. Source of truth: `src/extensions/youtube/index.ts`.
>
> The `communication.talkToChat` send-path is **not yet implemented**
> end-to-end (the function logs `"sendMessageToChat not fully
> implemented in extension yet (Migration in progress)"`). Read
> path (scraper + stats) is implemented. This document marks each
> capability as complete or partial.

The YouTube extension lets Director:

- **Read** chat messages from the operator's currently active YouTube
  Live broadcast (via a hidden scraper window).
- **Send** messages into the chat from sequences (planned —
  `communication.talkToChat` intent registered but not wired through).
- Authenticate to YouTube via OAuth2 so it can find the active
  broadcast and (eventually) post messages.

## Manifest summary

`name: "director-youtube"`. Contributes:

| Kind | Items |
|---|---|
| **Intents** | `director.youtube.login`, `director.youtube.logout`, `youtube.startMonitor`, `youtube.stopMonitor`, `communication.talkToChat { message }` |
| **Events** (emitted) | `youtube.status { monitoring: boolean }`, `youtube.stats { messagesReceived, messagesSent }` |
| **Settings** | `youtube.clientId`, `youtube.clientSecret` (secure), `youtube.refreshToken` (secure), `youtube.channelId` |

> **Note on intent naming**: earlier docs claimed
> `communication.chat.send` and `communication.chat.monitor`. Those
> never existed in code. The actual handlers are
> `communication.talkToChat`, `youtube.startMonitor`, and
> `youtube.stopMonitor`.

## OAuth2 flow

YouTube auth uses the **Desktop App** OAuth2 flow with a localhost
redirect URI. This is required by Google for refresh-token issuance.

### Required Google Cloud Console setup

The operator must:

1. Create a Google Cloud project.
2. Enable the YouTube Data API v3.
3. Create OAuth credentials of type **Desktop app**.
4. Copy the Client ID and Client Secret into Director Settings.

### Constants

```ts
const SCOPES       = ['https://www.googleapis.com/auth/youtube.force-ssl'];
const REDIRECT_URI = 'http://localhost:3000/callback';
```

The redirect URI is **fixed at port 3000** — the extension starts an
`http.createServer().listen(3000, …)` to receive the callback. If port
3000 is already in use the auth flow will fail; there is no dynamic
port discovery.

(Earlier docs claimed dynamic port allocation. That is not what the
code does.)

### Sequence

1. Operator clicks "Login to YouTube" → fires
   `director.youtube.login`.
2. Extension constructs an `OAuth2Client` with the configured
   `clientId`/`clientSecret`/`REDIRECT_URI`.
3. Generates an auth URL with `access_type: 'offline'` (mandatory for
   refresh tokens) and the `youtube.force-ssl` scope.
4. Calls `api.openExternal(authUrl)` — opens the system browser.
5. Starts a one-shot HTTP server on port 3000 to catch the redirect.
6. Google redirects to `http://localhost:3000/callback?code=...`.
7. Extension exchanges the code for tokens via `oauth2Client.getToken(code)`.
8. If `tokens.refresh_token` is present, persists it via
   `api.updateSetting('youtube.refreshToken', refreshToken)` (auto-routed
   through `safeStorage`).
9. Closes the HTTP server. Subsequent app launches load the refresh
   token and skip the interactive flow.

`director.youtube.logout` clears the persisted refresh token by
calling `api.updateSetting('youtube.refreshToken', null)` and drops
the in-memory `OAuth2Client`.

## Reading chat — the scraper approach

Google does not expose YouTube live-chat messages over the API in
real time at a useful rate (the polling endpoints have aggressive
quotas). Director side-steps this by **opening the chat popout in a
hidden BrowserWindow** and reading messages from the DOM.

### Flow

1. Operator (or sequence) fires `youtube.startMonitor`.
2. Extension authenticates to the YouTube Data API and calls
   `liveBroadcasts.list({ broadcastStatus: 'active', broadcastType: 'all' })`
   to find the current broadcast id.
3. Constructs the popout chat URL:
   `https://www.youtube.com/live_chat?is_popout=1&v={broadcastId}`.
4. Calls `api.openScraper(url, script?)` — this returns a `windowId`
   for a hidden `BrowserWindow` created by the main process with the
   `preload-scraper.js` preload.
5. The preload injects a `MutationObserver` (or, if the extension
   provides a `script` argument, runs that script first) that watches
   the chat container and posts each new message back via
   `electron.ipcRenderer.send('youtube-scraper:message', payload)`.
6. The main process receives that IPC message and forwards it to the
   extension as a `SCRAPER_MESSAGE`. The extension's
   `registerScraperMessageHandler` callback receives `{ author,
   message, timestamp }`.

`youtube.stopMonitor` calls `api.closeScraper(windowId)` and emits
`youtube.status { monitoring: false }`.

### Stats

The extension keeps an in-memory counter `{ messagesReceived,
messagesSent }` and emits `youtube.stats` after each increment. The
renderer subscribes via `extensions.onExtensionEvent` and updates the
panel.

## What is NOT implemented

These were named in earlier documents but are not on the active path:

- **`communication.chat.send` / `communication.chat.monitor`** —
  these intent names do not exist. The real names are
  `communication.talkToChat`, `youtube.startMonitor`, `youtube.stopMonitor`.
- **`youtube.auth` / `youtube.error`** — events listed in older docs
  but never emitted by the active code. The only emitted events are
  `youtube.status` and `youtube.stats`.
- **End-to-end send-message** — `sendMessageToChat()` in
  `youtube/index.ts` is a stub:
  ```ts
  director.log('warn',
    'sendMessageToChat not fully implemented in extension yet (Migration in progress)');
  ```
  Calling `communication.talkToChat` will increment the sent counter
  but **will not** post to YouTube. To complete: discover
  `liveChatId` via `youtube.liveBroadcasts.list({ id })`, then
  `youtube.liveChatMessages.insert({ part: 'snippet', requestBody: { snippet: { liveChatId, type: 'textMessageEvent', textMessageDetails: { messageText } } } })`.

If you are regenerating from this spec, **either** wire the send-path
properly **or** drop `communication.talkToChat` from the manifest
until it works. Do not ship a broadcast intent that silently fails
in production — it will be selected by the AI Planner.

## Settings UI

`src/renderer/pages/settings/youtube/`. Saves `clientId`/`clientSecret`/
`channelId` via `config.set('youtube', …)` and (for the secret) via
`config.saveSecure('youtube.clientSecret', …)`. The operator triggers
login via the "Authenticate with YouTube" button which calls
`extensions.executeIntent('director.youtube.login', {})`.

The persisted `youtube.refreshToken` is written by the extension
itself via `api.updateSetting`, not by the renderer.

## Why scraper instead of Server-Sent Events

YouTube does not currently expose an SSE or WebSocket stream for
live-chat messages. The polling API
(`youtube.liveChatMessages.list`) costs 5 quota units per call and
returns messages with up to a 5-second delay. For a busy chat that
reads several messages per second, the quota is exhausted in
minutes. The popout DOM is the only way to get real-time chat without
quota cost.

The trade-off: a YouTube layout change can break the scraper. The
`MutationObserver` script lives in the main process preload
(`src/main/preload-scraper.ts`) and may need updating if YouTube
restructures the chat container.
