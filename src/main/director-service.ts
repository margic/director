import { AuthService } from './auth-service';
import { 
  ActiveSessionResponse, 
  GetNextSequenceResponse, 
  DirectorStatus 
} from './director-types';
import { SequenceExecutor } from './sequence-executor';
import { apiConfig } from './auth-config';

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
    
    // 1. Discover Session
    const session = await this.getActiveSession();
    if (!session) {
      console.log('No active session found. Director will not start loop.');
      this.isRunning = false;
      return;
    }

    this.currentRaceSessionId = session.raceSessionId;
    console.log(`Joined session: ${session.name} (${session.raceSessionId})`);

    // 2. Start Loop
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

  private async getActiveSession(): Promise<ActiveSessionResponse | null> {
    const token = await this.authService.getAccessToken();
    if (!token) {
      console.warn('No access token available for session discovery');
      return null;
    }

    try {
      const url = `${apiConfig.baseUrl}${apiConfig.endpoints.activeSession}`;
      console.log('Fetching active session from:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.status === 404) {
        console.log('No active session found (404)');
        return null;
      }

      if (!response.ok) {
        console.error(`Failed to fetch active session: ${response.status} ${response.statusText}`);
        return null;
      }

      const data: ActiveSessionResponse = await response.json();
      console.log('Active session found:', data);
      return data;
    } catch (error) {
      console.error('Error fetching active session:', error);
      return null;
    }
  }

  private async fetchAndExecuteNextSequence() {
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

      if (response.status === 204) {
        // No new sequence available
        console.log('No new sequence available (204)');
        return;
      }

      if (!response.ok) {
        console.error(`Failed to fetch next sequence: ${response.status} ${response.statusText}`);
        return;
      }

      const sequence: GetNextSequenceResponse = await response.json();
      console.log('Received sequence:', sequence.sequenceId);

      await this.executor.execute({
        id: sequence.sequenceId,
        commands: sequence.commands
      });
    } catch (error) {
      console.error('Error fetching/executing sequence:', error);
    }
  }
}
