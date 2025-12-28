# Application Insights Quick Start Guide

## What is Application Insights?

Application Insights is Azure's application performance monitoring (APM) solution that has been integrated into the Sim RaceCenter Director app. It automatically collects telemetry about:

- When users log in and what they do
- How the Director loop is performing
- API calls to the Race Control backend
- Errors and exceptions
- Performance metrics

## Key Features

✅ **Automatic tracking** of application lifecycle, API calls, and errors  
✅ **Client-to-backend correlation** for end-to-end tracing  
✅ **Real-time monitoring** via Azure Portal  
✅ **No code changes needed** for basic telemetry  
✅ **Privacy-conscious** - no PII or sensitive data collected  

## Configuration

Application Insights is pre-configured with the following settings (in `.env`):

```bash
VITE_APPINSIGHTS_INSTRUMENTATION_KEY=a3338f9b-48c6-4d3f-b07c-a6e4e4516ea9
VITE_APPINSIGHTS_INGESTION_ENDPOINT=https://westus3-1.in.applicationinsights.azure.com/
VITE_APPINSIGHTS_LIVE_ENDPOINT=https://westus3.livediagnostics.monitor.azure.com/
VITE_APPINSIGHTS_APPLICATION_ID=7fa3a6e8-91ae-4549-b0de-995d0e8b0c7d
VITE_APPINSIGHTS_ENABLED=true
```

## Disabling Telemetry

To disable telemetry, set in your `.env` file:

```bash
VITE_APPINSIGHTS_ENABLED=false
```

## What Gets Tracked?

### Main Process (Automatic)
- **App lifecycle**: Start, quit
- **Authentication**: Login attempts, success, logout
- **Director service**: Start, stop, status
- **API calls**: All requests to Race Control backend with timing
- **Errors**: Exceptions with stack traces

### Renderer Process (UI)
- **User actions**: Login clicks, director toggle, logout
- **Page views**: Dashboard navigation
- **UI errors**: Component exceptions

## Viewing Telemetry Data

### Azure Portal Access
Ask @Margic for access to the Azure Application Insights resource.

### Quick Views

**Live Metrics** (Real-time):
1. Navigate to Application Insights in Azure Portal
2. Click "Live Metrics" in left menu
3. See real-time events as they happen

**Recent Events**:
1. Click "Logs" in left menu
2. Run query:
   ```kusto
   union *
   | where timestamp > ago(1h)
   | where cloud_RoleName == "SimRaceCenter-Director"
   | order by timestamp desc
   | take 50
   ```

**API Performance**:
```kusto
dependencies
| where cloud_RoleName == "SimRaceCenter-Director"
| where name contains "RaceControl API"
| summarize avg(duration), percentile(duration, 95) by name
```

**Errors**:
```kusto
exceptions
| where cloud_RoleName == "SimRaceCenter-Director"
| order by timestamp desc
| take 20
```

## Telemetry Events Reference

### Application Events
| Event | When | Properties |
|-------|------|------------|
| `Application.Started` | App launches | platform, version |
| `Application.Quit` | App closes | - |

### Authentication Events
| Event | When | Properties |
|-------|------|------------|
| `Auth.LoginAttempt` | User clicks login | - |
| `Auth.LoginSuccess` | Login completes | userId, username |
| `Auth.Logout` | User logs out | - |

### Director Events
| Event | When | Properties |
|-------|------|------------|
| `Director.StartRequested` | User starts loop | - |
| `Director.Started` | Loop running | sessionId, status |
| `Director.StopRequested` | User stops loop | - |
| `Director.Stopped` | Loop stopped | status |
| `Sequence.Received` | Command sequence received | sequenceId, sessionId, commandCount, priority |
| `Sequence.Executed` | Sequence completed | sequenceId, sessionId |

### UI Events
| Event | When | Properties |
|-------|------|------------|
| `UserSession.Authenticated` | User session established | userId, username |
| `PageView` | User navigates | pageName |
| `UI.LoginButtonClicked` | Login button clicked | - |
| `UI.DirectorToggleClicked` | Director toggle clicked | currentState |
| `UI.LogoutClicked` | Logout clicked | - |

## Common Queries

### Today's Active Users
```kusto
customEvents
| where timestamp > ago(24h)
| where name == "UserSession.Authenticated"
| summarize by tostring(customDimensions.userId)
| count
```

### Director Loop Uptime
```kusto
customEvents
| where timestamp > ago(24h)
| where name in ("Director.Started", "Director.Stopped")
| order by timestamp asc
```

### Slowest API Calls
```kusto
dependencies
| where timestamp > ago(24h)
| where name contains "RaceControl API"
| summarize max(duration), avg(duration) by name
| order by max_duration desc
```

## Privacy & Data

### What's Collected
- ✅ Event names and timestamps
- ✅ Anonymous user IDs (MSAL account IDs)
- ✅ Session IDs
- ✅ API endpoint patterns
- ✅ Error messages and stack traces
- ✅ Performance metrics

### What's NOT Collected
- ❌ Passwords or tokens
- ❌ Personal identifiable information (PII)
- ❌ API request/response bodies
- ❌ Sensitive business data

### Data Retention
- Telemetry is retained for 90 days in Azure
- Data can be exported for longer retention if needed

## Support

- **Documentation**: See `documents/application_insights_implementation.md`
- **Issues**: Open a GitHub issue
- **Azure Access**: Contact @Margic

---

**Instrumentation Version:** 1.0  
**SDK:** `applicationinsights` (Node.js)
