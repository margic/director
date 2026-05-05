# Entra ID (Microsoft Identity) Login

> STATUS: IMPLEMENTED. Source of truth: `src/main/auth-service.ts`,
> `src/main/auth-config.ts`, `src/main/cache-plugin.ts`,
> `src/main/preload.ts`.

Director uses **MSAL Node** (`@azure/msal-node`) to authenticate the
operator against Microsoft Entra ID and to obtain a Race Control API
access token. All secrets are managed in the main process; the
renderer never sees raw tokens.

## Configuration

In `auth-config.ts`:

```ts
msalConfig = {
  auth: {
    clientId: process.env.VITE_AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.VITE_AZURE_TENANT_ID || 'common'}`,
  },
  cache: { cachePlugin },          // file-based plain JSON
  system: { loggerOptions: { logLevel: 1 /* Warning */ } },
};

rcApiScope = process.env.VITE_RC_API_SCOPE
          || 'api://racecontrol-api-{tenant-guid}/access_as_user';
```

Both env vars must be set for login to work. In a packaged build,
they are read from `{resourcesPath}/.env`; in dev, from the repo
root `.env` via `dotenv`.

## IPC channels and preload surface

| Preload method | IPC channel | Description |
|---|---|---|
| `login()` | `auth:login` | Interactive flow. Returns `AuthLoginResult` or `null`. |
| `getAccount()` | `auth:get-account` | Returns the cached `AccountInfo` or `null`. |
| `getUserProfile()` | `auth:get-user-profile` | GETs `/api/auth/user` with a silent token. |
| `logout()` | `auth:logout` | Clears the MSAL cache. |

These are at the top level of `window.electronAPI` (not under a
namespace) for historical reasons.

## Token acquisition

`AuthService.getAccessToken()`:

1. Look up the cached account.
2. Try `acquireTokenSilent({ scopes: [rcApiScope], account })`.
3. On `InteractionRequiredAuthError`, fall back to
   `acquireTokenInteractive({ scopes: [rcApiScope] })`. This opens a
   system browser tab via the configured redirect URI.
4. Return the bearer token (string) or `null` on failure.

The token is **never** cached by `AuthService` itself — every call
re-runs silent acquisition. MSAL handles the token cache; cached
access tokens are reused until expiry, at which point the refresh
token is used (silently).

`getAccessToken()` is called by:

- Every Race Control HTTP call (`SessionManager`, `CloudPoller`,
  `DiscordService.playTts`, the publisher transport, the YouTube
  extension's auth URL builder, the publisher config endpoint).
- The extension API: `api.getAuthToken()` round-trips via `INVOKE`.

## Startup auth flow

`auth:get-account` is called by the renderer at app launch and drives
the boot UX:

```
App boots → renderer calls electronAPI.getAccount()
   ├─ returns AccountInfo → render dashboard, kick off
   │                        electronAPI.getUserProfile()
   │                        and electronAPI.session.discover()
   └─ returns null        → render "Sign in with Microsoft" splash
                            screen; on click, call electronAPI.login()
```

There is no automatic interactive token acquisition at startup — the
renderer opts in by calling `getUserProfile()`, which internally calls
`getAccessToken()` (which may trigger an interactive flow if the
refresh token has expired, but normally completes silently).

## Token cache — current state

> The previous `feature_entra_id_login.md` referenced a `safeStorage`
> migration. **That migration applies only to app-level secrets**
> (Discord bot token, YouTube refresh token, OBS password) which are
> stored via `configService.saveSecure(...)`. The **MSAL token cache
> itself is still plain-text JSON** at
> `{userData}/msal-cache.json`. See `cache-plugin.ts:8..42`.

| Secret class | Storage | File |
|---|---|---|
| MSAL access/refresh/id tokens | **plain JSON** | `{userData}/msal-cache.json` |
| Discord bot token | safeStorage (`enc:` prefix) or `plain:` fallback | electron-store at `secure.discord.token` |
| YouTube client secret | safeStorage / fallback | electron-store at `secure.youtube.clientSecret` |
| YouTube refresh token | safeStorage / fallback | electron-store at `secure.youtube.refreshToken` |
| OBS password | safeStorage / fallback | electron-store at `secure.obs.password` (legacy: also in plain `obs.password`) |

This is a known gap. Migrating the MSAL cache to `safeStorage`
requires writing a custom serialiser inside `cache-plugin.ts` that
encrypts on `afterCacheAccess` and decrypts on `beforeCacheAccess`, and
gracefully migrating any existing plain-JSON cache on first launch.
See `security_design.md` for the broader plan.

## What `safeStorage` does

`safeStorage` wraps the OS keychain on macOS, DPAPI on Windows, and
libsecret on Linux. On Linux without libsecret, `isEncryptionAvailable()`
returns `false` and `configService.saveSecure` falls back to a `plain:`
prefix in electron-store — this is intentional for dev environments,
but production Linux builds should ensure libsecret is installed.

The encrypted blob is base64-encoded with a leading `enc:` marker
(`saveSecure`); the prefix tells `getSecure` whether to base64-decode
and decrypt or just strip a `plain:` prefix.

## Telemetry

`AuthService.login` tracks two Application Insights events:

- `Auth.LoginAttempt { hadAccount }` — fired before silent acquisition.
- `Auth.LoginSuccess { username, tenantId }` — fired after a
  successful interactive login.

No telemetry is emitted for silent token acquisitions (would be too
chatty). The `username` is the operator's UPN (e.g. `alice@example.com`);
this is captured as a custom dimension and is subject to the
organisation's Application Insights retention policy.

## Logout

`auth:logout`:

1. Call `pca.getTokenCache().removeAccount(account)` for the cached account.
2. Clear `safeStorage`-backed Race Control cookies if any (none today).
3. The plain `msal-cache.json` is left on disk; the next
   `acquireTokenSilent` will not find any usable refresh token and
   will error out, requiring an interactive login.

The renderer then transitions back to the splash screen.

## Common errors

| Symptom | Cause |
|---|---|
| `AADSTS65001: User has not consented` | First-time login without admin consent for the app registration. Operator must accept the consent prompt. |
| `InteractionRequiredAuthError` on every call | Refresh token expired (default 90 days of inactivity). User must log in again. |
| `getAccessToken()` returns `null` | Either no account cached, or interactive flow was cancelled. Renderer should treat as "logged out". |

## Test harness

There is no E2E test for the auth flow (it depends on Microsoft Entra
ID). Unit tests in `src/main/__tests__/auth-service.test.ts` mock
`@azure/msal-node` to verify the silent → interactive fallback and
the telemetry calls.
