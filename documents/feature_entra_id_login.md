# Feature Specification: Entra ID Login

## Overview
Implement Microsoft Entra ID (formerly Azure AD) authentication to allow Directors to log in using their Sim RaceCenter Microsoft credentials. This ensures secure access and identifies the operator.

## User Stories
- As a Director, I want to log in with my Microsoft account so that I can access the application features.
- As a Director, I want to see my profile name after logging in to confirm my identity.
- As a System, I need to securely store the authentication token to maintain the session.

## Implementation Details

### 1. Authentication Provider
- **Provider**: Microsoft Entra ID.
- **Library**: `@azure/msal-node` running in the Electron **Main** process.

### 2. Architecture & IPC
- **Main Process**: Handles all authentication logic, token acquisition, and caching via `AuthService`.
- **Renderer Process**: Triggers login/logout actions and receives user account data via Electron IPC.
- **IPC Channels**:
  - `auth:login`: Triggers interactive login.
  - `auth:logout`: Clears the token cache.
  - `auth:get-account`: Checks for an existing valid session on startup.

### 3. Login Flow
1.  **Trigger**: User clicks "Login" in the Renderer.
2.  **IPC Call**: Renderer calls `window.electronAPI.login()`.
3.  **Interactive Auth**: Main process (`AuthService`) calls `acquireTokenInteractive`.
4.  **Browser**: System default browser opens to the Microsoft login page.
5.  **Redirect**: After successful login, the browser redirects to a localhost loopback address which `msal-node` listens to.
6.  **Token**: `msal-node` exchanges the authorization code for an Access Token and ID Token.
7.  **Response**: The user account information is returned to the Renderer.

### 4. Session Management & Caching
- **Storage**: Tokens are persisted to a local file named `msal-cache.json` in the application's `userData` directory.
- **Mechanism**: A custom `ICachePlugin` (`cachePlugin`) handles serialization and deserialization of the token cache to/from the file system.
- **Auto-Login**: On app launch, `AuthService` attempts to acquire a token silently using the cached account.

### 5. Configuration
- **Environment Variables**:
  - `VITE_AZURE_CLIENT_ID`: The Application (client) ID.
  - `VITE_AZURE_TENANT_ID`: The Directory (tenant) ID.
- **Loading**: Variables are loaded from a `.env` file (development) or `process.resourcesPath` (production).

### 6. UI/UX
- **Login**: Login button initiates the flow.
- **Authenticated State**: Displays user avatar/initials in the sidebar.
- **Logout**: "Log Out" option in the user menu clears the session and resets the UI.

## Technical Considerations
- **Security**: The current implementation uses a plain JSON file for token cache. Future improvements should consider using `keytar` or Electron's `safeStorage` for encryption at rest.
- **Scopes**: The application currently requests the `User.Read` scope.
