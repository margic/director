import { AuthService } from './auth-service';
import { 
  RaceSession,
  GetNextSequenceResponse, 
  DirectorStatus,
  DirectorState,
  DirectorCommand,
  DirectorSequence,
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
    
    // 1. Discover Sessions
    const sessions = await this.listSessions();
    if (!sessions || sessions.length === 0) {
      console.log('No active sessions found. Director will not start loop.');
      this.isRunning = false;
      return;
    }

    // 2. Auto-select session (for now, pick the first one)
    const session = sessions[0];
    this.currentRaceSessionId = session.raceSessionId;
    console.log(`Joined session: ${session.name} (${session.raceSessionId})`);

    // Configure OBS if host is provided (via extension intent system)
    if (session.obsHost) {
      console.log(`Configuring OBS connection for session: ${session.obsHost}`);
      // TODO: Once OBS extension supports a 'connect' intent or config update,
      // dispatch it here. For now, OBS extension auto-connects from its settings.
    }

    // 3. Start Loop
    this.loop();
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
        
        // Normalize API response to PortableSequence format
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
      console.warn('No centerId available for session discovery');
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
   * Normalizes a raw API response (legacy DirectorCommand[]) into a PortableSequence.
   * This is the single adapter point between the Race Control API format
   * and the intent-driven execution engine.
   */
  private normalizeApiResponse(apiData: any): PortableSequence {
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
        // Build payload from target object (OpenAPI format) or inline payload
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
        generatedAt: apiData.generatedAt,
        totalDurationMs: apiData.totalDurationMs,
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

    const params = new URLSearchParams({ status: this.status });
    if (this.lastCompletedSequenceId) {
      params.set('currentSequenceId', this.lastCompletedSequenceId);
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

      if (response.status === 204) {
        // No new sequence available
        console.log('No new sequence available (204)');
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

      // Normalize API response to PortableSequence using the adapter
      const portable = this.normalizeApiResponse(sequenceData);

      this.currentSequenceId = portable.id;
      this.totalCommands = portable.steps.length;
      this.processedCommands = 0;

      telemetryService.trackEvent('Sequence.Received', {
        sequenceId: portable.id,
        sessionId: this.currentRaceSessionId,
        commandCount: portable.steps.length.toString(),
        priority: String(portable.metadata?.priority || 'NORMAL'),
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

      return sequenceData.totalDurationMs ?? 0;
    } catch (error) {
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
}
