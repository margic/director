# Feature Specification: Entra ID Login

## Overview
Implement Microsoft Entra ID (formerly Azure AD) authentication to allow Directors to log in using their Sim RaceCenter Microsoft credentials. This ensures secure access and identifies the operator.

## User Stories
- As a Director, I want to log in with my Microsoft account so that I can access the application features.
- As a Director, I want to see my profile name after logging in to confirm my identity.
- As a System, I need to securely store the authentication token to maintain the session.

## Requirements
1.  **Authentication Provider**: Microsoft Entra ID.
2.  **Library**: Use `@azure/msal-node` (Main process) or `@azure/msal-browser` (Renderer) as appropriate for the Electron security model.
3.  **Login Flow**:
    - User clicks "Login with Microsoft" on the welcome screen.
    - Trigger system browser or secure popup for authentication.
    - Handle the redirect/callback to capture the auth code.
    - Exchange code for Access Token and ID Token.
4.  **Session Management**:
    - Store tokens securely (e.g., using `keytar` or Electron's `safeStorage`).
    - Handle token refresh automatically.
5.  **UI/UX**:
    - Login button state (Loading, Success, Error).
    - Display user avatar and name in the application header.
    - Logout functionality.

## Technical Considerations
- **Azure App Registration**: Need Client ID, Tenant ID, and Redirect URI (e.g., `msal{client-id}://auth`).
- **Protocol Handler**: Register a custom protocol handler in Electron to receive the callback from the browser.
