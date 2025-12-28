import { AuthService } from './auth-service';
import { 
  ActiveSessionResponse, 
  GetNextSequenceResponse, 
  DirectorStatus 
} from './director-types';
import { SequenceExecutor } from './sequence-executor';

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
    const session = await this.discoverSession();
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

  private async discoverSession(): Promise<ActiveSessionResponse | null> {
    const token = await this.authService.getAccessToken();
    if (!token) {
      console.warn('No access token available for session discovery');
      return null;
    }

    // TODO: Replace with actual API call
    // GET /api/director/v1/sessions/active
    console.log('Mock: Discovering session with token', token.substring(0, 10) + '...');
    
    // Mock response
    return {
      raceSessionId: 'mock-session-123',
      name: 'Mock Practice Session',
      status: 'ACTIVE'
    };
  }

  private async fetchAndExecuteNextSequence() {
    const token = await this.authService.getAccessToken();
    if (!token) return;

    // TODO: Replace with actual API call
    // GET /api/director/v1/sessions/{raceSessionId}/sequences/next
    
    // Mock: Randomly return a sequence occasionally
    if (Math.random() > 0.7) {
      console.log('Mock: Found new sequence');
      const mockSequence: GetNextSequenceResponse = {
        sequenceId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        commands: [
          {
            id: crypto.randomUUID(),
            type: 'LOG',
            payload: { message: 'Starting sequence', level: 'INFO' }
          },
          {
            id: crypto.randomUUID(),
            type: 'WAIT',
            payload: { durationMs: 2000 }
          },
          {
            id: crypto.randomUUID(),
            type: 'LOG',
            payload: { message: 'Sequence complete', level: 'INFO' }
          }
        ]
      };

      await this.executor.execute({
        id: mockSequence.sequenceId,
        commands: mockSequence.commands
      });
    }
  }
}
