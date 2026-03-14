import { AuthService } from './auth-service';
import { 
  RaceSession,
  DirectorStatus,
  DirectorState,
  PortableSequence,
  SequenceStep,
} from './director-types';
import { randomUUID } from 'crypto';
import { SequenceExecutor } from './sequence-executor';
import { apiConfig } from './auth-config';
import { telemetryService } from './telemetry-service';
import { ExtensionHostService } from './extension-host/extension-host';

export class DirectorService {
  private isRunning: boolean = false;
  private status: DirectorStatus = 'IDLE';
  private currentSequenceId: string | null = null;
  private lastCompletedSequenceId: string | null = null;
  private totalCommands: number = 0;
  private processedCommands: number = 0;
  private lastError: string | undefined;
  private loopInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 5000; // 5 seconds
  private readonly BUSY_INTERVAL_MS = 100; // 100ms (rapid fire)
  private executor: SequenceExecutor;
  private currentRaceSessionId: string | null = null;

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
      lastError: this.lastError
    };
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
        console.log('[Director] Session has ended. Stopping director loop.');
        this.stop();
        return;
      }
      console.error('Error in director loop:', error);
      this.status = 'ERROR';
    } finally {
      // Schedule next iteration
      if (this.isRunning) {
        this.status = 'IDLE';
        let interval = this.POLL_INTERVAL_MS;

        if (sequenceResult !== false) {
          // If we executed a sequence, use its duration if provided, otherwise default busy interval
          interval = sequenceResult > 0 ? sequenceResult : this.BUSY_INTERVAL_MS;
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

    const url = `${apiConfig.baseUrl}${apiConfig.endpoints.nextSequence(this.currentRaceSessionId)}?${params}`;

    try {
      console.log('Fetching next sequence from:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
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
        // Return negative value to signal the loop to use Retry-After as the poll interval
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

      // Use metadata.totalDurationMs for poll pacing (per RFC agreement)
      const totalDurationMs = (portable.metadata as any)?.totalDurationMs ?? 0;
      return totalDurationMs;
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
