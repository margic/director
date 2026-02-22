# Application Insights Instrumentation - Technical Proposal

**Date:** December 28, 2025  
**Status:** Implemented  
**Author:** GitHub Copilot  
**Reviewer:** @Margic  

---

## Executive Summary

This proposal outlines the implementation of Azure Application Insights telemetry in the Sim RaceCenter Director Electron application. The solution provides comprehensive remote observability for client-side activity while maintaining correlation with the existing Azure backend Application Insights infrastructure.

## Problem Statement

Currently, the Director Electron app lacks remote observability capabilities. When issues occur in production:
- No visibility into client-side errors or exceptions
- Cannot correlate client actions with backend API calls
- No metrics on application usage or performance
- Difficult to diagnose user-reported issues
- No insight into Director loop behavior in production

## Proposed Solution

### Technology Stack

**SDK:** `applicationinsights` v3.12.1 (Official Azure SDK for Node.js)

**Rationale:**
- ✅ Official Microsoft SDK with ongoing support
- ✅ Native Node.js compatibility (works in Electron main process)
- ✅ Built-in distributed tracing with W3C TraceContext propagation
- ✅ Automatic collection of dependencies, exceptions, performance
- ✅ Rich API for custom events and metrics
- ✅ Proven track record with Electron applications

### Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│              Azure Application Insights              │
│         (Centralized Telemetry Backend)              │
└──────────────────┬──────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
┌───────▼────────┐   ┌────────▼────────┐
│  Race Control  │   │    Director     │
│    Backend     │   │  Electron App   │
│   (Existing)   │   │     (New)       │
└────────────────┘   └─────────────────┘
                            │
                     ┌──────┴──────┐
                     │             │
              ┌──────▼──────┐ ┌───▼──────┐
              │    Main     │ │ Renderer │
              │   Process   │ │ Process  │
              │   (Node)    │ │  (React) │
              └─────────────┘ └──────────┘
```

### Implementation Strategy

#### 1. Main Process Instrumentation (Electron Main)

**Location:** Node.js main process (src/main/)

**Captured Telemetry:**
- Application lifecycle (start, quit)
- Authentication flows (login, logout)
- Director service operations (start, stop, status)
- API calls as dependencies (with timing, status, correlation)
- Command sequence execution
- Exceptions with full context

**Implementation:**
- Initialize SDK on app ready event
- Wrap IPC handlers with telemetry tracking
- Instrument DirectorService methods
- Auto-collection enabled for: requests, performance, exceptions, dependencies

#### 2. Renderer Process Instrumentation (React UI)

**Location:** React renderer process (src/renderer/)

**Captured Telemetry:**
- User interactions (button clicks, navigation)
- Page views
- UI-level exceptions
- User sessions

**Implementation:**
- Lightweight telemetry wrapper
- IPC bridge to main process (renderer cannot directly access Application Insights)
- Event tracking in React components
- Error boundary integration

#### 3. Client-Backend Correlation

**Mechanism:** W3C TraceContext + Application Insights AI headers

**Configuration:**
```typescript
.setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C)
```

**Benefits:**
- Automatic trace context propagation in HTTP headers
- End-to-end transaction tracking from client → backend
- Unified view of distributed operations in Azure Portal
- Performance bottleneck identification across the stack

### Configuration

**Environment Variables:**

```bash
# Application Insights (from Azure resource)
VITE_APPINSIGHTS_INSTRUMENTATION_KEY=your_instrumentation_key_here
VITE_APPINSIGHTS_INGESTION_ENDPOINT=https://westus3-1.in.applicationinsights.azure.com/
VITE_APPINSIGHTS_LIVE_ENDPOINT=https://westus3.livediagnostics.monitor.azure.com/
VITE_APPINSIGHTS_APPLICATION_ID=your_application_id_here

# Feature flag (allows disabling in development or for privacy)
VITE_APPINSIGHTS_ENABLED=true
```

**Note:** Obtain these values from Azure Portal → Application Insights → Properties.

**SDK Auto-Collection:**
- ✅ HTTP requests (as dependencies)
- ✅ Performance counters
- ✅ Uncaught exceptions
- ✅ Console output (optional)
- ✅ Native metrics (memory, CPU)

### Event Taxonomy

#### Application Events
- `Application.Started` - App initialized
- `Application.Quit` - App shutting down

#### Authentication Events  
- `Auth.LoginAttempt` - User initiates login
- `Auth.LoginSuccess` - Authentication successful
- `Auth.Logout` - User logged out

#### Director Events
- `Director.StartRequested` - User requests start
- `Director.Started` - Loop running
- `Director.StopRequested` - User requests stop
- `Director.Stopped` - Loop stopped
- `Sequence.Received` - Command sequence received
- `Sequence.Executed` - Sequence completed

#### User Events
- `UserSession.Authenticated` - Session established
- `PageView` - Navigation tracked
- `UI.*` - User interactions

#### Dependencies
- `RaceControl API` - All backend HTTP calls
  - Includes: URL, duration, HTTP status, success/failure
  - Custom properties: centerId, sessionId, etc.

### Data Privacy & Security

**What's Collected:**
- Anonymous user identifiers (MSAL account IDs)
- Event names and timestamps
- Session and race IDs
- API endpoint patterns (no request/response bodies)
- Error messages and stack traces
- Performance metrics

**What's NOT Collected:**
- Passwords or authentication tokens
- Personal identifiable information (PII)
- API request/response payloads
- Sensitive business data

**Compliance:**
- Data retained for 90 days (configurable)
- GDPR-compliant (no PII)
- Can be disabled via environment variable

## Expected Benefits

### 1. Production Diagnostics
- **Before:** Issues reported by users, no visibility into what happened
- **After:** Full stack traces, context, and correlation with backend operations

### 2. Performance Monitoring
- **Before:** No metrics on API call latency or app performance
- **After:** Real-time dashboards showing API performance, slow operations, resource usage

### 3. User Behavior Analytics
- **Before:** Unknown feature usage patterns
- **After:** Data-driven insights into how users interact with the application

### 4. Proactive Issue Detection
- **Before:** Reactive - wait for user reports
- **After:** Proactive - alerts on error rate spikes, performance degradation

### 5. End-to-End Visibility
- **Before:** Siloed client and server telemetry
- **After:** Unified view with request correlation across distributed system

## Technical Implementation

### Code Structure

```
src/main/
├── telemetry-config.ts       # Configuration loading
├── telemetry-service.ts      # Main telemetry service (singleton)
├── main.ts                   # App lifecycle + IPC telemetry
└── director-service.ts       # API dependency tracking

src/renderer/
├── telemetry.ts              # Renderer telemetry wrapper
└── App.tsx                   # UI event tracking
```

### Key Design Decisions

**1. Singleton Pattern**
- Single TelemetryService instance shared across the app
- Prevents duplicate initialization
- Centralized configuration

**2. IPC Bridge for Renderer**
- Renderer cannot directly use Node.js SDK
- Main process handles all telemetry ingestion
- Keeps renderer lightweight

**3. Auto-Collection + Custom Events**
- Leverage SDK's auto-collection for basic telemetry
- Add custom events for business-specific tracking
- Balanced approach: comprehensive without being intrusive

**4. Graceful Degradation**
- Telemetry failures don't crash the app
- All tracking wrapped in try-catch
- Can be disabled entirely via environment variable

**5. Minimal Performance Impact**
- Asynchronous telemetry sending (non-blocking)
- Batching and buffering handled by SDK
- Disk retry caching for offline scenarios

### Testing Strategy

**Development Testing:**
1. Run app in dev mode with telemetry enabled
2. Perform user actions (login, start/stop director)
3. Verify events in Azure Portal (Live Metrics)

**Production Validation:**
1. Deploy to production
2. Monitor first few sessions
3. Validate correlation with backend telemetry
4. Review query results in Azure Portal

**Regression Prevention:**
- Build process validates TypeScript compilation
- No functional changes to existing code paths
- Telemetry is additive, not intrusive

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Telemetry overhead | Performance degradation | Async sending, batching, SDK optimizations |
| Data privacy concerns | Legal/compliance issues | No PII collected, can be disabled, GDPR-compliant |
| SDK version changes | Breaking changes | Pin SDK version, test upgrades in dev first |
| Network errors | Lost telemetry | Disk retry caching enabled by SDK |
| Azure cost increase | Budget overrun | Monitor ingestion volume, sampling if needed |

## Monitoring & Maintenance

### Operational Metrics

**Dashboard KPIs:**
- Active users per day
- Director loop uptime
- API call success rate
- Average API latency
- Exception rate
- Top errors

**Alerts:**
- Exception rate > threshold
- API failure rate > 10%
- Average latency > 5 seconds
- Zero telemetry received (health check)

### Ongoing Responsibilities

- Review telemetry weekly for issues
- Update SDK quarterly for security patches
- Adjust sampling if volume becomes excessive
- Add new events as features are developed

## Cost Analysis

**Azure Application Insights Pricing:**
- First 5 GB/month: Free
- Additional data: ~$2.30/GB

**Expected Volume:**
- ~10-50 events per user session
- ~100-500 KB per session
- Estimated: < 1 GB/month for initial rollout
- **Cost: $0-5/month** (well within free tier)

## Alternatives Considered

### 1. ElectronLog + Custom Backend
- ❌ Requires building custom infrastructure
- ❌ No built-in correlation
- ❌ More maintenance burden

### 2. Sentry
- ✅ Good error tracking
- ❌ Less suited for distributed tracing
- ❌ Additional vendor
- ❌ Less integration with Azure backend

### 3. OpenTelemetry
- ✅ Vendor-neutral standard
- ❌ More complex setup
- ❌ Less Azure-native features
- ❌ Overkill for current needs

**Decision: Application Insights**
- Best integration with existing Azure infrastructure
- Minimal setup complexity
- Rich feature set out-of-the-box
- Proven Electron compatibility

## Implementation Timeline

✅ **Phase 1: Core Implementation** (Completed)
- Install SDK
- Configure telemetry service
- Instrument main process
- Add IPC bridge for renderer

✅ **Phase 2: Event Tracking** (Completed)
- Application lifecycle
- Authentication events
- Director service events
- API dependencies

✅ **Phase 3: Documentation** (Completed)
- Implementation guide
- Quick start guide
- Technical proposal

**Phase 4: Validation** (Next)
- Deploy to development environment
- Test correlation with backend
- Verify dashboards in Azure Portal
- @Margic review and approval

**Phase 5: Production Rollout** (Pending Approval)
- Deploy to production
- Monitor first week closely
- Iterate based on feedback

## Recommendation

**Proceed with implementation as designed.**

The Application Insights integration provides:
- Comprehensive observability with minimal code changes
- Native Azure integration and correlation
- Privacy-conscious data collection
- Low operational overhead
- Proven technology stack

**Next Steps:**
1. @Margic reviews this proposal
2. Test in development environment
3. Validate telemetry in Azure Portal
4. Deploy to production with monitoring

## References

- [Application Insights Node.js SDK](https://github.com/microsoft/ApplicationInsights-node.js)
- [Distributed Tracing in Application Insights](https://docs.microsoft.com/en-us/azure/azure-monitor/app/distributed-tracing)
- [Application Insights for Electron Apps](https://docs.microsoft.com/en-us/azure/azure-monitor/app/nodejs)

---

**Document Version:** 1.0  
**Review Status:** Pending @Margic approval  
**Implementation Status:** Complete, pending validation
