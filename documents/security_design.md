# Security Design & Architecture

Current as of: January 2026
Version: 1.0

## Overview

Sim RaceCenter Director is an on-premise "Bridge Application" that connects a local racing simulator environment (OBS, iRacing, Hardware) with the cloud-based Race Control platform. Because it bridges local hardware with cloud identities, security is a primary design constraint.

This document outlines our approach to authentication, token storage, and process isolation.

## 1. Authentication Strategy

The application manages two distinct layers of identity:

### A. App Identity (Microsoft Entra ID)
*   **Purpose**: Logs the user into the Sim RaceCenter platform.
*   **Provider**: Microsoft Entra ID (MSAL Node).
*   **Flow**: Device Code Flow (preferred for extensive permissions) or Interactive Browser Flow.
*   **Tokens**:
    *   **Access Token**: Short-lived (1 hour), bearer token for API calls.
    *   **Refresh Token**: Long-lived, used to acquire new access tokens silently.

### B. Linked Accounts (OAuth2)
*   **Purpose**: Allows the Director to perform actions on third-party platforms (YouTube, Twitch, Discord).
*   **Provider**: Google Identity Services (YouTube), Twitch ID, etc.
*   **Scope**: Detailed in feature specifications. We request strictly minimal scopes (e.g., `youtube.force-ssl` for chat management).
*   **Flow**: Standard Authorization Code Flow with PKCE where supported.
    *   User initiates login from the Settings page.
    *   System browser opens for consent.
    *   Local loopback server receives the callback code.

## 2. Secure Storage (The "Keyring")

We do **not** store sensitive tokens in plain text files, local storage, or `electron-store` text files.

### Implementation: `safeStorage`
We utilize Electron's `safeStorage` API, which leverages the native operating system's keychain:
*   **Windows**: DPAPI (Data Protection API).
*   **macOS**: Keychain Access.
*   **Linux**: Secret Service API / libsecret.

### Data Classification
*   **Public/Config** (Stored in `config.json` via `electron-store`):
    *   User Preferences (Theme, Last Page).
    *   Target Channel IDs.
    *   Feature Toggles.
*   **Confidential/Secrets** (Encrypted via `safeStorage`):
    *   Microsoft Entra ID Refresh Tokens.
    *   YouTube/Google Refresh Tokens.
    *   Twitch Access/Refresh Tokens.

**Note**: If `safeStorage` is unavailable (e.g., certain Linux headless environments), the application will fall back to in-memory storage only, requiring re-login on restart.

## 3. Process Isolation & Context Bridging

To prevent remote code execution (RCE) from compromised web content (e.g., YouTube Chat rendering):

*   **Context Isolation**: `contextIsolation: true` is enabled for all windows.
*   **Node Integration**: `nodeIntegration: false` is strictly enforced in all Renderers.
*   **Preload Scripts**:
    *   We use a dedicated `preload.ts` to expose only specific, typed functions to the Renderer via `contextBridge`.
    *   Renderer processes cannot directly require Node modules (`fs`, `child_process`).
*   **Sandboxing**: The "Hidden Window" used for YouTube scraping is logically separated from the main application state and only communicates via one-way IPC messages.

## 4. Network Security

*   **HTTPS**: All communication with Race Control APIs `api.simracecenter.com` is strictly HTTPS (TLS 1.2+).
*   **Local Server**: The local loopback server used for OAuth callbacks listens only on `127.0.0.1` and shuts down immediately after receiving the token.

## 5. Compliance

*   **Audit**: Source code is public for community audit.
*   **Data Minimization**: We do not store user PII locally beyond the minimum required tokens for operation.

## 6. Google API Services Usage Disclosure

*This section provides specific transparency regarding our use of Google APIs, in compliance with the Google API Services User Data Policy.*

### Purpose of Access
Sim RaceCenter Director requests access to the Google YouTube Data API v3 to enable the **"Broadcast Agent"** capability. This allows the application, acting on the local user's behalf, to:
1.  **Monitor Live Broadcasts:** Discover active live streams on the user's connected channel.
2.  **Interactive Chat:** Allow the automated Director system to post status updates, race information, and responses to viewer commands directly into the YouTube Live Chat during a broadcast.

### Scopes Requested
We request the minimum level of access required to function.
*   **Scope:** `https://www.googleapis.com/auth/youtube.force-ssl`
*   **Justification:** This scope is required to use the `liveChatMessages.insert` endpoint (Write Access) to post messages to the chat. There is no "chat-only" scope available in the YouTube API; this is the most restrictive scope that permits chat interaction.

### Data Handling & Privacy
*   **Storage**: OAuth2 Refresh Tokens and Access Tokens are stored locally on the user's device using high-security operating system encryption (Windows DPAPI, macOS Keychain, Linux Secret Service) via Electron's `safeStorage` API. They are **never** transmitted to Sim RaceCenter servers or third parties.
*   **Sharing**: No user data obtained from Google APIs is shared with external servers, advertising platforms, or data brokers.
*   **Usage**: Data (such as Chat Messages) is processed in real-time in the application memory to trigger local automation events and is then discarded.

### Client Credentials Security
This application utilizes the "Public Client" model (Desktop App).
*   **Client ID & Secret**: These credentials serve to identify the **application** to Google, not the user.
*   **Distribution**: As a desktop application, these identifiers are distributed within the binary. Security is maintained via strict Redirect URI matching (`http://localhost:3000/callback`) to ensure authorization codes are only delivered to the local instance of the application.

### Compliance Statement
Sim RaceCenter Director's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

