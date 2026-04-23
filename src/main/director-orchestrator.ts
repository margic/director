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
  BattleInfo,
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
}

/**
 * DirectorOrchestrator manages the director lifecycle with a mode-based state machine.
 *
 * Modes:
 * - stopped: No session selected, no polling
 * - manual: Session selected, no auto-polling, UI can trigger manual execution
 * - auto: Session selected AND checked in, CloudPoller running, sequences executed automatically
 *
 * Transitions:
 * - stopped → manual: When session is selected
 * - manual → auto: When user clicks Start (requires active check-in)
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
  private lastRaceState: any | null = null;       // Cached iRacing RaceState
  private lastObsScene: string | null = null;      // Cached OBS current scene
  /** Gap history for developing-battle detection. Key: "carA:carB" (sorted), Value: last N gap samples. */
  private gapHistory: Map<string, number[]> = new Map();
  private static readonly GAP_HISTORY_SIZE = 5;
  /** Tracks sequence IDs sourced from the director-loop that are pending completion. */
  private pendingCloudSequenceIds: Set<string> = new Set();
  /** Single historyChanged listener for cloud sequence completion — wired once in constructor. */
  private cloudCompletionListener: ((history: any[]) => void) | null = null;

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

    if ((sessionState === 'selected' || sessionState === 'checked-in') && selectedSession) {
      // Session selected or checked in
      this.currentRaceSessionId = selectedSession.raceSessionId;

      if (this.mode === 'stopped') {
        // Always transition to manual — agent must be started explicitly via the UI
        console.log('[DirectorOrchestrator] Session selected. Transitioning: stopped → manual');
        await this.setMode('manual');
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

    // Auto mode requires an active check-in — agent cannot run without a session check-in
    if (newMode === 'auto') {
      const smState = this.sessionManager.getState();
      if (!smState.checkinId || smState.checkinStatus !== 'standby') {
        console.warn('[DirectorOrchestrator] Cannot start agent without an active session check-in');
        this.lastError = 'Session not checked in';
        return this.getState();
      }
    }

    // Stop CloudPoller if running (when leaving auto mode)
    if (oldMode === 'auto' && this.cloudPoller) {
      console.log('[DirectorOrchestrator] Stopping CloudPoller');
      this.cloudPoller.stop();
      this.cloudPoller = null;
      // Remove the single completion listener
      if (this.cloudCompletionListener) {
        this.scheduler.off('historyChanged', this.cloudCompletionListener);
        this.cloudCompletionListener = null;
      }
      this.pendingCloudSequenceIds.clear();
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

    // Wire a single completion listener on the scheduler.
    // When a director-loop sequence completes, notify CloudPoller to fetch next.
    this.pendingCloudSequenceIds.clear();
    this.cloudCompletionListener = (history: any[]) => {
      // Check each pending sequence ID against the history
      for (const seqId of this.pendingCloudSequenceIds) {
        const entry = history.find((r: any) => r.sequenceId === seqId);
        if (entry) {
          console.log(`[DirectorOrchestrator] Sequence ${seqId} completed with status: ${entry.status}`);
          this.pendingCloudSequenceIds.delete(seqId);
          if (this.cloudPoller) {
            this.cloudPoller.onSequenceCompleted(seqId);
          }
          // Only notify for the most recent completion per historyChanged event
          break;
        }
      }
    };
    this.scheduler.on('historyChanged', this.cloudCompletionListener);

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

    // Track this sequence ID so the single completion listener can notify CloudPoller
    this.pendingCloudSequenceIds.add(sequence.id);

    // Enqueue in scheduler with director-loop source
    await this.scheduler.enqueue(sequence, {}, {
      source: 'director-loop',
      priority: sequence.priority,
    });
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

    // Cache iRacing race state for race context reporting
    this.eventBus.on('iracing.raceStateChanged', (data: { extensionId: string; payload: any }) => {
      this.lastRaceState = data.payload;
    });

    // Cache OBS current scene for race context reporting
    this.eventBus.on('obs.scenes', (data: { extensionId: string; payload: any }) => {
      if (data.payload?.currentScene) {
        this.lastObsScene = data.payload.currentScene;
      }
    });

    // Handle all connection state change events
    const connectionEvents = [
      'obs.connectionStateChanged',
      'iracing.connectionStateChanged',
      'youtube.status',
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

    // Re-check-in when extensions are enabled/disabled (capabilities/intents change)
    this.eventBus!.on('extension.capabilitiesChanged', async (data: { extensionId: string; payload: any }) => {
      console.log(`[DirectorOrchestrator] Extension capabilities changed: ${data.extensionId} (enabled: ${data.payload?.enabled})`);

      const smState = this.sessionManager.getState();
      if (smState.checkinId && smState.checkinStatus === 'standby') {
        console.log('[DirectorOrchestrator] Refreshing check-in due to extension capability change');
        await this.sessionManager.refreshCheckin().catch(error => {
          console.error('[DirectorOrchestrator] Capability refresh failed:', error);
        });
      }
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
  // iRacing session flag bit constants
  private static readonly FLAG_CHECKERED = 0x0001;
  private static readonly FLAG_WHITE     = 0x0002;
  private static readonly FLAG_GREEN     = 0x0004;
  private static readonly FLAG_YELLOW    = 0x0008;
  private static readonly FLAG_RED       = 0x0010;
  private static readonly FLAG_CAUTION   = 0x4000;

  /**
   * Build a live race context snapshot from cached extension events.
   * Returns null if no iRacing telemetry is available.
   */
  private buildRaceContext(): RaceContext | null {
    if (!this.eventBus) return null;

    // Read latest cached events via the event bus listeners
    // The event bus caches aren't directly accessible — we maintain our own snapshot
    // by reading from the last emitted event data via a lightweight listener pattern.
    // For now, read from the orchestrator's own cached state.
    const raceState = this.lastRaceState;
    if (!raceState) return null;

    // Decode session flags bitfield to human-readable string
    const flags = raceState.sessionFlags ?? 0;
    let sessionFlagsStr = 'GREEN';
    if (flags & DirectorOrchestrator.FLAG_RED)       sessionFlagsStr = 'RED';
    else if (flags & DirectorOrchestrator.FLAG_YELLOW || flags & DirectorOrchestrator.FLAG_CAUTION)
                                                      sessionFlagsStr = 'YELLOW';
    else if (flags & DirectorOrchestrator.FLAG_CHECKERED) sessionFlagsStr = 'CHECKERED';
    else if (flags & DirectorOrchestrator.FLAG_WHITE)     sessionFlagsStr = 'WHITE';

    // Detect battles using track-type-aware thresholds (#77)
    const cars = raceState.cars ?? [];
    const battles = detectBattles(
      cars,
      raceState.trackType ?? '',
      this.gapHistory,
    );

    // Find focused car number
    const focusedCar = cars.find((c: any) => c.carIdx === raceState.focusedCarIdx);

    // Pit road activity
    const pitting = cars.filter((c: any) => c.onPitRoad).map((c: any) => c.carNumber);

    return {
      sessionType: raceState.sessionType ?? 'Race',
      sessionFlags: sessionFlagsStr,
      cautionType: raceState.cautionType ?? 'none',
      lapsRemain: raceState.sessionLapsRemain ?? -1,
      timeRemainSec: raceState.sessionTimeRemain != null ? Math.round(raceState.sessionTimeRemain) : -1,
      leaderLap: raceState.leaderLap ?? 0,
      totalLaps: raceState.totalSessionLaps ?? -1,
      focusedCarNumber: focusedCar?.carNumber ?? '',
      currentObsScene: this.lastObsScene ?? undefined,
      battles,
      pitting,
      carCount: cars.length,
      trackName: raceState.trackName ?? '',
      trackType: raceState.trackType ?? '',
      seriesName: raceState.seriesName ?? '',
    };
  }

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

// =============================================================================
// Battle Detection — exported for testability (#77)
// =============================================================================

const GAP_HISTORY_SIZE = 5;

/**
 * Detect battles between consecutive cars using track-type-aware thresholds.
 * Road courses use 1.5s (wider gaps); ovals use 1.0s (tighter gaps).
 * Also detects "developing battles" where the gap has been closing over
 * the last 3-5 samples, even if not yet within the active threshold.
 *
 * @param cars - Array of cars sorted by position with gapToCarAhead
 * @param trackType - Track type string from iRacing (e.g. 'road course', 'oval')
 * @param gapHistory - Mutable map tracking gap samples per pair for developing-battle detection
 */
export function detectBattles(
  cars: Array<{ carNumber: string; gapToCarAhead: number }>,
  trackType: string,
  gapHistory: Map<string, number[]>,
): BattleInfo[] {
  const isRoadCourse = trackType.toLowerCase().includes('road');
  const battleThreshold = isRoadCourse ? 1.5 : 1.0;
  const developingThreshold = battleThreshold * 2;

  const battles: BattleInfo[] = [];
  const seenPairs = new Set<string>();

  for (let i = 1; i < cars.length; i++) {
    const gap = cars[i].gapToCarAhead;
    if (gap <= 0) continue;

    const pairKey = `${cars[i - 1].carNumber}:${cars[i].carNumber}`;
    seenPairs.add(pairKey);

    // Record gap sample for developing-battle tracking
    let history = gapHistory.get(pairKey);
    if (!history) {
      history = [];
      gapHistory.set(pairKey, history);
    }
    history.push(gap);
    if (history.length > GAP_HISTORY_SIZE) {
      history.shift();
    }

    if (gap < battleThreshold) {
      battles.push({
        cars: [cars[i - 1].carNumber, cars[i].carNumber],
        gapSec: Math.round(gap * 100) / 100,
      });
    } else if (gap < developingThreshold && history.length >= 3) {
      // Developing battle — gap consistently closing over recent samples
      const isClosing = history.every((g, idx) => idx === 0 || g <= history[idx - 1]);
      if (isClosing && history[history.length - 1] < history[0]) {
        battles.push({
          cars: [cars[i - 1].carNumber, cars[i].carNumber],
          gapSec: Math.round(gap * 100) / 100,
          developing: true,
        });
      }
    }
  }

  // Prune stale gap history entries for pairs no longer consecutive
  for (const key of gapHistory.keys()) {
    if (!seenPairs.has(key)) {
      gapHistory.delete(key);
    }
  }

  return battles;
}
