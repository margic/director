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
import { SequenceScheduler } from './sequence-scheduler';
import { CloudPoller } from './cloud-poller';
import { normalizeApiResponse } from './normalizer';
import { apiConfig } from './auth-config';
import { telemetryService } from './telemetry-service';
import { ExtensionHostService } from './extension-host/extension-host';
import { configService } from './config-service';
import { app } from 'electron';
import { SessionManager } from './session-manager';

export class DirectorService {
  private isRunning: boolean = false;
  private status: DirectorStatus = 'IDLE';
  private currentSequenceId: string | null = null;
  private totalCommands: number = 0;
  private processedCommands: number = 0;
  private lastError: string | undefined;
  private executor: SequenceExecutor;
  private scheduler: SequenceScheduler;
  private cloudPoller: CloudPoller | null = null;
  private currentRaceSessionId: string | null = null;

  // Session Check-In state
  private checkinId: string | null = null;
  private checkinStatus: CheckinStatus = 'unchecked';
  private sessionConfig: SessionOperationalConfig | null = null;
  private checkinWarnings: string[] = [];
  private checkinTtlSeconds: number = 120;

  constructor(
    private authService: AuthService,
    private extensionHost: ExtensionHostService,
    private sessionManager: SessionManager
  ) {
    this.executor = new SequenceExecutor(extensionHost);
    this.scheduler = new SequenceScheduler(this.executor);

    // Subscribe to scheduler progress events
    this.scheduler.on('progress', (progress) => {
      // Update current sequence tracking from scheduler progress
      if (progress.stepStatus === 'running' && progress.stepIntent !== 'sequence.start' && progress.stepIntent !== 'sequence.end') {
        this.currentSequenceId = progress.sequenceId;
        this.totalCommands = progress.totalSteps;
        this.processedCommands = progress.currentStep;
      } else if (progress.stepIntent === 'sequence.end') {
        this.currentSequenceId = null;
        this.totalCommands = 0;
        this.processedCommands = 0;
      }
    });
  }

  async start() {
    if (this.isRunning) return;

    console.log('Starting Director Service...');
    this.isRunning = true;

    // Get selected session from SessionManager
    const selectedSession = this.sessionManager.getSelectedSession();
    if (!selectedSession) {
      console.log('No session selected. Director will not start loop.');
      this.isRunning = false;
      return;
    }

    this.currentRaceSessionId = selectedSession.raceSessionId;
    console.log(`Using selected session: ${selectedSession.name} (${selectedSession.raceSessionId})`);

    if (selectedSession.obsHost) {
      console.log(`Configuring OBS connection for session: ${selectedSession.obsHost}`);
    }

    // Create and start CloudPoller
    this.cloudPoller = new CloudPoller(
      this.authService,
      this.currentRaceSessionId,
      {
        idleRetryMs: 5000,
        getActiveIntents: () => this.getActiveIntents(),
        onSequence: (sequence) => this.handleSequence(sequence),
        onSessionEnded: () => this.handleSessionEnded(),
        checkinId: this.checkinId || undefined,
        checkinTtlSeconds: this.checkinTtlSeconds,
      }
    );

    this.cloudPoller.start();
  }

  /**
   * Sets the active race session via SessionManager. If the director is running,
   * it stops the current loop and restarts with the new session.
   *
   * @deprecated Use SessionManager.selectSession() directly instead
   */
  async setSession(raceSessionId: string): Promise<DirectorState> {
    console.log(`[DirectorService] Setting active session: ${raceSessionId}`);
    const wasRunning = this.isRunning;

    if (wasRunning) {
      this.stop();
    }

    // Update session via SessionManager
    this.sessionManager.selectSession(raceSessionId);
    this.currentRaceSessionId = raceSessionId;
    this.lastError = undefined;

    if (wasRunning) {
      await this.start();
    }

    return this.getStatus();
  }

  stop() {
    console.log('Stopping Director Service...');
    this.isRunning = false;
    if (this.cloudPoller) {
      this.cloudPoller.stop();
      this.cloudPoller = null;
    }
    this.status = 'IDLE';
  }

  /**
   * Handles a sequence received from CloudPoller.
   * Enqueues it in SequenceScheduler with source='director-loop'.
   */
  private async handleSequence(sequence: PortableSequence): Promise<void> {
    console.log(`[DirectorService] Received sequence from cloud: ${sequence.id} (${sequence.steps.length} steps)`);

    // Enqueue in scheduler with director-loop source
    await this.scheduler.enqueue(sequence, {}, {
      source: 'director-loop',
      priority: sequence.priority,
    });

    // Listen for completion to notify CloudPoller
    const executionId = sequence.id;
    const completionListener = (result: any) => {
      if (result.sequenceId === sequence.id) {
        console.log(`[DirectorService] Sequence ${sequence.id} completed with status: ${result.status}`);
        if (this.cloudPoller) {
          this.cloudPoller.onSequenceCompleted(sequence.id);
        }
        this.scheduler.off('historyChanged', completionListener);
      }
    };
    this.scheduler.on('historyChanged', completionListener);
  }

  /**
   * Handles session ended event from CloudPoller (410 Gone).
   * Clears the session in SessionManager and stops polling.
   */
  private async handleSessionEnded(): Promise<void> {
    console.log('[DirectorService] Session ended (410 Gone). Wrapping and stopping.');
    await this.wrapSession('session-ended').catch(() => {});
    this.sessionManager.clearSession();
    this.stop();
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

        // Update CloudPoller with check-in credentials
        if (this.cloudPoller) {
          this.cloudPoller.updateCheckin(data.checkinId, data.checkinTtlSeconds);
        }

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

    // Clear CloudPoller's check-in credentials
    if (this.cloudPoller) {
      this.cloudPoller.clearCheckin();
    }
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

        // Normalize API response using centralised normalizer
        const portable = normalizeApiResponse(sequenceData);

        // Enqueue via SequenceScheduler with 'manual' source
        await this.scheduler.enqueue(portable, {}, { source: 'manual' });

    } catch (err) {
        console.error(`[Director] Error executing sequence ${sequenceId}:`, err);
    }
  }

  /**
   * @deprecated Use SessionManager.discover() instead
   */
  async listSessions(centerId?: string): Promise<RaceSession[]> {
    console.warn('[DirectorService] listSessions() is deprecated. Use SessionManager.discover() instead.');
    await this.sessionManager.discover(centerId);
    return this.sessionManager.getSessions();
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
