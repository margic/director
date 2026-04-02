/**
 * director-orchestrator.ts
 *
 * Replaces DirectorService with a mode-based FSM orchestrator.
 * Coordinates SessionManager, CloudPoller, and SequenceScheduler.
 *
 * Mode Model:
 * STOPPED ──(select session)──→ MANUAL ──(start auto)──→ AUTO
 *    ↑       ←(clear session)──   ↑      ←(stop auto)──  │
 *    └─────────────────────────────┘←────(410 Gone)───────┘
 */

import { EventEmitter } from 'events';
import { AuthService } from './auth-service';
import {
  RaceSession,
  DirectorStatus,
  PortableSequence,
  CheckinStatus,
  SessionCheckinRequest,
  SessionCheckinResponse,
  SessionCheckinConflict,
  SessionOperationalConfig,
  DirectorCapabilities,
} from './director-types';
import { randomUUID } from 'crypto';
import { SequenceScheduler } from './sequence-scheduler';
import { CloudPoller } from './cloud-poller';
import { normalizeApiResponse } from './normalizer';
import { apiConfig } from './auth-config';
import { telemetryService } from './telemetry-service';
import { ExtensionHostService } from './extension-host/extension-host';
import { configService } from './config-service';
import { app } from 'electron';
import { SessionManager } from './session-manager';

export type DirectorMode = 'stopped' | 'manual' | 'auto';

export interface DirectorOrchestratorState {
  mode: DirectorMode;
  status: DirectorStatus;
  sessionId: string | null;
  currentSequenceId?: string | null;
  totalCommands?: number;
  processedCommands?: number;
  lastError?: string;
  // Session Check-In lifecycle
  checkinStatus: CheckinStatus;
  checkinId?: string | null;
  sessionConfig?: SessionOperationalConfig | null;
  checkinWarnings?: string[];
}

export interface DirectorConfig {
  defaultMode?: DirectorMode;
  autoStartOnSessionSelect?: boolean;
}

/**
 * DirectorOrchestrator manages the director lifecycle with a mode-based state machine.
 *
 * Modes:
 * - stopped: No session selected, no polling
 * - manual: Session selected, no auto-polling, UI can trigger manual execution
 * - auto: Session selected, CloudPoller running, sequences executed automatically
 *
 * Transitions:
 * - stopped → manual: When session is selected (if autoStartOnSessionSelect=false)
 * - stopped → auto: When session is selected (if autoStartOnSessionSelect=true)
 * - manual → auto: When setMode('auto') is called
 * - auto → manual: When setMode('manual') is called
 * - any → stopped: When session is cleared or 410 Gone received
 */
export class DirectorOrchestrator extends EventEmitter {
  private mode: DirectorMode = 'stopped';
  private status: DirectorStatus = 'IDLE';
  private currentSequenceId: string | null = null;
  private totalCommands: number = 0;
  private processedCommands: number = 0;
  private lastError: string | undefined;
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
    private sessionManager: SessionManager,
    scheduler: SequenceScheduler
  ) {
    super();
    this.scheduler = scheduler;

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

    // Subscribe to SessionManager state changes
    this.sessionManager.on('stateChanged', (state) => {
      this.handleSessionStateChange(state);
    });

    // Load config and set initial mode
    const config = this.getConfig();
    if (config.defaultMode) {
      this.mode = config.defaultMode;
    }
  }

  /**
   * Get current director configuration from ConfigService.
   */
  private getConfig(): DirectorConfig {
    const config = configService.get('director') as any;
    return {
      defaultMode: config?.defaultMode ?? 'stopped',
      autoStartOnSessionSelect: config?.autoStartOnSessionSelect ?? false,
    };
  }

  /**
   * Update director configuration in ConfigService.
   */
  private updateConfig(updates: Partial<DirectorConfig>): void {
    const current = configService.get('director') as any;
    configService.set('director', { ...current, ...updates });
  }

  /**
   * Handle SessionManager state changes.
   * Implements mode transitions based on session selection/clearing.
   */
  private async handleSessionStateChange(state: any): Promise<void> {
    const { state: sessionState, selectedSession } = state;

    if (sessionState === 'selected' && selectedSession) {
      // Session selected
      const config = this.getConfig();
      this.currentRaceSessionId = selectedSession.raceSessionId;

      if (this.mode === 'stopped') {
        // Transition: stopped → manual or auto (based on config)
        const targetMode = config.autoStartOnSessionSelect ? 'auto' : 'manual';
        console.log(`[DirectorOrchestrator] Session selected. Transitioning: stopped → ${targetMode}`);
        await this.setMode(targetMode);
      }
    } else if (sessionState === 'none' || sessionState === 'discovered') {
      // Session cleared
      if (this.mode !== 'stopped') {
        console.log('[DirectorOrchestrator] Session cleared. Transitioning to stopped mode');
        await this.setMode('stopped');
      }
      this.currentRaceSessionId = null;
    }
  }

  /**
   * Set the director operating mode.
   * Implements FSM transitions: stopped ↔ manual ↔ auto
   */
  async setMode(newMode: DirectorMode): Promise<DirectorOrchestratorState> {
    const oldMode = this.mode;

    if (oldMode === newMode) {
      console.log(`[DirectorOrchestrator] Already in ${newMode} mode`);
      return this.getState();
    }

    console.log(`[DirectorOrchestrator] Mode transition: ${oldMode} → ${newMode}`);

    // Validate transition
    const selectedSession = this.sessionManager.getSelectedSession();
    if (newMode !== 'stopped' && !selectedSession) {
      console.warn('[DirectorOrchestrator] Cannot transition to manual/auto without selected session');
      this.lastError = 'No session selected';
      return this.getState();
    }

    // Stop CloudPoller if running (when leaving auto mode)
    if (oldMode === 'auto' && this.cloudPoller) {
      console.log('[DirectorOrchestrator] Stopping CloudPoller');
      this.cloudPoller.stop();
      this.cloudPoller = null;
    }

    // Update mode and session ID
    this.mode = newMode;
    this.lastError = undefined;

    // Set or clear session ID based on mode
    if (newMode !== 'stopped' && selectedSession) {
      this.currentRaceSessionId = selectedSession.raceSessionId;
    } else if (newMode === 'stopped') {
      this.currentRaceSessionId = null;
    }

    // Start CloudPoller if entering auto mode
    if (newMode === 'auto') {
      console.log('[DirectorOrchestrator] Starting CloudPoller');
      await this.startCloudPoller();
    }

    // Emit state change
    this.emitStateChanged();

    telemetryService.trackEvent('Director.ModeChanged', {
      oldMode,
      newMode,
      sessionId: this.currentRaceSessionId || 'none',
    });

    return this.getState();
  }

  /**
   * Start the CloudPoller for auto mode.
   */
  private async startCloudPoller(): Promise<void> {
    if (!this.currentRaceSessionId) {
      console.warn('[DirectorOrchestrator] Cannot start CloudPoller without session');
      return;
    }

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
   * Get current orchestrator state.
   */
  getState(): DirectorOrchestratorState {
    return {
      mode: this.mode,
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
   * Emit state changed event.
   */
  private emitStateChanged(): void {
    this.emit('stateChanged', this.getState());
  }

  /**
   * Handles a sequence received from CloudPoller.
   * Enqueues it in SequenceScheduler with source='director-loop'.
   */
  private async handleSequence(sequence: PortableSequence): Promise<void> {
    console.log(`[DirectorOrchestrator] Received sequence from cloud: ${sequence.id} (${sequence.steps.length} steps)`);

    // Enqueue in scheduler with director-loop source
    await this.scheduler.enqueue(sequence, {}, {
      source: 'director-loop',
      priority: sequence.priority,
    });

    // Listen for completion to notify CloudPoller
    const completionListener = (result: any) => {
      if (result.sequenceId === sequence.id) {
        console.log(`[DirectorOrchestrator] Sequence ${sequence.id} completed with status: ${result.status}`);
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
   * Clears the session in SessionManager and transitions to stopped mode.
   */
  private async handleSessionEnded(): Promise<void> {
    console.log('[DirectorOrchestrator] Session ended (410 Gone). Wrapping and stopping.');
    await this.wrapSession('session-ended').catch(() => {});
    this.sessionManager.clearSession();
    await this.setMode('stopped');
  }

  /**
   * Checks into a session with Race Control, exchanging capabilities.
   * Transitions: unchecked → checking-in → standby (or error).
   */
  async checkinSession(raceSessionId: string, options?: { forceCheckin?: boolean }): Promise<DirectorOrchestratorState> {
    if (this.checkinStatus === 'checking-in') {
      console.warn('[DirectorOrchestrator] Check-in already in progress');
      return this.getState();
    }

    console.log(`[DirectorOrchestrator] Checking into session: ${raceSessionId}`);
    this.checkinStatus = 'checking-in';
    this.lastError = undefined;

    const token = await this.authService.getAccessToken();
    if (!token) {
      this.checkinStatus = 'error';
      this.lastError = 'No auth token available';
      return this.getState();
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

        console.log(`[DirectorOrchestrator] Checked in: checkinId=${data.checkinId}, TTL=${data.checkinTtlSeconds}s`);
        if (this.checkinWarnings.length > 0) {
          console.warn('[DirectorOrchestrator] Check-in warnings:', this.checkinWarnings);
        }

        telemetryService.trackEvent('Director.CheckedIn', {
          sessionId: raceSessionId,
          checkinId: data.checkinId,
          warningCount: String(this.checkinWarnings.length),
        });

        return this.getState();
      }

      if (response.status === 409) {
        const conflict: SessionCheckinConflict = await response.json();
        this.checkinStatus = 'error';
        this.lastError = `Session in use by ${conflict.existingCheckin.displayName ?? conflict.existingCheckin.directorId}`;
        console.warn(`[DirectorOrchestrator] Check-in conflict: ${this.lastError}`);
        return this.getState();
      }

      // Other errors
      this.checkinStatus = 'error';
      this.lastError = `Check-in failed: ${response.status} ${response.statusText}`;
      console.error(`[DirectorOrchestrator] ${this.lastError}`);
      return this.getState();

    } catch (error) {
      this.checkinStatus = 'error';
      this.lastError = `Check-in error: ${(error as Error).message}`;
      console.error(`[DirectorOrchestrator] ${this.lastError}`);
      telemetryService.trackException(error as Error, { operation: 'checkinSession', sessionId: raceSessionId });
      return this.getState();
    }
  }

  /**
   * Wraps (releases) the current session check-in.
   * Transitions: any → wrapping → unchecked.
   */
  async wrapSession(reason?: string): Promise<DirectorOrchestratorState> {
    if (!this.checkinId || !this.currentRaceSessionId) {
      console.log('[DirectorOrchestrator] No active check-in to wrap');
      this.resetCheckinState();
      return this.getState();
    }

    console.log(`[DirectorOrchestrator] Wrapping session: ${this.currentRaceSessionId}`);
    this.checkinStatus = 'wrapping';

    // Stop the loop if in auto mode
    if (this.mode === 'auto') {
      await this.setMode('manual');
    }

    const token = await this.authService.getAccessToken();
    if (!token) {
      console.warn('[DirectorOrchestrator] No auth token for wrap — clearing state locally');
      this.resetCheckinState();
      return this.getState();
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
        console.log('[DirectorOrchestrator] Session wrapped successfully');
        telemetryService.trackEvent('Director.SessionWrapped', {
          sessionId: this.currentRaceSessionId!,
          reason: reason ?? 'manual',
        });
      } else {
        console.warn(`[DirectorOrchestrator] Wrap returned ${response.status} — clearing state anyway`);
      }
    } catch (error) {
      console.error('[DirectorOrchestrator] Wrap error (clearing state anyway):', error);
      telemetryService.trackException(error as Error, { operation: 'wrapSession' });
    }

    this.resetCheckinState();
    return this.getState();
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

  /**
   * Manually execute a sequence by ID.
   * Available in both manual and auto modes.
   */
  async executeSequenceById(sequenceId: string): Promise<void> {
    if (!sequenceId) return;

    console.log(`[DirectorOrchestrator] Manual execution of sequence: ${sequenceId}`);

    // Fetch sequence definition
    const token = await this.authService.getAccessToken();
    if (!token) {
      console.warn('[DirectorOrchestrator] Cannot execute sequence: No auth token.');
      return;
    }

    try {
      const url = `${apiConfig.baseUrl}${apiConfig.endpoints.getSequence(sequenceId)}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        console.error(`[DirectorOrchestrator] Failed to fetch sequence ${sequenceId}: ${response.status}`);
        return;
      }

      const sequenceData: any = await response.json();

      // Normalize API response using centralised normalizer
      const portable = normalizeApiResponse(sequenceData);

      // Enqueue via SequenceScheduler with 'manual' source
      await this.scheduler.enqueue(portable, {}, { source: 'manual' });

    } catch (err) {
      console.error(`[DirectorOrchestrator] Error executing sequence ${sequenceId}:`, err);
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
