/**
 * orchestrator.ts — DIR-1
 *
 * Top-level publisher orchestrator. Owns:
 *   - The single PublisherTransport instance (shared by both pipelines)
 *   - Lifecycle events (PUBLISHER_HELLO / HEARTBEAT / GOODBYE,
 *     IRACING_CONNECTED / IRACING_DISCONNECTED)
 *   - Roster cache (pushed to both sub-orchestrators)
 *   - Routing of telemetry frames to SessionPublisherOrchestrator and
 *     DriverPublisherOrchestrator
 *
 * Sub-orchestrators are constructed lazily on first activation (start()) and
 * torn down on deactivation (stop()). Neither sub-orchestrator creates its own
 * transport or sends HTTP requests — they call transport.enqueue() only.
 *
 * Single-transport invariant: exactly one PublisherTransport instance exists
 * for the lifetime of this orchestrator. Tests must assert this.
 */

import { PublisherTransport, type TransportStatus } from './transport';
import { LifecycleEventDetector, type LifecycleDetectorContext } from './shared/lifecycle-event-detector';
import { SessionPublisherOrchestrator } from './session-publisher/orchestrator';
import { DriverPublisherOrchestrator } from './driver-publisher/orchestrator';
import type { PublisherEvent, PublisherCarRef } from './event-types';
import type { TelemetryFrame } from './session-state';

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
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_RC_BASE_URL       = 'https://simracecenter.com';
const DEFAULT_BATCH_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS     = 1_000;

// ---------------------------------------------------------------------------
// PublisherOrchestrator
// ---------------------------------------------------------------------------

export class PublisherOrchestrator {
  /** Single transport instance — shared by both pipelines. Never null while running. */
  private transport: PublisherTransport | null = null;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private readonly lifecycleDetector: LifecycleEventDetector;
  private readonly nowFn: () => number;

  private running   = false;
  private connected = false;

  // Cached settings snapshot — read once at start()
  private publisherCode = '';
  private raceSessionId = '';

  // Roster — owned here, pushed to both sub-orchestrators on update (S5)
  private currentRoster: Map<number, PublisherCarRef> = new Map();

  // Sub-orchestrators — constructed lazily at start(), torn down at stop()
  private sessionPublisher: SessionPublisherOrchestrator | null = null;
  private driverPublisher:  DriverPublisherOrchestrator  | null = null;

  constructor(private readonly cfg: PublisherOrchestratorConfig) {
    this.nowFn = cfg.nowFn ?? Date.now;
    this.lifecycleDetector = new LifecycleEventDetector(this.nowFn);
  }

  // -------------------------------------------------------------------------
  // Public API — called from the iRacing extension index.ts
  // -------------------------------------------------------------------------

  /**
   * Called from the extension's activate(). Starts the publisher pipeline
   * if publisher.enabled === true; otherwise no-op.
   */
  activate(): void {
    if (this.cfg.director.settings['publisher.enabled'] === true) {
      this.start();
    }
  }

  /** Called from the extension's deactivate(). */
  deactivate(): void {
    if (this.running) {
      this.stop();
    }
  }

  /**
   * Called from the iRacing connection-state path in index.ts.
   * Fires IRACING_CONNECTED / IRACING_DISCONNECTED when the publisher is running.
   */
  onConnectionChange(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    if (this.running) {
      const events = this.lifecycleDetector.onConnectionChange(connected, this.lifecycleCtx());
      this.dispatchLifecycleEvents(events);
    }
  }

  /**
   * Called from pollTelemetry() in index.ts on every frame.
   * Routes to active sub-orchestrators.
   */
  onTelemetryFrame(frame: TelemetryFrame): void {
    if (!this.running) return;
    this.sessionPublisher?.onTelemetryFrame(frame);
    this.driverPublisher?.onTelemetryFrame(frame);
  }

  /**
   * Update YAML-sourced session metadata. Distributes relevant fields to each
   * sub-orchestrator based on their domain.
   */
  setSessionMetadata(meta: {
    playerCarIdx?: number;
    carClassByCarIdx?: Map<number, number>;
    carClassShortNames?: Map<number, string>;
    sessionType?: string;
    estimatedStintLaps?: number;
    carNumberByCarIdx?: Map<number, string>;
    iracingUserName?: string;
    identityDisplayName?: string;
  }): void {
    this.sessionPublisher?.setSessionMetadata({
      playerCarIdx:       meta.playerCarIdx,
      carClassByCarIdx:   meta.carClassByCarIdx,
      carClassShortNames: meta.carClassShortNames,
      sessionType:        meta.sessionType,
      carNumberByCarIdx:  meta.carNumberByCarIdx,
    });

    this.driverPublisher?.setSessionMetadata({
      playerCarIdx:        meta.playerCarIdx,
      estimatedStintLaps:  meta.estimatedStintLaps,
      carNumberByCarIdx:   meta.carNumberByCarIdx,
      iracingUserName:     meta.iracingUserName,
      identityDisplayName: meta.identityDisplayName,
    });
  }

  /**
   * Called by the iRacing extension whenever it re-parses the SessionInfo YAML
   * and has an updated driver roster. Roster is owned here and pushed to both
   * sub-orchestrators (S5 — one roster cache, not two).
   */
  updateRoster(drivers: PublisherCarRef[]): void {
    this.currentRoster = new Map(drivers.map((d) => [d.carIdx, d]));
    this.sessionPublisher?.updateRoster(drivers);
    this.driverPublisher?.updateRoster(drivers);
  }

  /**
   * Called from the iracing.publisher.initiateDriverSwap intent handler.
   * Delegates to the driver publisher.
   */
  initiateDriverSwap(outgoingDriverId: string, incomingDriverId: string, incomingDriverName: string): void {
    this.driverPublisher?.initiateDriverSwap(outgoingDriverId, incomingDriverId, incomingDriverName);
  }

  /**
   * Hot-update the raceSessionId. Discards cross-session events from the
   * transport queue and notifies both sub-orchestrators to reset their state.
   */
  setRaceSessionId(raceSessionId: string): void {
    if (this.raceSessionId === raceSessionId) return;
    this.raceSessionId = raceSessionId;

    // Discard any pending events from the previous session.
    this.transport?.clearQueue();

    // Re-activate both sub-orchestrators so they reset their detector caches
    // and carry the new raceSessionId on all subsequent events.
    if (this.sessionPublisher?.isActive) {
      this.sessionPublisher.activate(raceSessionId, this.publisherCode);
    }
    if (this.driverPublisher?.isActive) {
      this.driverPublisher.activate(raceSessionId, this.publisherCode);
    }

    this.cfg.director.log('info', `Publisher session bound to raceSessionId=${raceSessionId}`);
  }

  /**
   * Hot-toggle the publisher without restarting the extension.
   * Called from the iracing.publisher.setEnabled intent handler.
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
   * a 1Hz setInterval started in start(). Exposed for tests.
   */
  tickHeartbeat(): void {
    if (!this.running) return;
    const events = this.lifecycleDetector.checkHeartbeat(this.lifecycleCtx());
    this.dispatchLifecycleEvents(events);
  }

  /** True when either pipeline is active (S4 — used to set telemetry poll rate). */
  get isAnyPipelineActive(): boolean {
    return (this.sessionPublisher?.isActive ?? false) || (this.driverPublisher?.isActive ?? false);
  }

  /** True once start() has run and stop() has not. */
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

    const rcBaseUrl = String(
      this.cfg.director.settings['app.rcApiBaseUrl'] ?? DEFAULT_RC_BASE_URL,
    ).replace(/\/$/, '');
    const endpointUrl     = `${rcBaseUrl}/api/telemetry/events`;
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

    // Single transport — shared by both sub-orchestrators (hard architectural constraint).
    this.transport = new PublisherTransport({
      endpointUrl,
      batchIntervalMs,
      getAuthToken:   () => this.cfg.director.getAuthToken(),
      onStatusChange: (s) => this.onTransportStatus(s),
      fetchFn:        this.cfg.fetchFn,
    });
    this.transport.start();

    const emitEvent = (event: string, payload: any) =>
      this.cfg.director.emitEvent(event, payload);
    const log = (level: 'info' | 'warn' | 'error', msg: string) =>
      this.cfg.director.log(level, msg);

    // Lazy construction of sub-orchestrators.
    this.sessionPublisher = new SessionPublisherOrchestrator({
      transport: this.transport,
      emitEvent,
      log,
    });
    this.driverPublisher = new DriverPublisherOrchestrator({
      transport: this.transport,
      emitEvent,
      log,
    });

    this.sessionPublisher.activate(this.raceSessionId, this.publisherCode);
    this.driverPublisher.activate(this.raceSessionId, this.publisherCode);

    // Seed the roster into both pipelines if it was set before start().
    if (this.currentRoster.size > 0) {
      const drivers = Array.from(this.currentRoster.values());
      this.sessionPublisher.updateRoster(drivers);
      this.driverPublisher.updateRoster(drivers);
    }

    this.running = true;

    // PUBLISHER_HELLO
    this.dispatchLifecycleEvents(this.lifecycleDetector.onActivate(this.lifecycleCtx()));

    // If iRacing was already connected before we started, fire IRACING_CONNECTED.
    if (this.connected) {
      this.dispatchLifecycleEvents(
        this.lifecycleDetector.onConnectionChange(true, this.lifecycleCtx()),
      );
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

    // Deactivate sub-orchestrators so they stop processing frames.
    this.sessionPublisher?.deactivate();
    this.driverPublisher?.deactivate();
    this.sessionPublisher = null;
    this.driverPublisher  = null;

    if (this.transport) {
      // PUBLISHER_GOODBYE — enqueue before stopping so it ships in the final flush.
      this.dispatchLifecycleEvents(this.lifecycleDetector.onDeactivate(this.lifecycleCtx()));
      void this.transport.stop();
      this.transport = null;
    }

    this.running = false;
    this.cfg.director.log('info', 'Publisher orchestrator stopped');
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /**
   * Dispatch lifecycle events directly through the transport, bypassing
   * sub-orchestrators — lifecycle events are a top-level concern (S1).
   */
  private dispatchLifecycleEvents(events: PublisherEvent[]): void {
    if (events.length === 0 || !this.transport) return;
    for (const ev of events) {
      this.transport.enqueue(ev);
      this.lifecycleDetector.notifyEventEmitted();
      this.cfg.director.emitEvent('iracing.publisherEventEmitted', {
        type:      ev.type,
        carIdx:    ev.car?.carIdx,
        timestamp: ev.timestamp,
        pipeline:  'top-level',
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

  private lifecycleCtx(): LifecycleDetectorContext {
    return {
      publisherCode: this.publisherCode,
      raceSessionId: this.raceSessionId,
      version:       this.cfg.version,
    };
  }
}
