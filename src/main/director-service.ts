import { AuthService } from './auth-service';
import { 
  RaceSession,
  DirectorStatus,
  DirectorState,
  PortableSequence,
  SequenceStep,
  CheckinStatus,
  SessionCheckinRequest,
  SessionCheckinResponse,
  SessionCheckinConflict,
  SessionOperationalConfig,
  DirectorCapabilities,
} from './director-types';
import { randomUUID } from 'crypto';
import { SequenceExecutor } from './sequence-executor';
import { apiConfig } from './auth-config';
import { telemetryService } from './telemetry-service';
import { ExtensionHostService } from './extension-host/extension-host';
import { configService } from './config-service';
import { app } from 'electron';

export class DirectorService {
  private isRunning: boolean = false;
  private status: DirectorStatus = 'IDLE';
  private currentSequenceId: string | null = null;
  private lastCompletedSequenceId: string | null = null;
  private totalCommands: number = 0;
  private processedCommands: number = 0;
  private lastError: string | undefined;
  private loopInterval: NodeJS.Timeout | null = null;
  // Retry interval when RC returns 204 (no sequence available)
  private readonly IDLE_RETRY_MS = 5000;
  private executor: SequenceExecutor;
  private currentRaceSessionId: string | null = null;

  // Session Check-In state
  private checkinId: string | null = null;
  private checkinStatus: CheckinStatus = 'unchecked';
  private sessionConfig: SessionOperationalConfig | null = null;
  private checkinWarnings: string[] = [];
  private checkinTtlSeconds: number = 120;

  constructor(
    private authService: AuthService, 
    private extensionHost: ExtensionHostService
  ) {
    this.executor = new SequenceExecutor(extensionHost);
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('Starting Director Service...');
    this.isRunning = true;
    
    // Use pre-selected session if set, otherwise discover and auto-select
    if (!this.currentRaceSessionId) {
      const sessions = await this.listSessions();
      if (!sessions || sessions.length === 0) {
        console.log('No active sessions found. Director will not start loop.');
        this.isRunning = false;
        return;
      }

      const session = sessions[0];
      this.currentRaceSessionId = session.raceSessionId;
      console.log(`Auto-selected session: ${session.name} (${session.raceSessionId})`);

      if (session.obsHost) {
        console.log(`Configuring OBS connection for session: ${session.obsHost}`);
      }
    } else {
      console.log(`Using pre-selected session: ${this.currentRaceSessionId}`);
    }

    // Start Loop
    this.loop();
  }

  /**
   * Sets the active race session. If the director is running,
   * it stops the current loop and restarts with the new session.
   */
  async setSession(raceSessionId: string): Promise<DirectorState> {
    console.log(`[DirectorService] Setting active session: ${raceSessionId}`);
    const wasRunning = this.isRunning;

    if (wasRunning) {
      this.stop();
    }

    this.currentRaceSessionId = raceSessionId;
    this.lastCompletedSequenceId = null;
    this.lastError = undefined;

    if (wasRunning) {
      await this.start();
    }

    return this.getStatus();
  }

  stop() {
    console.log('Stopping Director Service...');
    this.isRunning = false;
    if (this.loopInterval) {
      clearTimeout(this.loopInterval);
      this.loopInterval = null;
    }
    this.status = 'IDLE';
  }

  getStatus(): DirectorState {
    return {
      isRunning: this.isRunning,
      status: this.status,
      sessionId: this.currentRaceSessionId,
      currentSequenceId: this.currentSequenceId,
      totalCommands: this.totalCommands,
      processedCommands: this.processedCommands,
      lastError: this.lastError,
      checkinStatus: this.checkinStatus,
      checkinId: this.checkinId,
      sessionConfig: this.sessionConfig,
      checkinWarnings: this.checkinWarnings,
    };
  }

  /**
   * Checks into a session with Race Control, exchanging capabilities.
   * Transitions: unchecked → checking-in → standby (or error).
   */
  async checkinSession(raceSessionId: string, options?: { forceCheckin?: boolean }): Promise<DirectorState> {
    if (this.checkinStatus === 'checking-in') {
      console.warn('[Director] Check-in already in progress');
      return this.getStatus();
    }

    console.log(`[Director] Checking into session: ${raceSessionId}`);
    this.checkinStatus = 'checking-in';
    this.lastError = undefined;

    const token = await this.authService.getAccessToken();
    if (!token) {
      this.checkinStatus = 'error';
      this.lastError = 'No auth token available';
      return this.getStatus();
    }

    const capabilities = this.buildCapabilities();
    const directorId = configService.getOrCreateDirectorId();

    const body: SessionCheckinRequest = {
      directorId,
      version: app.getVersion(),
      capabilities,
    };

    const url = `${apiConfig.baseUrl}${apiConfig.endpoints.checkin(raceSessionId)}`;

    try {
      const startTime = Date.now();
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      if (options?.forceCheckin) {
        headers['X-Force-Checkin'] = 'true';
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const duration = Date.now() - startTime;
      telemetryService.trackDependency(
        'RaceControl API', url, duration, response.ok, response.status, 'HTTP',
        { sessionId: raceSessionId, operation: 'checkin' }
      );

      if (response.ok) {
        const data: SessionCheckinResponse = await response.json();
        this.checkinId = data.checkinId;
        this.checkinTtlSeconds = data.checkinTtlSeconds;
        this.sessionConfig = data.sessionConfig;
        this.checkinWarnings = data.warnings ?? [];
        this.checkinStatus = 'standby';
        this.currentRaceSessionId = raceSessionId;

        console.log(`[Director] Checked in: checkinId=${data.checkinId}, TTL=${data.checkinTtlSeconds}s`);
        if (this.checkinWarnings.length > 0) {
          console.warn('[Director] Check-in warnings:', this.checkinWarnings);
        }

        telemetryService.trackEvent('Director.CheckedIn', {
          sessionId: raceSessionId,
          checkinId: data.checkinId,
          warningCount: String(this.checkinWarnings.length),
        });

        return this.getStatus();
      }

      if (response.status === 409) {
        const conflict: SessionCheckinConflict = await response.json();
        this.checkinStatus = 'error';
        this.lastError = `Session in use by ${conflict.existingCheckin.displayName ?? conflict.existingCheckin.directorId}`;
        console.warn(`[Director] Check-in conflict: ${this.lastError}`);
        return this.getStatus();
      }

      // Other errors
      this.checkinStatus = 'error';
      this.lastError = `Check-in failed: ${response.status} ${response.statusText}`;
      console.error(`[Director] ${this.lastError}`);
      return this.getStatus();

    } catch (error) {
      this.checkinStatus = 'error';
      this.lastError = `Check-in error: ${(error as Error).message}`;
      console.error(`[Director] ${this.lastError}`);
      telemetryService.trackException(error as Error, { operation: 'checkinSession', sessionId: raceSessionId });
      return this.getStatus();
    }
  }

  /**
   * Wraps (releases) the current session check-in.
   * Transitions: any → wrapping → unchecked.
   */
  async wrapSession(reason?: string): Promise<DirectorState> {
    if (!this.checkinId || !this.currentRaceSessionId) {
      console.log('[Director] No active check-in to wrap');
      this.resetCheckinState();
      return this.getStatus();
    }

    console.log(`[Director] Wrapping session: ${this.currentRaceSessionId}`);
    this.checkinStatus = 'wrapping';

    // Stop the loop if running
    if (this.isRunning) {
      this.stop();
    }

    const token = await this.authService.getAccessToken();
    if (!token) {
      console.warn('[Director] No auth token for wrap — clearing state locally');
      this.resetCheckinState();
      return this.getStatus();
    }

    const url = `${apiConfig.baseUrl}${apiConfig.endpoints.wrap(this.currentRaceSessionId)}`;

    try {
      const startTime = Date.now();
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Checkin-Id': this.checkinId,
        },
      });

      const duration = Date.now() - startTime;
      telemetryService.trackDependency(
        'RaceControl API', url, duration, response.ok, response.status, 'HTTP',
        { sessionId: this.currentRaceSessionId, operation: 'wrap' }
      );

      if (response.ok || response.status === 404) {
        // 404 means already expired / not found — treat as success
        console.log('[Director] Session wrapped successfully');
        telemetryService.trackEvent('Director.SessionWrapped', {
          sessionId: this.currentRaceSessionId!,
          reason: reason ?? 'manual',
        });
      } else {
        console.warn(`[Director] Wrap returned ${response.status} — clearing state anyway`);
      }
    } catch (error) {
      console.error('[Director] Wrap error (clearing state anyway):', error);
      telemetryService.trackException(error as Error, { operation: 'wrapSession' });
    }

    this.resetCheckinState();
    return this.getStatus();
  }

  /**
   * Builds the capabilities payload from the extension host.
   */
  private buildCapabilities(): DirectorCapabilities {
    const catalog = this.extensionHost.getCapabilityCatalog();
    const allIntents = catalog.getAllIntents();
    const connections = this.extensionHost.getConnectionHealth();

    return {
      intents: allIntents.map(entry => ({
        intent: entry.intent.intent,
        extensionId: entry.extensionId,
        active: entry.enabled,
        schema: entry.intent.schema as Record<string, unknown> | undefined,
      })),
      connections,
    };
  }

  /**
   * Resets all check-in state to initial values.
   */
  private resetCheckinState(): void {
    this.checkinId = null;
    this.checkinStatus = 'unchecked';
    this.sessionConfig = null;
    this.checkinWarnings = [];
    this.checkinTtlSeconds = 120;
  }

  async executeSequenceById(sequenceId: string) {
    if (!sequenceId) return;
    
    console.log(`[Director] Manual execution of sequence: ${sequenceId}`);
    
    // Fetch sequence definition
    const token = await this.authService.getAccessToken();
    if (!token) {
        console.warn('[Director] Cannot execute sequence: No auth token.');
        return;
    }

    try {
        const url = `${apiConfig.baseUrl}${apiConfig.endpoints.getSequence(sequenceId)}`;
        const response = await fetch(url, {
             headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            console.error(`[Director] Failed to fetch sequence ${sequenceId}: ${response.status}`);
            return;
        }

        const sequenceData: any = await response.json();
        
        // API now returns PortableSequence format directly (with steps/intent)
        // Fall back to legacy normalization if it still has old format
        const portable = this.normalizeApiResponse(sequenceData);
        
        this.executor.execute(portable);
        
    } catch (err) {
        console.error(`[Director] Error executing sequence ${sequenceId}:`, err);
    }
  }

  async listSessions(centerId?: string): Promise<RaceSession[]> {
    const startTime = Date.now();
    const token = await this.authService.getAccessToken();
    if (!token) {
      console.warn('No access token available for session discovery');
      return [];
    }

    // Get user profile to obtain centerId if not provided
    const profile = await this.authService.getUserProfile();
    const filterCenterId = centerId || profile?.centerId || profile?.center?.id;

    if (!filterCenterId) {
      console.warn('[DirectorService] No centerId available for session discovery');
      return [];
    }

    try {
      const params = new URLSearchParams({
        centerId: filterCenterId
      });
      const url = `${apiConfig.baseUrl}${apiConfig.endpoints.listSessions}?${params}`;
      console.log('Fetching sessions from:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const duration = Date.now() - startTime;
      const success = response.ok;

      // Track API dependency
      telemetryService.trackDependency(
        'RaceControl API',
        url,
        duration,
        success,
        response.status,
        'HTTP',
        {
          centerId: filterCenterId
        }
      );

      if (!response.ok) {
        console.error(`Failed to fetch sessions: ${response.status} ${response.statusText}`);
        return [];
      }

      const sessions: RaceSession[] = await response.json();
      console.log(`Found ${sessions.length} sessions`);
      
      telemetryService.trackMetric('Sessions.Count', sessions.length, {
        centerId: filterCenterId,
      });

      return sessions;
    } catch (error) {
      console.error('Error fetching sessions:', error);
      const duration = Date.now() - startTime;
      telemetryService.trackDependency(
        'RaceControl API',
        `${apiConfig.baseUrl}${apiConfig.endpoints.listSessions}`,
        duration,
        false,
        0,
        'HTTP',
        {
          error: (error as Error).message,
        }
      );
      telemetryService.trackException(error as Error, { operation: 'listSessions' });
      return [];
    }
  }

  private async loop() {
    if (!this.isRunning || !this.currentRaceSessionId) return;

    let sequenceResult: number | false = false;

    try {
      this.status = 'BUSY';
      sequenceResult = await this.fetchAndExecuteNextSequence();
    } catch (error) {
      if ((error as any)?.sessionEnded) {
        console.log('[Director] Session has ended. Wrapping and stopping.');
        await this.wrapSession('session-ended').catch(() => {});
        this.stop();
        return;
      }
      console.error('Error in director loop:', error);
      this.status = 'ERROR';
    } finally {
      // Schedule next iteration
      if (this.isRunning) {
        this.status = 'IDLE';
        // Determine next-iteration delay:
        //   false          → no sequence and no Retry-After; idle-retry after IDLE_RETRY_MS
        //   0              → sequence executed; call back immediately (execution itself consumed the time)
        //   n > 0          → 204 with Retry-After header; wait the specified duration
        let interval = sequenceResult === false
          ? this.IDLE_RETRY_MS
          : sequenceResult;

        // Heartbeat floor rate contract: poll at min(interval, checkinTtlSeconds / 4)
        // to prevent check-in TTL from lapsing during long Retry-After intervals.
        if (this.checkinId && this.checkinTtlSeconds) {
          const maxIntervalMs = (this.checkinTtlSeconds * 1000) / 4;
          interval = Math.min(interval, maxIntervalMs);
        }

        this.loopInterval = setTimeout(() => this.loop(), interval);
      }
    }
  }

  /**
   * Intent mappings for legacy API CommandType values.
   * Maps the old enum-based command types from the OpenAPI spec
   * to the semantic intent names registered by extensions.
   * @deprecated The API now returns PortableSequence with semantic intents directly.
   */
  private static readonly LEGACY_INTENT_MAP: Record<string, string> = {
    'SWITCH_CAMERA': 'broadcast.showLiveCam',
    'SWITCH_OBS_SCENE': 'obs.switchScene',
    'DRIVER_TTS': 'communication.announce',
    'VIEWER_CHAT': 'communication.talkToChat',
    'PLAY_AUDIO': 'audio.play',          // Future
    'SHOW_OVERLAY': 'overlay.show',       // Future
    'HIDE_OVERLAY': 'overlay.hide',       // Future
  };

  /**
   * Normalizes a raw API response into a PortableSequence.
   * The current API returns PortableSequence format directly (with `steps` and semantic `intent` fields).
   * Legacy format (with `commands` and `commandType` fields) is still supported for backward compatibility.
   */
  private normalizeApiResponse(apiData: any): PortableSequence {
    // New format: API returns PortableSequence directly with `steps`
    if (apiData.steps && Array.isArray(apiData.steps)) {
      return {
        id: apiData.id || randomUUID(),
        name: apiData.name,
        version: apiData.version,
        description: apiData.description,
        category: apiData.category,
        priority: apiData.priority,
        variables: apiData.variables,
        steps: apiData.steps.map((step: any) => ({
          id: step.id || randomUUID(),
          intent: step.intent,
          payload: step.payload || {},
          metadata: step.metadata,
        })),
        metadata: apiData.metadata,
      };
    }

    // Legacy format: API returned DirectorSequence with `commands`
    console.warn('[Director] Received legacy API format with commands[] — normalizing to PortableSequence');
    const commands: any[] = apiData.commands || [];
    
    const steps: SequenceStep[] = commands.map((cmd: any, index: number) => {
      const type = cmd.commandType || cmd.type;
      const id = cmd.id || randomUUID();
      
      // Handle WAIT
      if (type === 'WAIT') {
        const durationMs = cmd.payload?.durationMs ?? cmd.durationMs ?? 0;
        return { id, intent: 'system.wait', payload: { durationMs } };
      }
      
      // Handle LOG
      if (type === 'LOG') {
        const payload = cmd.payload || { message: cmd.message || '', level: cmd.level || 'INFO' };
        return { id, intent: 'system.log', payload };
      }
      
      // Handle EXECUTE_INTENT (already intent-based, unwrap)
      if (type === 'EXECUTE_INTENT') {
        return {
          id,
          intent: cmd.payload?.intent || 'system.log',
          payload: cmd.payload?.payload || {},
        };
      }
      
      // Map legacy command types to semantic intents
      const intent = DirectorService.LEGACY_INTENT_MAP[type];
      if (intent) {
        let payload = cmd.payload || {};
        
        if (cmd.target) {
          if (type === 'SWITCH_CAMERA') {
            payload = {
              carNum: cmd.target.carNumber?.toString(),
              camGroup: cmd.target.cameraGroup?.toString(),
              ...cmd.target,
            };
          } else if (type === 'SWITCH_OBS_SCENE') {
            payload = {
              sceneName: cmd.target.obsSceneId || cmd.target.sceneName,
              ...cmd.target,
            };
          } else {
            payload = { ...cmd.target };
          }
        }
        
        return { id, intent, payload };
      }
      
      // Unknown command — emit a warning log step
      console.warn(`[Director] Unknown API command type: ${type}`);
      return {
        id,
        intent: 'system.log',
        payload: { message: `Unknown API command type: ${type}`, level: 'WARN' },
      };
    });

    return {
      id: apiData.sequenceId || apiData.id || randomUUID(),
      name: apiData.name,
      steps,
      metadata: {
        priority: apiData.priority,
        generatedAt: apiData.generatedAt || apiData.metadata?.generatedAt,
        totalDurationMs: apiData.totalDurationMs || apiData.metadata?.totalDurationMs,
      },
    };
  }

  private async fetchAndExecuteNextSequence(): Promise<number | false> {
    const startTime = Date.now();
    const token = await this.authService.getAccessToken();
    if (!token) {
      console.warn('No access token available for fetching sequence');
      return false;
    }

    if (!this.currentRaceSessionId) {
      console.warn('No active race session ID');
      return false;
    }

    // Build query parameters per updated OpenAPI spec:
    //   lastSequenceId — ID of the sequence just completed (for chaining/logging)
    //   intents — comma-separated list of active intent handlers (capability reporting)
    const params = new URLSearchParams();
    if (this.lastCompletedSequenceId) {
      params.set('lastSequenceId', this.lastCompletedSequenceId);
    }

    // Report active intents so RC constrains sequence generation to what we can execute
    const activeIntents = this.getActiveIntents();
    if (activeIntents.length > 0) {
      params.set('intents', activeIntents.join(','));
    }

    // Fallback: send checkinId as query param in case SWA strips custom headers
    if (this.checkinId) {
      params.set('checkinId', this.checkinId);
    }

    const url = `${apiConfig.baseUrl}${apiConfig.endpoints.nextSequence(this.currentRaceSessionId)}?${params}`;

    try {
      console.log('Fetching next sequence from:', url);
      
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
      };
      if (this.checkinId) {
        headers['X-Checkin-Id'] = this.checkinId;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      const duration = Date.now() - startTime;

      // Handle 410 Gone — session has ended (COMPLETED or CANCELED)
      if (response.status === 410) {
        console.log('[Director] Session ended (410 Gone). Stopping polling.');
        telemetryService.trackDependency(
          'RaceControl API', url, duration, true, 410, 'HTTP',
          { sessionId: this.currentRaceSessionId, result: 'session-ended' }
        );
        const error: any = new Error('Session has ended');
        error.sessionEnded = true;
        throw error;
      }

      if (response.status === 204) {
        // No new sequence available — respect Retry-After header if present
        const retryAfter = response.headers.get('Retry-After');
        console.log(`No new sequence available (204)${retryAfter ? `, Retry-After: ${retryAfter}s` : ''}`);
        telemetryService.trackDependency(
          'RaceControl API',
          url,
          duration,
          true,
          204,
          'HTTP',
          {
            sessionId: this.currentRaceSessionId,
            result: 'no-sequence',
          }
        );
        // Return the Retry-After interval so the loop waits the specified duration before retrying
        if (retryAfter) {
          const retryMs = parseInt(retryAfter, 10) * 1000;
          if (!isNaN(retryMs) && retryMs > 0) {
            return retryMs;
          }
        }
        return false;
      }

      const success = response.ok;
      telemetryService.trackDependency(
        'RaceControl API',
        url,
        duration,
        success,
        response.status,
        'HTTP',
        {
          sessionId: this.currentRaceSessionId,
        }
      );

      if (!response.ok) {
        console.error(`Failed to fetch next sequence: ${response.status} ${response.statusText}`);
        return false;
      }

      const sequenceData: any = await response.json();
      console.log('Received sequence:', JSON.stringify(sequenceData, null, 2));

      // Normalize API response — handles both new PortableSequence format (steps/intent)
      // and legacy DirectorSequence format (commands/commandType) for backward compatibility
      const portable = this.normalizeApiResponse(sequenceData);

      this.currentSequenceId = portable.id;
      this.totalCommands = portable.steps.length;
      this.processedCommands = 0;

      telemetryService.trackEvent('Sequence.Received', {
        sequenceId: portable.id,
        sessionId: this.currentRaceSessionId,
        commandCount: portable.steps.length.toString(),
        priority: String(portable.priority || false),
      });

      await this.executor.execute(portable, (completed, total) => {
        this.processedCommands = completed;
        this.totalCommands = total;
      });

      this.lastCompletedSequenceId = portable.id;
      this.currentSequenceId = null;
      this.totalCommands = 0;
      this.processedCommands = 0;

      telemetryService.trackEvent('Sequence.Executed', {
        sequenceId: portable.id,
        sessionId: this.currentRaceSessionId,
      });

      // Sequence executed — signal the loop to call back immediately (execution itself consumed the time)
      return 0;
    } catch (error) {
      // Re-throw session-ended errors so the loop handler can stop
      if ((error as any)?.sessionEnded) throw error;

      console.error('Error fetching/executing sequence:', error);
      const duration = Date.now() - startTime;
      telemetryService.trackDependency(
        'RaceControl API',
        url,
        duration,
        false,
        0,
        'HTTP',
        {
          error: (error as Error).message,
        }
      );
      telemetryService.trackException(error as Error, {
        operation: 'fetchAndExecuteNextSequence',
        sessionId: this.currentRaceSessionId || 'unknown',
      });
      return false;
    }
  }

  /**
   * Returns the list of currently active intent handlers.
   * Sent as the `intents` query parameter so Race Control constrains
   * sequence generation to only emit steps we can execute.
   * Always includes system.wait and system.log (built-in, always available).
   */
  private getActiveIntents(): string[] {
    const builtIns = ['system.wait', 'system.log'];
    try {
      const catalog = this.extensionHost.getCapabilityCatalog();
      const allIntents = catalog.getAllIntents();
      const activeExtIntents = allIntents
        .filter(entry => entry.enabled)
        .map(entry => entry.intent.intent);
      return [...builtIns, ...activeExtIntents];
    } catch {
      return builtIns;
    }
  }
}
