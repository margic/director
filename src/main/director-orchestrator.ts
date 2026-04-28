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
  DirectorStatus,
  PortableSequence,
  CheckinStatus,
  SessionOperationalConfig,
  RaceContext,
} from './director-types';
import { SequenceScheduler } from './sequence-scheduler';
import { CloudPoller } from './cloud-poller';
import { normalizeApiResponse } from './normalizer';
import { apiConfig } from './auth-config';
import { telemetryService } from './telemetry-service';
import { ExtensionHostService } from './extension-host/extension-host';
import { ExtensionEventBus } from './extension-host/event-bus';
import { configService } from './config-service';
import { SessionManager } from './session-manager';
import { SequenceLibraryService } from './sequence-library-service';
import { RaceAnalyzer } from './race-analyzer';

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
  /** Last known iRacing state snapshot, updated from iracing.raceStateChanged events. */
  private lastIRacingState: any = null;
  /** Synthesizes higher-order narrative events from raw race state history. */
  private readonly raceAnalyzer = new RaceAnalyzer();

  constructor(
    private authService: AuthService,
    private extensionHost: ExtensionHostService,
    private sessionManager: SessionManager,
    scheduler: SequenceScheduler,
    private eventBus?: ExtensionEventBus,
    private sequenceLibrary?: SequenceLibraryService
  ) {
    super();
    this.scheduler = scheduler;

    // Subscribe to scheduler progress events
    this.scheduler.on('progress', (progress) => {
      // Trigger pre-fetch when sequence starts (if estimated duration is known)
      if (progress.stepIntent === 'sequence.start' && this.cloudPoller) {
        const seq = this.scheduler.getExecutingSequence(progress.sequenceId);
        const estimatedDurationMs = seq?.metadata?.['totalDurationMs'] as number | undefined;
        this.cloudPoller.onSequenceStarted(progress.sequenceId, estimatedDurationMs);
      }

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

    // Subscribe to extension connection state changes for re-check-in
    if (this.eventBus) {
      this.listenForConnectionEvents();

      // Cache latest iRacing state for raceContext in sequences/next POST body
      this.eventBus.on('iracing.raceStateChanged', (data: { payload: any }) => {
        this.lastIRacingState = data.payload;
        this.raceAnalyzer.update(data.payload);
      });
    }

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
   * Returns the current race context snapshot for external consumers (e.g. SessionManager checkin).
   * Returns null if iRacing has never connected and no state is available.
   */
  public getRaceContext(): RaceContext | null {
    if (!this.lastIRacingState) return null;
    return this.buildRaceContext();
  }

  /**
   * Build a RaceContext snapshot from the last known iRacing state.
   * Used as the required body for POST .../sequences/next.
   */
  private buildRaceContext(): RaceContext {
    const state = this.lastIRacingState;

    if (!state) {
      return {
        sessionType: 'Race',
        sessionFlags: 'disconnected',
        lapsRemain: -1,
        carCount: 0,
        contextTimestamp: new Date().toISOString(),
      };
    }

    // Decode iRacing SessionFlags bitmask → RC flag string
    const flagBits: number = state.sessionFlags ?? 0;
    const FLAG_RED     = 0x0010;
    const FLAG_YELLOW  = 0x0008;
    const FLAG_CAUTION = 0x4000;
    let sessionFlags = 'green';
    if (flagBits & FLAG_RED) sessionFlags = 'red';
    else if ((flagBits & FLAG_CAUTION) || (flagBits & FLAG_YELLOW)) sessionFlags = 'caution';

    // Infer session type: Race sessions have a fixed lap count; others are unlimited
    const totalLaps: number = state.totalSessionLaps ?? 0;
    const sessionType = totalLaps > 0 ? 'Race' : 'Practice';

    // iRacing returns 32767 for unlimited laps — normalize to -1
    const rawLapsRemain: number = state.sessionLapsRemain ?? -1;
    const lapsRemain = rawLapsRemain > 32000 ? -1 : rawLapsRemain;

    const carCount: number = Array.isArray(state.cars) ? state.cars.length : 0;
    const timeRemain: number = state.sessionTimeRemain ?? -1;

    // Build per-driver context (focused cars only — top 20 to avoid oversized payload)
    const cars: any[] = Array.isArray(state.cars) ? state.cars.slice(0, 20) : [];
    const drivers = cars.length > 0
      ? cars.map((c: any) => ({
          carNumber: String(c.carNumber ?? ''),
          gapToAhead: c.gapToCarAhead ?? 0,
          lapsCompleted: c.lapsCompleted ?? 0,
          bestLap: c.bestLapTime ?? 0,
          classPosition: c.classPosition ?? 0,
          pos: c.position > 0 ? c.position : undefined,
          driverName: c.driverName || undefined,
          carClass: c.carClass || undefined,
          isOnTrack: typeof c.onPitRoad === 'boolean' ? !c.onPitRoad : undefined,
          lastLap: c.lastLapTime > 0 ? c.lastLapTime : undefined,
        }))
      : undefined;

    // Pitting cars
    const pitting = cars
      .filter((c: any) => c.onPitRoad)
      .map((c: any) => String(c.carNumber ?? ''));

    // Active battles: pairs of cars within 1.0s of each other
    const battles: Array<{ cars: string[]; gapSec: number }> = [];
    for (let i = 1; i < cars.length; i++) {
      const gap = cars[i].gapToCarAhead ?? 0;
      if (gap > 0 && gap < 1.0) {
        battles.push({
          cars: [String(cars[i - 1].carNumber ?? ''), String(cars[i].carNumber ?? '')],
          gapSec: Math.round(gap * 1000) / 1000,
        });
      }
    }

    // Focused car
    const focusedIdx: number = state.focusedCarIdx ?? -1;
    const focusedCar = focusedIdx >= 0 ? cars.find((c: any) => c.carIdx === focusedIdx) : null;

    // Synthesized narrative events since last request
    const recentEvents = this.raceAnalyzer.consumeEvents();

    // Stint laps for the focused driver
    const focusedCarNum = focusedCar ? String(focusedCar.carNumber) : null;
    const stintLaps = focusedCarNum
      ? this.raceAnalyzer.getStintLaps(focusedCarNum, focusedCar?.lapsCompleted ?? 0) ?? undefined
      : undefined;

    return {
      sessionType,
      sessionFlags,
      lapsRemain,
      carCount,
      contextTimestamp: new Date().toISOString(),
      ...(timeRemain > 0 ? { timeRemainSec: Math.round(timeRemain) } : {}),
      ...(state.leaderLap > 0 ? { leaderLap: state.leaderLap } : {}),
      ...(totalLaps > 0 ? { totalLaps } : {}),
      ...(state.trackName ? { trackName: state.trackName } : {}),
      ...(focusedCar ? { focusedCarNumber: String(focusedCar.carNumber) } : {}),
      ...(pitting.length > 0 ? { pitting } : {}),
      ...(battles.length > 0 ? { battles } : {}),
      ...(drivers ? { drivers } : {}),
      ...(recentEvents.length > 0 ? { recentEvents } : {}),
      ...(stintLaps !== undefined ? { stintLaps } : {}),
    };
  }

  /**
   * Handle SessionManager state changes.
   * Implements mode transitions based on session selection/clearing.
   */
  private async handleSessionStateChange(state: any): Promise<void> {
    const { state: sessionState, selectedSession } = state;

    if ((sessionState === 'selected' || sessionState === 'checked-in') && selectedSession) {
      // Session selected or checked in
      this.currentRaceSessionId = selectedSession.raceSessionId;

      // Bind the confirmed raceSessionId to the publisher so telemetry events
      // are tagged correctly (fix for issue #109 — empty raceSessionId).
      // Uses executeInternalDirective (not executeIntent) so this lifecycle
      // call is never exposed as a broadcast capability to the RC AI planner.
      if (sessionState === 'checked-in') {
        this.extensionHost.executeInternalDirective('iracing.publisher.bindSession', {
          raceSessionId: selectedSession.raceSessionId,
        });
      }

      if (this.mode === 'stopped') {
        // Session selected while stopped — auto-transition to manual or auto
        // depending on the autoStartOnSessionSelect config.
        const config = this.getConfig();
        const targetMode = config.autoStartOnSessionSelect ? 'auto' : 'manual';
        console.log(`[DirectorOrchestrator] Session selected — transitioning to ${targetMode}`);
        await this.setMode(targetMode);
      } else {
        // Session state changed while already in manual/auto — update CloudPoller if needed
        if (sessionState === 'checked-in' && this.cloudPoller) {
          const checkinId = this.sessionManager.getCheckinId();
          const ttl = this.sessionManager.getCheckinTtlSeconds();
          if (checkinId) {
            this.cloudPoller.updateCheckin(checkinId, ttl);
          }
        }
        // Emit state change so renderer sees updated checkin status
        this.emitStateChanged();
      }
    } else if (sessionState === 'none' || sessionState === 'discovered') {
      // Session cleared
      if (this.mode !== 'stopped') {
        console.log('[DirectorOrchestrator] Session cleared. Transitioning to stopped mode');
        await this.setMode('stopped');
      }
      this.currentRaceSessionId = null;
      this.raceAnalyzer.reset();
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

    // Auto mode additionally requires an active check-in.
    if (newMode === 'auto' && !this.sessionManager.getCheckinId()) {
      console.warn('[DirectorOrchestrator] Cannot transition to auto without active check-in');
      this.lastError = 'Session not checked in';
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

    // Always reflect SessionManager's selected session
    const currentSelected = this.sessionManager.getSelectedSession();
    this.currentRaceSessionId = currentSelected?.raceSessionId ?? null;

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

    // Use server-provided timing config if available from session check-in
    const sessionConfig = this.sessionManager.getSessionConfig();
    const idleRetryMs = sessionConfig?.timingConfig?.idleRetryIntervalMs ?? 5000;
    const checkinId = this.sessionManager.getCheckinId();
    const checkinTtlSeconds = this.sessionManager.getCheckinTtlSeconds();

    this.cloudPoller = new CloudPoller(
      this.authService,
      this.currentRaceSessionId,
      {
        idleRetryMs,
        getActiveIntents: () => this.getActiveIntents(),
        getRaceContext: () => this.buildRaceContext(),
        onSequence: (sequence) => this.handleSequence(sequence),
        onSessionEnded: () => this.handleSessionEnded(),
        checkinId: checkinId || undefined,
        checkinTtlSeconds,
      }
    );

    this.cloudPoller.start();
  }

  /**
   * Get current orchestrator state.
   */
  getState(): DirectorOrchestratorState {
    // sessionId always reflects SessionManager's selected session
    const selected = this.sessionManager.getSelectedSession();
    const smState = this.sessionManager.getState();
    return {
      mode: this.mode,
      status: this.status,
      sessionId: selected?.raceSessionId ?? this.currentRaceSessionId,
      currentSequenceId: this.currentSequenceId,
      totalCommands: this.totalCommands,
      processedCommands: this.processedCommands,
      lastError: this.lastError,
      checkinStatus: smState.checkinStatus,
      checkinId: smState.checkinId,
      sessionConfig: smState.sessionConfig,
      checkinWarnings: smState.checkinWarnings,
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
    // historyChanged emits the full history array, so find the matching entry
    const completionListener = (history: any[]) => {
      const entry = history.find((r: any) => r.sequenceId === sequence.id);
      if (entry) {
        console.log(`[DirectorOrchestrator] Sequence ${sequence.id} completed with status: ${entry.status}`);
        if (this.cloudPoller && this.mode === 'auto') {
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
    await this.sessionManager.wrapSession('session-ended').catch(() => {});
    await this.sessionManager.clearSession();
    await this.setMode('stopped');
  }

  /**
   * Delegates check-in to SessionManager.
   * @deprecated Use sessionManager.checkinSession() directly via session:checkin IPC.
   */
  async checkinSession(raceSessionId: string, options?: { forceCheckin?: boolean }): Promise<DirectorOrchestratorState> {
    await this.sessionManager.checkinSession(options);
    return this.getState();
  }

  /**
   * Delegates refresh to SessionManager.
   */
  async refreshCheckin(): Promise<DirectorOrchestratorState> {
    await this.sessionManager.refreshCheckin();
    return this.getState();
  }

  /**
   * Delegates wrap to SessionManager.
   * @deprecated Use sessionManager.wrapSession() directly via session:wrap IPC.
   */
  async wrapSession(reason?: string): Promise<DirectorOrchestratorState> {
    // Stop the loop if in auto mode
    if (this.mode === 'auto') {
      await this.setMode('manual');
    }
    await this.sessionManager.wrapSession(reason);
    return this.getState();
  }

  /**
   * Listen for extension connection state changes and trigger re-check-in.
   * This ensures Race Control gets updated capabilities when extensions connect/disconnect.
   */
  private listenForConnectionEvents(): void {
    if (!this.eventBus) return;

    // Handle all connection state change events
    const connectionEvents = [
      'obs.connectionStateChanged',
      'iracing.connectionStateChanged',
      'youtube.status',
      'extension.capabilitiesChanged',
    ];

    connectionEvents.forEach(eventName => {
      this.eventBus!.on(eventName, async (data: { extensionId: string; payload: any }) => {
        console.log(`[DirectorOrchestrator] Connection event: ${eventName} from ${data.extensionId}`);

        // Only refresh if we're currently checked in (delegate to SessionManager)
        const smState = this.sessionManager.getState();
        if (smState.checkinId && smState.checkinStatus === 'standby') {
          console.log('[DirectorOrchestrator] Refreshing check-in due to connection state change');
          await this.sessionManager.refreshCheckin().catch(error => {
            console.error('[DirectorOrchestrator] Capability refresh failed:', error);
          });
        }
      });
    });
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
      // #112: only include broadcast intents — exclude operational/query from sequence generation
      const activeExtIntents = allIntents
        .filter(entry => entry.enabled && (entry.intent.category ?? 'broadcast') === 'broadcast')
        .map(entry => entry.intent.intent);
      return [...builtIns, ...activeExtIntents];
    } catch {
      return builtIns;
    }
  }
}
