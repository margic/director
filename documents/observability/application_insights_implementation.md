# Application Insights Instrumentation - Implementation Guide

## Overview

This document describes the implementation of Azure Application Insights telemetry in the Sim RaceCenter Director Electron application. The implementation enables comprehensive remote observability, allowing the team to:

- Track application lifecycle and user behavior
- Monitor API calls to the Azure backend
- Correlate client-side activity with server-side traces
- Identify and diagnose errors in production
- Measure performance metrics across the distributed system

## Architecture

### Main Process Instrumentation (Node.js/Electron)

The main process is instrumented using the official `applicationinsights` SDK for Node.js. This captures:

- **Application lifecycle events**: Start, quit
- **Authentication events**: Login attempts, success, failures, logout
- **Director service events**: Start/stop operations, status changes
- **API dependencies**: All HTTP calls to the Azure backend with timing and success metrics
- **Sequence execution**: Tracking of received and executed command sequences
- **Exceptions**: Automatic and manual exception tracking

### Renderer Process Instrumentation (React)

The renderer process (React UI) communicates with the main process via IPC to send telemetry:

- **User interactions**: Button clicks, navigation
- **Page views**: Dashboard views
- **UI exceptions**: React component errors
- **User sessions**: Authenticated user tracking

### Client-Backend Correlation

The Application Insights SDK is configured with distributed tracing mode `AI_AND_W3C`, which enables:

- Automatic propagation of trace context headers (W3C TraceParent)
- Correlation between client requests and backend operations
- End-to-end transaction tracking across the distributed system

## Implementation Details

### Configuration

Application Insights is configured via environment variables (see `.env.example`):

```bash
# Application Insights Configuration
VITE_APPINSIGHTS_INSTRUMENTATION_KEY=a3338f9b-48c6-4d3f-b07c-a6e4e4516ea9
VITE_APPINSIGHTS_INGESTION_ENDPOINT=https://westus3-1.in.applicationinsights.azure.com/
VITE_APPINSIGHTS_LIVE_ENDPOINT=https://westus3.livediagnostics.monitor.azure.com/
VITE_APPINSIGHTS_APPLICATION_ID=7fa3a6e8-91ae-4549-b0de-995d0e8b0c7d
VITE_APPINSIGHTS_ENABLED=true
```

**Configuration Details:**
- **InstrumentationKey**: Unique identifier for the Application Insights resource
- **IngestionEndpoint**: Regional endpoint for telemetry ingestion (West US 3)
- **LiveEndpoint**: Endpoint for live metrics streaming
- **ApplicationId**: Application identifier for correlation
- **Enabled**: Feature flag to enable/disable telemetry (default: true)

### Key Components

#### 1. `telemetry-config.ts`
Centralized configuration loading from environment variables with sensible defaults.

#### 2. `telemetry-service.ts`
Main telemetry service providing:
- SDK initialization and configuration
- Helper methods for tracking events, metrics, dependencies, exceptions, traces
- Singleton pattern for global access
- Auto-collection of requests, performance, exceptions, dependencies
- Distributed tracing with W3C context propagation

#### 3. Renderer-side Telemetry (`telemetry.ts`)
Lightweight wrapper that sends telemetry from React to the main process via IPC.

### Instrumentation Points

#### Main Process (src/main/main.ts)

1. **Application Lifecycle**
   - `Application.Started` - App ready event with platform and version

2. **Authentication**
   - `Auth.LoginAttempt` - User initiates login
   - `Auth.LoginSuccess` - Login completed with user ID
   - `Auth.Logout` - User logs out

3. **Director Service**
   - `Director.StartRequested` - User requests to start director loop
   - `Director.Started` - Director loop started with session ID
   - `Director.StopRequested` - User requests to stop director loop
   - `Director.Stopped` - Director loop stopped

4. **Application Shutdown**
   - `Application.Quit` - App shutting down
   - Automatic flush of pending telemetry

#### Director Service (src/main/director-service.ts)

1. **API Dependencies**
   - `RaceControl API - GET /api/director/v1/sessions` - List sessions
   - `RaceControl API - GET nextSequence` - Fetch next command sequence
   - Each includes: duration, success status, HTTP status code, custom properties

2. **Metrics**
   - `Sessions.Count` - Number of available sessions per center

3. **Events**
   - `Sequence.Received` - Command sequence received with ID, priority, command count
   - `Sequence.Executed` - Command sequence completed

4. **Exceptions**
   - Automatic tracking of API errors
   - Exception context with operation name and session ID

#### Renderer Process (src/renderer/App.tsx)

1. **User Sessions**
   - `UserSession.Authenticated` - User authenticated on app load

2. **Page Views**
   - `PageView` - Dashboard view tracking

3. **User Interactions**
   - `UI.LoginButtonClicked` - Login button clicked
   - `UI.DirectorToggleClicked` - Director start/stop toggle
   - `UI.LogoutClicked` - Logout button clicked

4. **Exceptions**
   - Automatic tracking of UI errors with context

## Telemetry Data Types

### Events
Custom events capturing discrete actions or state changes:
```typescript
telemetryService.trackEvent('EventName', {
  property1: 'value1',
  property2: 'value2',
}, {
  metric1: 123,
  metric2: 456,
});
```

### Dependencies
External API calls with timing and success metrics:
```typescript
telemetryService.trackDependency(
  'RaceControl API',           // Name
  'GET /api/sessions',         // Command
  duration,                    // Duration in ms
  success,                     // Boolean
  response.status,             // HTTP status code
  'HTTP',                      // Dependency type
  { centerId: 'center-123' }   // Custom properties
);
```

### Metrics
Numeric measurements:
```typescript
telemetryService.trackMetric('Sessions.Count', sessionCount, {
  centerId: 'center-123',
});
```

### Exceptions
Error tracking with context:
```typescript
telemetryService.trackException(error, {
  operation: 'fetchSessions',
  sessionId: 'session-123',
});
```

### Traces
Log messages with severity levels:
```typescript
telemetryService.trackTrace('Message', KnownSeverityLevel.Information, {
  context: 'startup',
});
```

## Benefits

### 1. Remote Observability
- Monitor application health in production without direct access
- Identify issues before users report them
- Track feature usage and adoption

### 2. Performance Monitoring
- Measure API call latencies
- Identify slow operations
- Track resource usage patterns

### 3. Error Diagnosis
- Detailed exception information with stack traces
- Context-rich error reporting
- Correlation of errors across distributed components

### 4. User Behavior Analytics
- Track user flows through the application
- Measure feature engagement
- Identify usability issues

### 5. Backend Correlation
- End-to-end request tracing from client to backend
- Identify which client actions trigger backend errors
- Performance bottleneck identification across the stack

## Querying Telemetry in Azure Portal

### Example Queries

**Top Exceptions:**
```kusto
exceptions
| where cloud_RoleName == "SimRaceCenter-Director"
| summarize count() by type, outerMessage
| order by count_ desc
```

**API Performance:**
```kusto
dependencies
| where cloud_RoleName == "SimRaceCenter-Director"
| where name contains "RaceControl API"
| summarize avg(duration), percentile(duration, 95) by name
| order by avg_duration desc
```

**User Sessions:**
```kusto
customEvents
| where cloud_RoleName == "SimRaceCenter-Director"
| where name == "UserSession.Authenticated"
| summarize count() by tostring(customDimensions.userId)
```

**Director Loop Activity:**
```kusto
customEvents
| where cloud_RoleName == "SimRaceCenter-Director"
| where name in ("Director.Started", "Director.Stopped", "Sequence.Received")
| order by timestamp desc
```

**Failed API Calls:**
```kusto
dependencies
| where cloud_RoleName == "SimRaceCenter-Director"
| where success == false
| order by timestamp desc
```

## Privacy and Security

### Data Collection
- **User IDs**: Anonymous account IDs (no PII)
- **Session data**: Session IDs and status
- **API endpoints**: URL patterns (no sensitive parameters)
- **Exceptions**: Stack traces (may contain code paths)

### Disabling Telemetry
To disable telemetry, set the environment variable:
```bash
VITE_APPINSIGHTS_ENABLED=false
```

### Data Retention
- Telemetry data is retained per Azure Application Insights configuration (typically 90 days)
- No user passwords or authentication tokens are logged
- IP addresses are collected but can be anonymized in Azure settings

## Testing

### Development Environment
In development mode:
1. Telemetry is enabled by default
2. Console logging shows telemetry operations
3. Data is sent to the same Application Insights resource

### Verifying Telemetry

1. **Build the application:**
   ```bash
   npm run build
   ```

2. **Start the application:**
   ```bash
   npm run dev
   ```

3. **Perform actions:**
   - Log in
   - Start/stop director
   - Trigger errors

4. **Check Azure Portal:**
   - Navigate to Application Insights resource
   - Go to "Live Metrics" for real-time data
   - Use "Logs" or "Transaction search" to query telemetry

### Sample Test Scenarios

1. **Application Start:**
   - Should see `Application.Started` event

2. **User Login:**
   - Should see `Auth.LoginAttempt`
   - Should see `Auth.LoginSuccess` (if successful)

3. **Director Operations:**
   - Should see `Director.StartRequested`, `Director.Started`
   - Should see API dependency calls
   - Should see `Sequence.Received`, `Sequence.Executed` events

4. **Error Handling:**
   - Network errors should appear as failed dependencies
   - UI errors should appear as exceptions with context

## Future Enhancements

### Potential Improvements

1. **Custom Metrics Dashboard**
   - Create Azure dashboards for key metrics
   - Set up alerts for critical errors
   - Configure availability tests

2. **Enhanced Correlation**
   - Add user properties (center ID, roles) to all telemetry
   - Implement custom operation IDs for complex workflows
   - Track end-to-end latency for specific operations

3. **Performance Profiling**
   - Add custom performance measurements
   - Track UI render times
   - Monitor memory usage

4. **User Feedback Integration**
   - Link user feedback to telemetry sessions
   - Track satisfaction metrics

5. **A/B Testing Support**
   - Track feature flags
   - Measure experiment outcomes

## Troubleshooting

### Common Issues

**Issue: No telemetry appearing in Azure Portal**
- Check that `VITE_APPINSIGHTS_ENABLED` is not set to `false`
- Verify instrumentation key is correct
- Check network connectivity (firewall may block telemetry endpoints)
- Wait 2-3 minutes for data to appear (ingestion delay)

**Issue: Build errors related to Application Insights**
- Ensure `applicationinsights` package is installed: `npm install`
- Check TypeScript version compatibility
- Verify import paths in telemetry files

**Issue: Telemetry flooding**
- Review polling intervals in `director-service.ts`
- Consider sampling (configure in `telemetry-service.ts`)
- Adjust auto-collection settings

## References

- [Application Insights Node.js SDK](https://github.com/microsoft/ApplicationInsights-node.js)
- [Application Insights Documentation](https://docs.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview)
- [Distributed Tracing](https://docs.microsoft.com/en-us/azure/azure-monitor/app/distributed-tracing)
- [Kusto Query Language](https://docs.microsoft.com/en-us/azure/data-explorer/kusto/query/)

## Support

For issues or questions about telemetry:
1. Check this documentation
2. Review Application Insights logs in Azure Portal
3. Open an issue in the GitHub repository
4. Contact @Margic for Azure resource access

---

**Last Updated:** 2025-12-28  
**Version:** 1.0  
**Author:** GitHub Copilot
