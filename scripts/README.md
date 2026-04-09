# Director E2E Test Scripts

This directory contains end-to-end integration test scripts for the Director application.

## test-director-loop.ts

Comprehensive E2E test for the full Director ↔ Race Control round-trip flow.

### What It Tests

1. **Check-In** - POSTs to RC API with realistic capabilities payload
2. **Planner Wait** - Waits for planner to generate templates
3. **Poll Sequences** - GETs `/sequences/next` with proper query params and headers
4. **Validate Format** - Verifies PortableSequence vs legacy format
5. **Validate Field Names** - Checks `carNum`, `camGroup`, `sceneName` (not old names)
6. **Validate Metadata** - Ensures `totalDurationMs >= 10000` for AI sequences
7. **Validate Request** - Confirms `intents` query param and `X-Checkin-Id` header
8. **Test Session End** - Wraps check-in and documents 410 Gone behavior

### Prerequisites

1. **Active Race Control Session**
   - You need an ACTIVE session in your Race Control center
   - Get the session ID from the Race Control UI or API

2. **Bearer Token**
   - Obtain via MSAL authentication in Director
   - Or use Azure CLI: `az account get-access-token --resource <resource-id>`

3. **Environment Variables**
   ```bash
   # Required
   export TEST_BEARER_TOKEN="eyJ0eXAiOiJKV1QiLCJhbGc..."
   export TEST_SESSION_ID="ses_abc123"

   # Optional
   export VITE_API_BASE_URL="https://simracecenter.com"  # default
   export TEST_PLANNER_WAIT_MS="10000"                    # default: 10s
   export TEST_MAX_POLL_ATTEMPTS="10"                     # default: 10
   ```

### Running the Test

```bash
# Using npm script (recommended)
npm run test:director-loop

# Or directly with ts-node (if installed)
npx ts-node --transpile-only -P tsconfig.test.json -r tsconfig-paths/register scripts/test-director-loop.ts
```

### Expected Output

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║  Director E2E Integration Test: Check-in → Poll → Execute                   ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝

Configuration:
  API Base URL: https://simracecenter.com
  Session ID: ses_abc123
  Director ID: d_inst_12345678-1234-1234-1234-123456789abc
  Bearer Token: (set)
  Planner Wait: 10000ms
  Max Poll Attempts: 10

=== Step 1: Check-In ===
POST https://simracecenter.com/api/director/v1/sessions/ses_abc123/checkin
Response status: 200 OK
✓ Check-In: checkinId=chk_xyz, TTL=120s

=== Step 2: Wait for Planner ===
Waiting 10s for planner to generate templates...
✓ Planner Wait: Waited 10s

=== Step 3: Poll sequences/next ===
GET https://simracecenter.com/api/director/v1/sessions/ses_abc123/sequences/next?...
Poll attempt 1/10...
Response status: 200 OK
Received sequence: {...}
✓ Poll Sequences: Received sequence: seq_123

=== Step 4: Validate PortableSequence Format ===
✓ Sequence Format: PortableSequence format (steps array with semantic intents)
✓ Required Field: id: id=seq_123
✓ Has Steps/Commands: 5 items
✓ Step Structure: All steps have id, intent, payload

=== Step 5: Validate Director Field Names ===
✓ Camera Field Names: carNum="42", camGroup="1"
✓ OBS Field Names: sceneName="Main Broadcast"

=== Step 6: Validate Metadata ===
✓ metadata.totalDurationMs: 15000ms (>= 10000ms)

=== Step 7: Validate Request Parameters ===
✓ Query Param: intents: Present
  Intents sent: 6 intents
  system.wait, system.log, broadcast.showLiveCam, obs.switchScene, ...
✓ Header: X-Checkin-Id: Present and matches: chk_xyz
✓ Query Param: checkinId: Present (fallback)

=== Step 8: Test Session End (410 Gone) ===
Attempting to wrap session (release check-in)...
Response status: 200 OK
✓ Session Wrap: Successfully released check-in

================================================================================
E2E TEST REPORT
================================================================================

Results: 13/13 tests passed (100%)

✓ Check-In
  checkinId=chk_xyz, TTL=120s
✓ Planner Wait
  Waited 10s
✓ Poll Sequences
  Received sequence: seq_123
...

================================================================================
```

### Exit Codes

- **0** - All tests passed
- **1** - One or more tests failed

### Troubleshooting

#### 409 Conflict on Check-In

```
✗ Check-In: Conflict: Session in use by another director
Hint: Use X-Force-Checkin: true header to force check-in
```

**Solution:** The session is already checked-in by another Director instance. Either:
1. Wrap the existing check-in first
2. Use a different session
3. Add `X-Force-Checkin: true` header (modify script)

#### 204 No Content (No Sequences)

```
✗ Poll Sequences: No sequence available after 10 attempts
```

**Causes:**
- Planner hasn't generated templates yet (increase `TEST_PLANNER_WAIT_MS`)
- Session has no active sequences planned
- Check-in capabilities don't match any templates

**Solution:**
1. Increase wait time: `export TEST_PLANNER_WAIT_MS=30000`
2. Check Race Control UI to see if templates were generated
3. Verify your check-in capabilities match template requirements

#### 410 Gone on First Poll

```
✗ Poll Sequences: Session ended (410 Gone)
```

**Cause:** Session is no longer ACTIVE (it's COMPLETED or CANCELED)

**Solution:** Use an ACTIVE session ID

#### Authentication Errors

```
✗ Check-In: HTTP 401: Unauthorized
```

**Cause:** Bearer token is invalid or expired

**Solution:**
1. Obtain a fresh token
2. Verify token has correct audience/scope for Race Control API
3. Check token expiration time

### Integration with CI/CD

This test can be integrated into CI/CD pipelines:

```yaml
# .github/workflows/e2e-test.yml
- name: Run E2E Director Loop Test
  env:
    TEST_BEARER_TOKEN: ${{ secrets.RC_API_TOKEN }}
    TEST_SESSION_ID: ${{ secrets.TEST_SESSION_ID }}
    VITE_API_BASE_URL: https://dev.simracecenter.com
  run: npm run test:director-loop
```

### Notes

- This test makes **real API calls** to the Race Control environment
- It will **consume a check-in slot** on the session (only 1 concurrent Director per session)
- The test **wraps the check-in** at the end to clean up
- For development/staging environments, use `VITE_API_BASE_URL` override
- The script validates both PortableSequence (new) and legacy (commands) formats
- Validation is based on the contract tests in `src/__tests__/contracts/portable-sequence.contract.test.ts`

### Related Files

- `src/main/director-orchestrator.ts` - Check-in implementation
- `src/main/cloud-poller.ts` - Polling logic
- `src/main/normalizer.ts` - API response normalization
- `src/__tests__/contracts/portable-sequence.contract.test.ts` - Contract tests
- OpenAPI spec: https://simracecenter.com/api/openapi.yaml
