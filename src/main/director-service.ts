import { AuthService } from './auth-service';
import { 
  RaceSession,
  GetNextSequenceResponse, 
  DirectorStatus 
} from './director-types';
import { SequenceExecutor } from './sequence-executor';
import { apiConfig } from './auth-config';
import { telemetryService } from './telemetry-service';

export class DirectorService {
  private isRunning: boolean = false;
  private status: DirectorStatus = 'IDLE';
  private loopInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 5000; // 5 seconds
  private authService: AuthService;
  private executor: SequenceExecutor;
  private currentRaceSessionId: string | null = null;

  constructor(authService: AuthService) {
    this.authService = authService;
    this.executor = new SequenceExecutor();
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

  getStatus() {
    return {
      isRunning: this.isRunning,
      status: this.status,
      sessionId: this.currentRaceSessionId
    };
  }

  async listSessions(centerId?: string, status?: string): Promise<RaceSession[]> {
    const startTime = Date.now();
    const token = await this.authService.getAccessToken();
    if (!token) {
      console.warn('No access token available for session discovery');
      return [];
    }

    // Get user profile to obtain centerId if not provided
    const profile = await this.authService.getUserProfile();
    const filterCenterId = centerId || profile?.centerId;

    if (!filterCenterId) {
      console.warn('No centerId available for session discovery');
      return [];
    }

    try {
      const params = new URLSearchParams({
        centerId: filterCenterId,
        status: status || 'ACTIVE'
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
        `GET ${apiConfig.endpoints.listSessions}`,
        duration,
        success,
        response.status,
        'HTTP',
        {
          centerId: filterCenterId,
          status: status || 'ACTIVE',
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
        `GET ${apiConfig.endpoints.listSessions}`,
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

    try {
      this.status = 'BUSY';
      await this.fetchAndExecuteNextSequence();
    } catch (error) {
      console.error('Error in director loop:', error);
      this.status = 'ERROR';
    } finally {
      // Schedule next iteration
      if (this.isRunning) {
        this.status = 'IDLE';
        this.loopInterval = setTimeout(() => this.loop(), this.POLL_INTERVAL_MS);
      }
    }
  }

  private async fetchAndExecuteNextSequence() {
    const startTime = Date.now();
    const token = await this.authService.getAccessToken();
    if (!token) {
      console.warn('No access token available for fetching sequence');
      return;
    }

    if (!this.currentRaceSessionId) {
      console.warn('No active race session ID');
      return;
    }

    try {
      const url = `${apiConfig.baseUrl}${apiConfig.endpoints.nextSequence(this.currentRaceSessionId)}`;
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
          `GET nextSequence`,
          duration,
          true,
          204,
          'HTTP',
          {
            sessionId: this.currentRaceSessionId,
            result: 'no-sequence',
          }
        );
        return;
      }

      const success = response.ok;
      telemetryService.trackDependency(
        'RaceControl API',
        `GET nextSequence`,
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
        return;
      }

      const sequence: GetNextSequenceResponse = await response.json();
      console.log('Received sequence:', sequence.sequenceId);

      telemetryService.trackEvent('Sequence.Received', {
        sequenceId: sequence.sequenceId,
        sessionId: this.currentRaceSessionId,
        commandCount: sequence.commands.length.toString(),
        priority: sequence.priority || 'NORMAL',
      });

      await this.executor.execute({
        id: sequence.sequenceId,
        commands: sequence.commands
      });

      telemetryService.trackEvent('Sequence.Executed', {
        sequenceId: sequence.sequenceId,
        sessionId: this.currentRaceSessionId,
      });
    } catch (error) {
      console.error('Error fetching/executing sequence:', error);
      const duration = Date.now() - startTime;
      telemetryService.trackDependency(
        'RaceControl API',
        `GET nextSequence`,
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
    }
  }
}
