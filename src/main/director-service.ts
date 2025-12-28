import { AuthService } from './auth-service';
import { 
  RaceSession,
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

    // TODO: Replace with actual API call
    // GET /api/director/v1/sessions?centerId={centerId}&status=ACTIVE
    console.log(`Mock: Listing sessions for centerId=${filterCenterId}, status=${status || 'ACTIVE'}`);
    
    // Mock response with multiple sessions
    return [
      {
        raceSessionId: 'mock-session-123',
        name: 'Practice Session A',
        status: 'ACTIVE',
        centerId: filterCenterId,
        createdAt: new Date().toISOString()
      },
      {
        raceSessionId: 'mock-session-456',
        name: 'Qualifying B',
        status: 'ACTIVE',
        centerId: filterCenterId,
        createdAt: new Date().toISOString()
      }
    ];
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
