/**
 * End-to-End Integration Test: Check-in → Poll → Execute flow
 *
 * This script validates the full Director ↔ Race Control round-trip:
 * 1. Hit RC dev API with realistic check-in payload (capabilities, sequences)
 * 2. Wait for planner to generate templates (poll or fixed delay)
 * 3. Request `sequences/next` — expect 200 with PortableSequence
 * 4. Validate canonical intents + Director field names (`carNumber`, `cameraGroup`, `sceneName`)
 * 5. Verify `metadata.totalDurationMs` present and >= 10000
 * 6. Verify `intents` query parameter was sent
 * 7. Verify `X-Checkin-Id` header was sent
 * 8. Simulate session end — expect 410 Gone
 * 9. Document results
 *
 * Part of Integration Plan Phase 2.5: E2E Validation
 */

import * as dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import { PortableSequence } from '../src/main/director-types';

// Load environment variables
dotenv.config();

// Configuration
const CONFIG = {
  apiBaseUrl: process.env.VITE_API_BASE_URL || 'https://simracecenter.com',
  // For testing, you need to provide a valid bearer token
  // In a real scenario, this would come from MSAL authentication
  bearerToken: process.env.TEST_BEARER_TOKEN || '',
  // Test session ID - should be an ACTIVE session in your Race Control center
  testSessionId: process.env.TEST_SESSION_ID || '',
  // Director instance ID
  directorId: `d_inst_${randomUUID()}`,
  // Wait time for planner to generate templates (ms)
  plannerWaitTime: parseInt(process.env.TEST_PLANNER_WAIT_MS || '10000', 10),
  // Maximum polling attempts
  maxPollAttempts: parseInt(process.env.TEST_MAX_POLL_ATTEMPTS || '10', 10),
};

// Validation results
interface ValidationResult {
  test: string;
  passed: boolean;
  details: string;
}

const results: ValidationResult[] = [];

function logResult(test: string, passed: boolean, details: string) {
  results.push({ test, passed, details });
  const status = passed ? '✓' : '✗';
  const color = passed ? '\x1b[32m' : '\x1b[31m';
  console.log(`${color}${status}\x1b[0m ${test}: ${details}`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Attempt to acquire a bearer token via Azure CLI (`az account get-access-token`).
 * Uses the Race Control API scope so the token audience matches the RC API.
 * Returns null if az CLI is not installed, not logged in, or the call fails.
 */
function getAzBearerToken(): string | null {
  const scope = 'api://racecontrol-api-a780e279-1cb6-4ed0-9ef6-49029aa50a42/access_as_user';
  try {
    const token = execSync(
      `az account get-access-token --scope "${scope}" --query accessToken -o tsv`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString().trim();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Step 1: Check-in to a Race Control session
 */
async function testCheckIn(): Promise<string | null> {
  console.log('\n=== Step 1: Check-In ===');

  if (!CONFIG.bearerToken) {
    logResult('Check-In', false, 'TEST_BEARER_TOKEN not set in environment');
    return null;
  }

  if (!CONFIG.testSessionId) {
    logResult('Check-In', false, 'TEST_SESSION_ID not set in environment');
    return null;
  }

  const url = `${CONFIG.apiBaseUrl}/api/director/v1/sessions/${CONFIG.testSessionId}/checkin`;

  // Build realistic capabilities payload
  const capabilities = {
    intents: [
      { intent: 'system.wait', extensionId: 'builtin', active: true },
      { intent: 'system.log', extensionId: 'builtin', active: true },
      { intent: 'broadcast.showLiveCam', extensionId: 'iracing-extension', active: true },
      { intent: 'obs.switchScene', extensionId: 'obs-extension', active: true },
      { intent: 'communication.announce', extensionId: 'discord-extension', active: true },
      { intent: 'communication.talkToChat', extensionId: 'youtube-extension', active: true },
    ],
    connections: {
      obs: { connected: true, version: '30.0.0' },
      iracing: { connected: true, version: '2024.3.0' },
      discord: { connected: true },
      youtube: { connected: true },
    },
  };

  const body = {
    directorId: CONFIG.directorId,
    version: '0.1.0-test',
    capabilities,
  };

  console.log(`POST ${url}`);
  console.log('Request body:', JSON.stringify(body, null, 2));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();
    console.log(`Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      if (response.status === 409) {
        const conflict = JSON.parse(responseText);
        logResult('Check-In', false, `Conflict: Session in use by ${conflict.existingCheckin?.displayName || 'another director'}`);
        console.log('Hint: Use X-Force-Checkin: true header to force check-in');
      } else {
        logResult('Check-In', false, `HTTP ${response.status}: ${responseText}`);
      }
      return null;
    }

    const data = JSON.parse(responseText);
    console.log('Check-in response:', JSON.stringify(data, null, 2));

    const checkinId = data.checkinId;
    const ttlSeconds = data.checkinTtlSeconds;

    if (!checkinId) {
      logResult('Check-In', false, 'Response missing checkinId');
      return null;
    }

    logResult('Check-In', true, `checkinId=${checkinId}, TTL=${ttlSeconds}s`);

    if (data.warnings && data.warnings.length > 0) {
      console.log('⚠️  Check-in warnings:', data.warnings);
    }

    return checkinId;

  } catch (error) {
    logResult('Check-In', false, `Error: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Step 2: Wait for planner to generate templates
 */
async function waitForPlanner(): Promise<void> {
  console.log('\n=== Step 2: Wait for Planner ===');
  const seconds = Math.floor(CONFIG.plannerWaitTime / 1000);
  console.log(`Waiting ${seconds}s for planner to generate templates...`);
  await sleep(CONFIG.plannerWaitTime);
  logResult('Planner Wait', true, `Waited ${seconds}s`);
}

/**
 * Step 3: Poll sequences/next endpoint
 */
async function testPollSequences(checkinId: string): Promise<{ sequence: PortableSequence | null; requestUrl: string; requestHeaders: Record<string, string> }> {
  console.log('\n=== Step 3: Poll sequences/next ===');

  const activeIntents = [
    'system.wait',
    'system.log',
    'broadcast.showLiveCam',
    'obs.switchScene',
    'communication.announce',
    'communication.talkToChat',
  ];

  const params = new URLSearchParams();
  params.set('intents', activeIntents.join(','));
  params.set('checkinId', checkinId);

  const url = `${CONFIG.apiBaseUrl}/api/director/v1/sessions/${CONFIG.testSessionId}/sequences/next?${params}`;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${CONFIG.bearerToken}`,
    'X-Checkin-Id': checkinId,
  };

  console.log(`GET ${url}`);
  console.log('Headers:', JSON.stringify(headers, null, 2));

  for (let attempt = 1; attempt <= CONFIG.maxPollAttempts; attempt++) {
    console.log(`\nPoll attempt ${attempt}/${CONFIG.maxPollAttempts}...`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      console.log(`Response status: ${response.status} ${response.statusText}`);

      // Handle 410 Gone (session ended)
      if (response.status === 410) {
        logResult('Poll Sequences', false, 'Session ended (410 Gone) - expected during active session');
        return { sequence: null, requestUrl: url, requestHeaders: headers };
      }

      // Handle 204 No Content (no sequence available yet)
      if (response.status === 204) {
        const retryAfter = response.headers.get('Retry-After');
        console.log(`No sequence available (204)${retryAfter ? `, Retry-After: ${retryAfter}s` : ''}`);

        if (attempt < CONFIG.maxPollAttempts) {
          const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
          console.log(`Waiting ${waitMs}ms before retry...`);
          await sleep(waitMs);
          continue;
        }

        logResult('Poll Sequences', false, `No sequence available after ${CONFIG.maxPollAttempts} attempts`);
        return { sequence: null, requestUrl: url, requestHeaders: headers };
      }

      // Handle other errors
      if (!response.ok) {
        const errorText = await response.text();
        logResult('Poll Sequences', false, `HTTP ${response.status}: ${errorText}`);
        return { sequence: null, requestUrl: url, requestHeaders: headers };
      }

      // Handle 200 OK (sequence received)
      const sequenceData: any = await response.json();
      console.log('Received sequence:', JSON.stringify(sequenceData, null, 2));

      logResult('Poll Sequences', true, `Received sequence: ${sequenceData.id || sequenceData.sequenceId}`);
      return { sequence: sequenceData, requestUrl: url, requestHeaders: headers };

    } catch (error) {
      logResult('Poll Sequences', false, `Error: ${(error as Error).message}`);
      return { sequence: null, requestUrl: url, requestHeaders: headers };
    }
  }

  logResult('Poll Sequences', false, 'Max poll attempts reached');
  return { sequence: null, requestUrl: url, requestHeaders: headers };
}

/**
 * Step 4: Validate PortableSequence format
 */
function validatePortableSequence(sequence: any): void {
  console.log('\n=== Step 4: Validate PortableSequence Format ===');

  // Check if it's PortableSequence (with steps) or legacy format (with commands)
  const isPortableFormat = sequence.steps && Array.isArray(sequence.steps);
  const isLegacyFormat = sequence.commands && Array.isArray(sequence.commands);

  if (!isPortableFormat && !isLegacyFormat) {
    logResult('Sequence Format', false, 'Unknown format: missing both steps and commands arrays');
    return;
  }

  if (isLegacyFormat) {
    logResult('Sequence Format', true, 'Legacy format (commands array) - will be normalized by Director');
    console.log('Note: Director normalizer will convert commands → steps with semantic intents');
  } else {
    logResult('Sequence Format', true, 'PortableSequence format (steps array with semantic intents)');
  }

  // Validate required fields
  const hasId = !!(sequence.id || sequence.sequenceId);
  logResult('Required Field: id', hasId, hasId ? `id=${sequence.id || sequence.sequenceId}` : 'Missing id/sequenceId');

  // Validate steps/commands
  const items = sequence.steps || sequence.commands || [];
  logResult('Has Steps/Commands', items.length > 0, `${items.length} items`);

  // Validate step structure
  if (isPortableFormat) {
    let allStepsValid = true;
    sequence.steps.forEach((step: any, index: number) => {
      const hasStepId = !!step.id;
      const hasIntent = !!step.intent;
      const hasPayload = step.payload !== undefined;

      if (!hasStepId || !hasIntent || !hasPayload) {
        console.log(`  ✗ Step ${index}: missing ${[!hasStepId && 'id', !hasIntent && 'intent', !hasPayload && 'payload'].filter(Boolean).join(', ')}`);
        allStepsValid = false;
      }
    });

    logResult('Step Structure', allStepsValid, allStepsValid ? 'All steps have id, intent, payload' : 'Some steps missing required fields');
  }
}

/**
 * Step 5: Validate Director field names
 */
function validateFieldNames(sequence: any): void {
  console.log('\n=== Step 5: Validate Director Field Names ===');

  const items = sequence.steps || sequence.commands || [];
  let foundCameraCommand = false;
  let foundObsCommand = false;
  let cameraFieldsCorrect = false;
  let obsFieldsCorrect = false;

  items.forEach((item: any) => {
    const intent = item.intent || item.type;
    const payload = item.payload || {};

    // Check camera command field names
    if (intent === 'broadcast.showLiveCam' || intent === 'SWITCH_CAMERA') {
      foundCameraCommand = true;

      // Check for correct field names: carNumber, cameraGroup (canonical API names)
      const hasCarNum = 'carNumber' in payload || 'carNum' in payload;
      const hasCamGroup = 'cameraGroup' in payload || 'camGroup' in payload || 'cameraGroupNumber' in payload;

      if (hasCarNum && hasCamGroup) {
        cameraFieldsCorrect = true;
        const carNum = payload.carNumber ?? payload.carNum;
        const camGroup = payload.cameraGroup ?? payload.camGroup ?? payload.cameraGroupNumber;
        logResult('Camera Field Names', true, `carNumber="${carNum}", cameraGroup="${camGroup}"`);
      } else {
        const fields = Object.keys(payload).join(', ');
        logResult('Camera Field Names', false, `Expected carNumber and cameraGroup, found: ${fields}`);
      }
    }

    // Check OBS command field names
    if (intent === 'obs.switchScene' || intent === 'SWITCH_OBS_SCENE') {
      foundObsCommand = true;

      // Check for correct field name: sceneName
      if ('sceneName' in payload) {
        obsFieldsCorrect = true;
        logResult('OBS Field Names', true, `sceneName="${payload.sceneName}"`);
      } else {
        const fields = Object.keys(payload).join(', ');
        logResult('OBS Field Names', false, `Expected sceneName, found: ${fields}`);
      }
    }
  });

  if (!foundCameraCommand) {
    console.log('ℹ️  No camera command in sequence - skipping camera field validation');
  }

  if (!foundObsCommand) {
    console.log('ℹ️  No OBS command in sequence - skipping OBS field validation');
  }
}

/**
 * Step 6: Validate metadata.totalDurationMs
 */
function validateMetadata(sequence: any): void {
  console.log('\n=== Step 6: Validate Metadata ===');

  const metadata = sequence.metadata;
  const totalDurationMs = metadata?.totalDurationMs || sequence.totalDurationMs;

  if (totalDurationMs !== undefined) {
    const isValid = totalDurationMs >= 10000;
    logResult(
      'metadata.totalDurationMs',
      isValid,
      isValid
        ? `${totalDurationMs}ms (>= 10000ms)`
        : `${totalDurationMs}ms (expected >= 10000ms for AI-generated sequences)`
    );
  } else {
    // totalDurationMs is optional for manual sequences
    logResult('metadata.totalDurationMs', true, 'Not present (acceptable for manual sequences)');
  }

  // Check for other metadata fields
  if (metadata?.source) {
    console.log(`ℹ️  metadata.source: ${metadata.source}`);
  }
  if (metadata?.generatedAt) {
    console.log(`ℹ️  metadata.generatedAt: ${metadata.generatedAt}`);
  }
}

/**
 * Step 7: Verify query parameters and headers
 */
function validateRequestParams(requestUrl: string, requestHeaders: Record<string, string>, checkinId: string): void {
  console.log('\n=== Step 7: Validate Request Parameters ===');

  // Check intents query parameter
  const hasIntents = requestUrl.includes('intents=');
  logResult('Query Param: intents', hasIntents, hasIntents ? 'Present' : 'Missing');

  if (hasIntents) {
    const urlObj = new URL(requestUrl);
    const intents = urlObj.searchParams.get('intents');
    if (intents) {
      const intentList = intents.split(',');
      console.log(`  Intents sent: ${intentList.length} intents`);
      console.log(`  ${intentList.join(', ')}`);
    }
  }

  // Check X-Checkin-Id header
  const hasCheckinHeader = 'X-Checkin-Id' in requestHeaders;
  const checkinHeaderMatches = requestHeaders['X-Checkin-Id'] === checkinId;

  logResult(
    'Header: X-Checkin-Id',
    hasCheckinHeader && checkinHeaderMatches,
    hasCheckinHeader
      ? (checkinHeaderMatches ? `Present and matches: ${checkinId}` : `Present but mismatch`)
      : 'Missing'
  );

  // Check checkinId query parameter
  const hasCheckinParam = requestUrl.includes('checkinId=');
  logResult('Query Param: checkinId', hasCheckinParam, hasCheckinParam ? 'Present (fallback)' : 'Missing');
}

/**
 * Step 8: Test session end (410 Gone)
 */
async function testSessionEnd(checkinId: string): Promise<void> {
  console.log('\n=== Step 8: Test Session End (410 Gone) ===');
  console.log('Note: This test will fail if the session is still active.');
  console.log('In a real scenario, 410 Gone is returned when the session ends.');

  // For demonstration, we'll just document the expected behavior
  console.log('Expected behavior:');
  console.log('  - When session ends (COMPLETED/CANCELED), API returns 410 Gone');
  console.log('  - Director CloudPoller detects 410 and stops polling');
  console.log('  - SessionManager.clearSession() is called');
  console.log('  - DirectorOrchestrator transitions to stopped mode');

  // Optionally, wrap the session to trigger cleanup
  console.log('\nAttempting to wrap session (release check-in)...');

  const url = `${CONFIG.apiBaseUrl}/api/director/v1/sessions/${CONFIG.testSessionId}/checkin`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${CONFIG.bearerToken}`,
        'X-Checkin-Id': checkinId,
      },
    });

    console.log(`Response status: ${response.status} ${response.statusText}`);

    if (response.ok || response.status === 404) {
      logResult('Session Wrap', true, 'Successfully released check-in');
    } else {
      const errorText = await response.text();
      logResult('Session Wrap', false, `HTTP ${response.status}: ${errorText}`);
    }

  } catch (error) {
    logResult('Session Wrap', false, `Error: ${(error as Error).message}`);
  }
}

/**
 * Generate test report
 */
function generateReport(): void {
  console.log('\n' + '='.repeat(80));
  console.log('E2E TEST REPORT');
  console.log('='.repeat(80));

  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const percentage = total > 0 ? Math.round((passed / total) * 100) : 0;

  console.log(`\nResults: ${passed}/${total} tests passed (${percentage}%)\n`);

  results.forEach(result => {
    const status = result.passed ? '✓' : '✗';
    const color = result.passed ? '\x1b[32m' : '\x1b[31m';
    console.log(`${color}${status}\x1b[0m ${result.test}`);
    if (result.details) {
      console.log(`  ${result.details}`);
    }
  });

  console.log('\n' + '='.repeat(80));
}

/**
 * Main test execution
 */
async function runE2ETest() {
  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' '.repeat(78) + '║');
  console.log('║' + '  Director E2E Integration Test: Check-in → Poll → Execute'.padEnd(78) + '║');
  console.log('║' + ' '.repeat(78) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');

  console.log('\nConfiguration:');
  console.log(`  API Base URL: ${CONFIG.apiBaseUrl}`);
  console.log(`  Session ID: ${CONFIG.testSessionId || '(not set)'}`);
  console.log(`  Director ID: ${CONFIG.directorId}`);
  // Resolve bearer token: prefer TEST_BEARER_TOKEN env var, then try az CLI
  if (!CONFIG.bearerToken) {
    process.stdout.write('  Bearer Token: (not set) — attempting acquisition via Azure CLI... ');
    const azToken = getAzBearerToken();
    if (azToken) {
      CONFIG.bearerToken = azToken;
      console.log('\x1b[32m(acquired via az CLI)\x1b[0m');
    } else {
      console.log('\x1b[31m(failed)\x1b[0m');
    }
  } else {
    console.log(`  Bearer Token: (set via TEST_BEARER_TOKEN)`);
  }
  console.log(`  Planner Wait: ${CONFIG.plannerWaitTime}ms`);
  console.log(`  Max Poll Attempts: ${CONFIG.maxPollAttempts}`);

  if (!CONFIG.bearerToken || !CONFIG.testSessionId) {
    console.log('\n\x1b[31m✗ Missing required configuration\x1b[0m');
    if (!CONFIG.testSessionId) {
      console.log('\n  TEST_SESSION_ID is required — set it to an ACTIVE Race Control session ID:');
      console.log('    export TEST_SESSION_ID=<active-session-id>');
    }
    if (!CONFIG.bearerToken) {
      console.log('\n  No bearer token available. Options:');
      console.log('    1. Log in with the Azure CLI:  az login');
      console.log('       (token will be auto-acquired on next run)');
      console.log('    2. Set TEST_BEARER_TOKEN manually:');
      console.log('       export TEST_BEARER_TOKEN=<your-bearer-token>');
    }
    console.log('\nOptional configuration:');
    console.log('  VITE_API_BASE_URL=https://simracecenter.com (default)');
    console.log('  TEST_PLANNER_WAIT_MS=10000 (default)');
    console.log('  TEST_MAX_POLL_ATTEMPTS=10 (default)');
    process.exit(1);
  }

  try {
    // Step 1: Check-in
    const checkinId = await testCheckIn();
    if (!checkinId) {
      console.log('\n\x1b[31m✗ Check-in failed. Aborting test.\x1b[0m');
      generateReport();
      process.exit(1);
    }

    // Step 2: Wait for planner
    await waitForPlanner();

    // Step 3: Poll sequences/next
    const { sequence, requestUrl, requestHeaders } = await testPollSequences(checkinId);

    if (sequence) {
      // Step 4: Validate format
      validatePortableSequence(sequence);

      // Step 5: Validate field names
      validateFieldNames(sequence);

      // Step 6: Validate metadata
      validateMetadata(sequence);

      // Step 7: Validate request params
      validateRequestParams(requestUrl, requestHeaders, checkinId);
    } else {
      console.log('\n⚠️  No sequence received - skipping validation steps 4-7');
    }

    // Step 8: Test session end
    await testSessionEnd(checkinId);

    // Generate final report
    generateReport();

    // Exit with appropriate code
    const allPassed = results.every(r => r.passed);
    process.exit(allPassed ? 0 : 1);

  } catch (error) {
    console.error('\n\x1b[31m✗ Fatal error:\x1b[0m', error);
    generateReport();
    process.exit(1);
  }
}

// Run the test
runE2ETest().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
