/**
 * orchestrator.ts — Issue #106
 *
 * Wires the publisher transport and all Tier-1 detectors into the iRacing
 * extension lifecycle.
 *
 * Responsibilities:
 *   - Read publisher.* settings at start time
 *   - Instantiate PublisherTransport when publisher.enabled === true
 *   - Run all five Tier-1 detectors per telemetry frame (in dependency order)
 *   - Fire PUBLISHER_HELLO / PUBLISHER_HEARTBEAT / PUBLISHER_GOODBYE
 *   - Fire IRACING_CONNECTED / IRACING_DISCONNECTED on connection changes
 *   - Forward transport status changes to renderer via
 *     `iracing.publisherStateChanged`
 *   - Emit a per-event signal `iracing.publisherEventEmitted` for the panel's
 *     recent-events feed
 *
 * Design notes:
 *   - State (SessionState, prevFrame) is reset on SESSION_LOADED — the
 *     session-lifecycle detector fires that event and we observe it after the
 *     detector pass.
 *   - Heartbeat is a 30s timer that suppresses itself if any other event was
 *     emitted in the last second (suppression is internal to LifecycleEventDetector).
 *   - A fake `fetchFn` and `nowFn` may be injected for tests; production code
 *     uses the globals.
 */

import { PublisherTransport, type TransportStatus } from './transport';
import { LifecycleEventDetector, type LifecycleDetectorContext } from './lifecycle-event-detector';
import { detectSessionLifecycle } from './session-lifecycle-detector';
import { detectFlags } from './flag-detector';
import { detectLapCompleted } from './lap-completed-detector';
import { detectPitAndIncidents } from './pit-incident-detector';
import { detectOvertakeAndBattle } from './overtake-battle-detector';
import { detectLapPerformance } from './lap-performance-detector';
import { detectSessionTypeChange } from './session-type-detector';
import { detectPitStopDetail } from './pit-stop-detail-detector';
import { detectIncidentsAndMilestones } from './incident-stint-detector';
import { detectDriverSwapAndRoster } from './driver-swap-roster-detector';
import { detectEnvironment } from './environment-detector';
import { detectPolishFlags } from './polish-flag-detector';
import { detectPlayerPhysics } from './player-physics-detector';
import {
  createSessionState,
  buildEvent,
  carRefFromRoster,
  type SessionState,
  type TelemetryFrame,
} from './session-state';
import type { PublisherEvent, PublisherCarRef } from './event-types';

// ---------------------------------------------------------------------------
// Director interface (minimum surface needed by the orchestrator)
// ---------------------------------------------------------------------------

export interface OrchestratorDirector {
  settings: Record<string, any>;
  getAuthToken(): Promise<string | null>;
  emitEvent(event: string, payload: any): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

export interface PublisherOrchestratorConfig {
  director: OrchestratorDirector;
  /** Semver string from the extension manifest — included in PUBLISHER_HELLO */
  version: string;
  /** Test injection — defaults to global fetch */
  fetchFn?: typeof fetch;
  /** Test injection — defaults to Date.now */
  nowFn?: () => number;
}

// ---------------------------------------------------------------------------
// PublisherOrchestrator
// ---------------------------------------------------------------------------

const DEFAULT_RC_BASE_URL = 'https://simracecenter.com';
const DEFAULT_BATCH_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 30_000;

export class PublisherOrchestrator {
  private transport: PublisherTransport | null = null;
  private state: SessionState | null = null;
  private prevFrame: TelemetryFrame | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private readonly lifecycleDetector: LifecycleEventDetector;
  private readonly nowFn: () => number;

  private running = false;
  private connected = false;

  // Cached settings snapshot — read once at start()
  private publisherCode = '';
  private raceSessionId = '';

  // YAML-sourced metadata — set externally via setSessionMetadata() once the
  // iRacing extension parses session info. Empty / undefined until then.
  private playerCarIdx: number | undefined = undefined;
  private carClassByCarIdx: Map<number, number> = new Map();
  private carClassShortNames: Map<number, string> = new Map();
  private currentSessionType = '';
  private estimatedStintLaps = 0;
  /** Latest frame processed — used when building events from operator actions. */
  private lastFrame: TelemetryFrame | null = null;
  /** Per-frame roster for ROSTER_UPDATED — updated by updateRoster(). */
  private currentRoster: Map<number, PublisherCarRef> = new Map();
  /** Car numbers keyed by carIdx — populated via setSessionMetadata(). */
  private carNumberByCarIdx: Map<number, string> = new Map();
  /** Last-emitted pit road state — used to gate publisherOperatorState emissions. */
  private lastPlayerOnPitRoad = false;

  constructor(private readonly cfg: PublisherOrchestratorConfig) {
    this.nowFn = cfg.nowFn ?? Date.now;
    this.lifecycleDetector = new LifecycleEventDetector(this.nowFn);
  }

  // -------------------------------------------------------------------------
  // Public API — called from the iRacing extension index.ts
  // -------------------------------------------------------------------------

  /**
   * Called from the extension's `activate()`. Starts the publisher pipeline
   * if `publisher.enabled === true`; otherwise no-op.
   */
  activate(): void {
    if (this.cfg.director.settings['publisher.enabled'] === true) {
      this.start();
    }
  }

  /** Called from the extension's `deactivate()`. */
  deactivate(): void {
    if (this.running) {
      this.stop();
    }
  }

  /**
   * Called from the iRacing connection-state path in index.ts.
   * Fires IRACING_CONNECTED / IRACING_DISCONNECTED if the publisher is running.
   */
  onConnectionChange(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    if (this.running) {
      const events = this.lifecycleDetector.onConnectionChange(connected, this.lifecycleCtx());
      this.dispatchEvents(events);
    }
  }

  /**
   * Called from `pollTelemetry()` in index.ts on every frame.
   * Runs all five detectors and forwards their events to the transport.
   */
  onTelemetryFrame(frame: TelemetryFrame): void {
    if (!this.running) return;

    if (!this.state) {
      this.state = createSessionState(this.raceSessionId, frame.sessionUniqueId);
    }

    const ctx = { publisherCode: this.publisherCode, raceSessionId: this.raceSessionId };
    const events: PublisherEvent[] = [];

    // Order matters — session lifecycle may emit SESSION_LOADED which resets
    // state. We detect events first, then reset state at the end of the pass.
    events.push(...detectSessionLifecycle(this.prevFrame, frame, this.state, ctx));
    events.push(...detectFlags(this.prevFrame, frame, this.state, ctx));
    events.push(...detectLapCompleted(this.prevFrame, frame, this.state, ctx));
    events.push(...detectPitAndIncidents(this.prevFrame, frame, this.state, ctx));
    events.push(...detectPitStopDetail(this.prevFrame, frame, this.state, {
      ...ctx,
      playerCarIdx: this.playerCarIdx,
    }));
    events.push(...detectOvertakeAndBattle(this.prevFrame, frame, this.state, ctx));
    // Lap performance — PERSONAL_BEST_LAP requires playerCarIdx (sourced from
    // YAML; not yet wired). SESSION_BEST_LAP and STINT_BEST_LAP fire without it.
    events.push(...detectLapPerformance(this.prevFrame, frame, this.state, {
      ...ctx,
      playerCarIdx:       this.playerCarIdx,
      carClassByCarIdx:   this.carClassByCarIdx,
      carClassShortNames: this.carClassShortNames,
    }));
    // Session type change — only meaningful once orchestrator is told the
    // current SessionType from YAML. No-op until that wiring lands.
    if (this.currentSessionType !== '') {
      events.push(...detectSessionTypeChange(frame, this.state, {
        ...ctx,
        sessionType: this.currentSessionType,
      }));
    }
    events.push(...detectIncidentsAndMilestones(this.prevFrame, frame, this.state, {
      ...ctx,
      playerCarIdx:      this.playerCarIdx,
      estimatedStintLaps: this.estimatedStintLaps,
    }));
    events.push(...detectDriverSwapAndRoster(this.prevFrame, frame, this.state, {
      ...ctx,
      playerCarIdx:   this.playerCarIdx,
      currentRoster:  this.currentRoster.size > 0 ? this.currentRoster : undefined,
    }));
    events.push(...detectEnvironment(this.prevFrame, frame, this.state, ctx));
    events.push(...detectPolishFlags(this.prevFrame, frame, this.state, {
      ...ctx,
      carNumberByCarIdx: this.carNumberByCarIdx.size > 0 ? this.carNumberByCarIdx : undefined,
    }));
    events.push(...detectPlayerPhysics(this.prevFrame, frame, this.state, {
      ...ctx,
      playerCarIdx:      this.playerCarIdx,
      carNumberByCarIdx: this.carNumberByCarIdx.size > 0 ? this.carNumberByCarIdx : undefined,
    }));

    this.dispatchEvents(events);

    // Emit operator state whenever player pit-road status changes.
    const playerIdx = this.playerCarIdx ?? 0;
    const nowOnPit  = frame.carIdxOnPitRoad[playerIdx] !== 0;
    const swapPending = this.state.driverSwapPending;
    if (nowOnPit !== this.lastPlayerOnPitRoad) {
      this.lastPlayerOnPitRoad = nowOnPit;
      this.emitOperatorState(nowOnPit, swapPending);
    }

    if (events.some((e) => e.type === 'SESSION_LOADED')) {
      this.state = createSessionState(this.raceSessionId, frame.sessionUniqueId);
      this.prevFrame = null;
    } else {
      this.prevFrame = frame;
    }
    this.lastFrame = frame;
  }

  /**
   * Update YAML-sourced session metadata used by lap-performance and
   * session-type detectors. Called by the iRacing extension whenever it
   * re-parses session info YAML. Pass `undefined` for fields that are
   * unavailable.
   */
  setSessionMetadata(meta: {
    playerCarIdx?: number;
    carClassByCarIdx?: Map<number, number>;
    carClassShortNames?: Map<number, string>;
    sessionType?: string;
    estimatedStintLaps?: number;
    carNumberByCarIdx?: Map<number, string>;
  }): void {
    if (meta.playerCarIdx !== undefined)     this.playerCarIdx = meta.playerCarIdx;
    if (meta.carClassByCarIdx)               this.carClassByCarIdx = meta.carClassByCarIdx;
    if (meta.carClassShortNames)             this.carClassShortNames = meta.carClassShortNames;
    if (meta.sessionType !== undefined)      this.currentSessionType = meta.sessionType;
    if (meta.estimatedStintLaps !== undefined) this.estimatedStintLaps = meta.estimatedStintLaps;
    if (meta.carNumberByCarIdx)              this.carNumberByCarIdx = meta.carNumberByCarIdx;
  }

  /**
   * Called by the iRacing extension whenever it re-parses the SessionInfo YAML
   * and has an updated driver roster. Compares against the previous snapshot
   * and emits ROSTER_UPDATED if anything changed.
   */
  updateRoster(drivers: PublisherCarRef[]): void {
    this.currentRoster = new Map(drivers.map((d) => [d.carIdx, d]));
  }

  /**
   * Called from the `iracing.publisher.initiateDriverSwap` intent handler when
   * the operator clicks the UI button while the player car is in the pits.
   * Immediately emits DRIVER_SWAP_INITIATED and sets the pending-swap flag so
   * the next pit exit emits DRIVER_SWAP_COMPLETED.
   */
  initiateDriverSwap(outgoingDriverId: string, incomingDriverId: string, incomingDriverName: string): void {
    if (!this.running || !this.state || !this.lastFrame) return;

    this.state.driverSwapPending                = true;
    this.state.pendingSwapOutgoingDriverId       = outgoingDriverId;
    this.state.pendingSwapIncomingDriverId       = incomingDriverId;
    this.state.pendingSwapIncomingDriverName     = incomingDriverName;
    this.state.pendingSwapInitiatedSessionTime   = this.lastFrame.sessionTime;

    const playerCarIdx = this.playerCarIdx ?? 0;
    const carRef = carRefFromRoster(this.state, playerCarIdx);
    if (carRef) {
      const event = buildEvent(
        'DRIVER_SWAP_INITIATED',
        { ...carRef, driverName: outgoingDriverId },
        { outgoingDriverId, incomingDriverId, incomingDriverName },
        { raceSessionId: this.raceSessionId, publisherCode: this.publisherCode, frame: this.lastFrame },
      );
      this.dispatchEvents([event]);
    }

    this.emitOperatorState(this.lastPlayerOnPitRoad, true);
  }

  /**
   * Hot-update the raceSessionId without restarting the publisher.
   * Called from the `iracing.publisher.bindSession` intent handler once
   * the Director checks into a session and receives a confirmed raceSessionId
   * from Race Control. All subsequent events will carry the correct ID.
   */
  setRaceSessionId(raceSessionId: string): void {
    if (this.raceSessionId === raceSessionId) return;
    this.raceSessionId = raceSessionId;
    this.cfg.director.log(
      'info',
      `Publisher session bound to raceSessionId=${raceSessionId}`,
    );
  }

  /**
   * Hot-toggle the publisher without restarting the extension.
   * Called from the `iracing.publisher.setEnabled` intent handler when the
   * user flips the switch in the settings UI.
   */
  setEnabled(enabled: boolean): void {
    if (enabled && !this.running) {
      this.start();
    } else if (!enabled && this.running) {
      this.stop();
    }
  }

  /**
   * Manually advance the heartbeat detector. Production code drives this from
   * an internal 1Hz `setInterval` started in `start()`. Exposed for tests.
   */
  tickHeartbeat(): void {
    if (!this.running) return;
    const events = this.lifecycleDetector.checkHeartbeat(this.lifecycleCtx());
    this.dispatchEvents(events);
  }

  /** Test helper — true once start() has run and stop() has not. */
  get isRunning(): boolean {
    return this.running;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  private start(): void {
    if (this.running) return;

    this.publisherCode = String(this.cfg.director.settings['publisher.publisherCode'] ?? '');
    this.raceSessionId = String(this.cfg.director.settings['publisher.raceSessionId'] ?? '');
    // Derive the telemetry endpoint from the global RC API base URL.
    // app.rcApiBaseUrl is injected by the extension host from auth-config.apiConfig.baseUrl
    // (which reads VITE_API_BASE_URL at build/start time). This ensures all parts of
    // the director point at the same Race Control API without per-extension hardcoding.
    const rcBaseUrl = String(
      this.cfg.director.settings['app.rcApiBaseUrl'] ?? DEFAULT_RC_BASE_URL,
    ).replace(/\/$/, '');
    const endpointUrl = `${rcBaseUrl}/api/telemetry/events`;
    const batchIntervalMs = Number(
      this.cfg.director.settings['publisher.batchIntervalMs'] ?? DEFAULT_BATCH_INTERVAL_MS,
    );

    if (!this.publisherCode) {
      this.cfg.director.log(
        'warn',
        'Publisher started without publisher.publisherCode — events will be tagged with empty publisherCode',
      );
    }
    if (!this.raceSessionId) {
      this.cfg.director.log(
        'warn',
        'Publisher started without publisher.raceSessionId — events will be tagged with empty raceSessionId',
      );
    }

    this.transport = new PublisherTransport({
      endpointUrl,
      batchIntervalMs,
      getAuthToken: () => this.cfg.director.getAuthToken(),
      onStatusChange: (s) => this.onTransportStatus(s),
      fetchFn: this.cfg.fetchFn,
    });
    this.transport.start();
    this.running = true;

    // PUBLISHER_HELLO
    this.dispatchEvents(this.lifecycleDetector.onActivate(this.lifecycleCtx()));

    // If iRacing was already connected before we started, fire IRACING_CONNECTED
    if (this.connected) {
      this.dispatchEvents(this.lifecycleDetector.onConnectionChange(true, this.lifecycleCtx()));
    }

    // 1Hz heartbeat
    this.heartbeatTimer = setInterval(() => this.tickHeartbeat(), HEARTBEAT_INTERVAL_MS);

    this.cfg.director.log('info', 'Publisher orchestrator started');
  }

  private stop(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.transport) {
      // PUBLISHER_GOODBYE — enqueue before stopping the transport so it ships
      // in the final flush.
      this.dispatchEvents(this.lifecycleDetector.onDeactivate(this.lifecycleCtx()));
      void this.transport.stop();
      this.transport = null;
    }

    this.state = null;
    this.prevFrame = null;
    this.running = false;

    this.cfg.director.log('info', 'Publisher orchestrator stopped');
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private dispatchEvents(events: PublisherEvent[]): void {
    if (events.length === 0 || !this.transport) return;
    for (const ev of events) {
      console.log(
        `[publisher] → ${ev.type}`,
        ev.car?.carNumber ? `car#${ev.car.carNumber} (${ev.car.driverName})` : '',
        ev.payload,
      );
      this.transport.enqueue(ev);
      this.lifecycleDetector.notifyEventEmitted();
      this.cfg.director.emitEvent('iracing.publisherEventEmitted', {
        type: ev.type,
        carIdx: ev.car?.carIdx,
        timestamp: ev.timestamp,
      });
    }
  }

  private onTransportStatus(status: TransportStatus): void {
    this.cfg.director.emitEvent('iracing.publisherStateChanged', {
      ...status,
      raceSessionId: this.raceSessionId,
      publisherCode: this.publisherCode,
    });
  }

  private emitOperatorState(playerOnPitRoad: boolean, driverSwapPending: boolean): void {
    this.cfg.director.emitEvent('iracing.publisherOperatorState', {
      playerOnPitRoad,
      driverSwapPending,
    });
  }

  private lifecycleCtx(): LifecycleDetectorContext {
    return {
      publisherCode: this.publisherCode,
      raceSessionId: this.raceSessionId,
      version: this.cfg.version,
    };
  }
}
