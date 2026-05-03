/**
 * orchestrator.ts — DIR-3
 *
 * Top-level publisher orchestrator. Owns:
 *   - The single PublisherTransport instance (shared by both pipelines)
 *   - Lifecycle events (PUBLISHER_HELLO / HEARTBEAT / GOODBYE,
 *     IRACING_CONNECTED / IRACING_DISCONNECTED)
 *   - Roster cache (pushed to both sub-orchestrators on update — S5)
 *   - Routing of telemetry frames to SessionPublisherOrchestrator and
 *     DriverPublisherOrchestrator
 *   - Session bind / release lifecycle (DIR-2)
 *   - Config migration of legacy keys on startup (DIR-2+3 / S3)
 *   - Auto-generated rigId (DIR-3)
 *
 * Activation model (DIR-2/3):
 *   - activate()         → starts transport, heartbeat, lifecycle infra;
 *                          generates rigId if absent.
 *                          Does NOT start either sub-pipeline on its own.
 *   - bindSession(id)    → starts Session Publisher pipeline. If
 *                          publisher.driver.enabled is true, also starts
 *                          the Driver Publisher. If iRacing is not yet
 *                          connected, the id is "armed" and the pipelines
 *                          start automatically when the connection arrives.
 *   - releaseSession()   → stops both pipelines, sends PUBLISHER_GOODBYE,
 *                          flushes remaining events. Transport stays live.
 *   - registerDriver(id) → Driver-only rig flow: calls the Race Control
 *                          register endpoint and activates the Driver
 *                          Publisher on success.
 *   - deactivate()       → stops everything (both pipelines + transport).
 *
 * Single-transport invariant: exactly one PublisherTransport instance exists
 * for the lifetime of this orchestrator. Tests must assert this.
 */

import { randomUUID } from 'crypto';
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
  /** Persist a settings change (used for config migration). Optional — no-op if absent. */
  saveSetting?(key: string, value: any): void;
  /** Delete a persisted setting (used for config migration). Optional — no-op if absent. */
  deleteSetting?(key: string): void;
}

export interface PublisherOrchestratorConfig {
  director: OrchestratorDirector;
  /** Semver string from the extension manifest — included in PUBLISHER_HELLO */
  version: string;
  /** Test injection — defaults to global fetch */
  fetchFn?: typeof fetch;
  /** Test injection — defaults to Date.now */
  nowFn?: () => number;
  /** Test injection — defaults to crypto.randomUUID */
  uuidFn?: () => string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_RC_BASE_URL       = 'https://simracecenter.com';
const DEFAULT_BATCH_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS     = 1_000;

/** Legacy config keys removed in DIR-2 and DIR-3 (S3 migration). */
const LEGACY_KEYS = [
  'publisher.enabled',
  'publisher.publisherCode',
  'publisher.raceSessionId',
  'publisher.identityDisplayName',
] as const;

// ---------------------------------------------------------------------------
// PublisherOrchestrator
// ---------------------------------------------------------------------------

export class PublisherOrchestrator {
  /** Single transport instance — shared by both pipelines. Non-null while running. */
  private transport: PublisherTransport | null = null;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private readonly lifecycleDetector: LifecycleEventDetector;
  private readonly nowFn: () => number;

  /** True once startInfrastructure() has run and stop() has not. */
  private running = false;

  /** Whether iRacing is currently connected. */
  private connected = false;

  /**
   * raceSessionId set by the most recent successful bindSession() call.
   * Empty string means no session is bound.
   */
  private raceSessionId = '';

  /**
   * rigId — auto-generated UUID stored in publisher.rigId config on first launch.
   * Never user-visible beyond a read-only display. Tags every outbound event.
   */
  private rigId = '';

  /**
   * "Armed" session id: set when bindSession() fires before iRacing is
   * connected. Cleared and activated when onConnectionChange(true) fires.
   */
  private armedSessionId: string | null = null;

  // Roster — owned here, pushed to both sub-orchestrators on update (S5)
  private currentRoster: Map<number, PublisherCarRef> = new Map();

  // Sub-orchestrators — constructed in startInfrastructure(), never null while running
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
   * Called from the extension's activate(). Performs S3 config migration then
   * starts the transport infrastructure. Does NOT activate either pipeline —
   * the Session Publisher starts via bindSession(); the Driver Publisher starts
   * via DIR-3 opt-in.
   */
  activate(): void {
    this.migrateConfig();
    this.startInfrastructure();
  }

  /** Called from the extension's deactivate(). Stops everything. */
  deactivate(): void {
    if (this.running) {
      this.stopAll();
    }
  }

  /**
   * Called from the internal `iracing.publisher.bindSession` intent handler.
   * Starts (or rebinds) the Session Publisher pipeline. If
   * publisher.driver.enabled is true, also starts the Driver Publisher.
   *
   * Pass null or empty string to release the session (identical semantics to
   * releaseSession()).
   */
  bindSession(raceSessionId: string | null): void {
    if (!raceSessionId) {
      this.releaseSession();
      return;
    }

    if (this.raceSessionId === raceSessionId) return;

    // Clear any previous session data from the queue before rebinding.
    if (this.raceSessionId !== '') {
      this.transport?.clearQueue();
    }

    this.raceSessionId = raceSessionId;

    if (!this.running) return; // infrastructure not up yet; will activate on connect

    if (this.connected) {
      this.startSessionPipeline();
    } else {
      // Arm for auto-start when iRacing connects.
      this.armedSessionId = raceSessionId;
      this.cfg.director.log('info', `Publisher armed — will start when iRacing connects (raceSessionId=${raceSessionId})`);
    }
  }

  /**
   * Called from the internal `iracing.publisher.releaseSession` intent handler,
   * or by SessionManager on check-out / session expiry.
   *
   * Stops the Session Publisher, sends PUBLISHER_GOODBYE, and flushes the
   * transport. The transport itself stays live (Driver Publisher may still be
   * active after DIR-3).
   */
  releaseSession(): void {
    this.armedSessionId = null;
    if (!this.sessionPublisher?.isActive && !this.driverPublisher?.isActive) return;

    // PUBLISHER_GOODBYE — enqueue before flush so it ships in the final batch.
    this.dispatchLifecycleEvents(this.lifecycleDetector.onDeactivate(this.lifecycleCtx()));

    this.sessionPublisher?.deactivate();
    this.driverPublisher?.deactivate();

    // Flush remaining events asynchronously. The transport stays live.
    if (this.transport) {
      void this.transport.flush();
    }

    this.raceSessionId = '';
    this.cfg.director.log('info', 'Publisher session released');
  }

  /**
   * Hot-toggle the Session Publisher pipeline.
   * Persists the setting and immediately starts/stops the pipeline if a
   * session is bound and iRacing is connected.
   */
  setSessionEnabled(enabled: boolean): void {
    this.cfg.director.saveSetting?.('publisher.session.enabled', enabled);

    if (!enabled) {
      if (this.sessionPublisher?.isActive) {
        this.sessionPublisher.deactivate();
      }
    } else {
      // Start immediately if infrastructure is up, connected, and a session is bound.
      if (this.running && this.connected && this.raceSessionId && this.sessionPublisher && !this.sessionPublisher.isActive) {
        this.sessionPublisher.activate(this.raceSessionId, this.rigId);
        if (this.currentRoster.size > 0) {
          this.sessionPublisher.updateRoster(Array.from(this.currentRoster.values()));
        }
      }
    }
  }

  /**
   * Called from the iRacing connection-state path in index.ts.
   * Always fires IRACING_CONNECTED / IRACING_DISCONNECTED when the transport
   * is live. On connect, triggers any armed session pipeline.
   */
  onConnectionChange(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    if (this.running) {
      const events = this.lifecycleDetector.onConnectionChange(connected, this.lifecycleCtx());
      this.dispatchLifecycleEvents(events);
    }
    if (connected && this.armedSessionId !== null) {
      this.raceSessionId = this.armedSessionId;
      this.armedSessionId = null;
      this.startSessionPipeline();
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
   * Driver-only rig registration flow (DIR-3).
   *
   * Calls POST /api/publisher/sessions/{raceSessionId}/register and activates
   * the Driver Publisher on success. Emits iracing.publisher.registerDriverResult
   * with the outcome.
   *
   * For Director Loop rigs the driver publisher starts automatically via
   * bindSession() when publisher.driver.enabled is true — no register call
   * is needed or made.
   */
  async registerDriver(raceSessionId: string): Promise<void> {
    if (!this.running) {
      this.cfg.director.log('warn', 'registerDriver called before activate()');
      return;
    }

    const token = await this.cfg.director.getAuthToken();
    if (!token) {
      const msg = 'Not authenticated — sign in first';
      this.cfg.director.log('warn', `DriverPublisher register skipped: ${msg}`);
      this.cfg.director.emitEvent('iracing.publisher.registerDriverResult', {
        success: false, errorCode: 401, message: msg, raceSessionId,
      });
      return;
    }

    const driverName = (
      String(this.cfg.director.settings['publisher.driver.displayName'] ?? '').trim() ||
      String(this.cfg.director.settings['iracing.userName'] ?? '').trim() ||
      'Unknown Driver'
    );

    const rcBaseUrl = String(
      this.cfg.director.settings['app.rcApiBaseUrl'] ?? DEFAULT_RC_BASE_URL,
    ).replace(/\/$/, '');
    const url = `${rcBaseUrl}/api/publisher/sessions/${encodeURIComponent(raceSessionId)}/register`;
    const fetchFn = this.cfg.fetchFn ?? fetch;

    try {
      const resp = await fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rigId: this.rigId, driverName }),
      });

      if (resp.status === 200) {
        this.cfg.director.saveSetting?.('publisher.driver.sessionId', raceSessionId);
        this.driverPublisher?.activate(raceSessionId, this.rigId);
        if (this.currentRoster.size > 0) {
          this.driverPublisher?.updateRoster(Array.from(this.currentRoster.values()));
        }
        // Fire PUBLISHER_HELLO for lifecycle tracking if no session pipeline is active.
        if (!this.sessionPublisher?.isActive) {
          this.raceSessionId = raceSessionId;
          this.dispatchLifecycleEvents(this.lifecycleDetector.onActivate(this.lifecycleCtx()));
        }
        this.cfg.director.log('info', `DriverPublisher registered for raceSessionId=${raceSessionId}`);
        this.cfg.director.emitEvent('iracing.publisher.registerDriverResult', {
          success: true, raceSessionId,
        });
        return;
      }

      const body: any = await resp.json().catch(() => ({}));
      let message: string;
      switch (resp.status) {
        case 400: message = 'Registration failed — missing or invalid fields'; break;
        case 401: message = 'Not authenticated — sign in first'; break;
        case 404: message = 'Session ID not found — check the ID and try again'; break;
        case 409: {
          const sessionStatus = (body as any)?.status ?? 'unknown';
          message = `Session not accepting registrations (status: ${sessionStatus})`;
          break;
        }
        default: message = `Server error (${resp.status}) — please retry`;
      }
      this.cfg.director.log('warn', `DriverPublisher register failed (${resp.status}): ${message}`);
      this.cfg.director.emitEvent('iracing.publisher.registerDriverResult', {
        success: false, errorCode: resp.status, message, raceSessionId,
      });
    } catch (err: any) {
      const message = `Network error: ${(err as Error)?.message ?? 'unknown'}`;
      this.cfg.director.log('error', `DriverPublisher register error: ${message}`);
      this.cfg.director.emitEvent('iracing.publisher.registerDriverResult', {
        success: false, message, raceSessionId,
      });
    }
  }

  /**
   * Manually advance the heartbeat detector. Production code drives this from
   * a 1Hz setInterval started in startInfrastructure(). Exposed for tests.
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

  /** True once startInfrastructure() has run and stopAll() has not. */
  get isRunning(): boolean {
    return this.running;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * S3 config migration — runs once at startup.
   * Drops legacy keys and migrates identityDisplayName if the new key is unset.
   */
  private migrateConfig(): void {
    const settings = this.cfg.director.settings;
    const legacyDisplayName = settings['publisher.identityDisplayName'];
    if (legacyDisplayName !== undefined) {
      if (!settings['publisher.driver.displayName']) {
        this.cfg.director.saveSetting?.('publisher.driver.displayName', legacyDisplayName);
      }
    }
    for (const key of LEGACY_KEYS) {
      if (settings[key] !== undefined) {
        this.cfg.director.deleteSetting?.(key);
        this.cfg.director.log('info', `Publisher config migration: removed legacy key '${key}'`);
      }
    }
  }

  /**
   * Start transport infrastructure and sub-orchestrator instances.
   * Does NOT activate either pipeline.
   */
  private startInfrastructure(): void {
    if (this.running) return;

    // rigId — auto-generated on first launch, then read from settings (DIR-3 / S3).
    const stored = String(this.cfg.director.settings['publisher.rigId'] ?? '').trim();
    const savedRigId = stored || (this.cfg.uuidFn ?? randomUUID)();
    if (!stored) {
      this.cfg.director.saveSetting?.('publisher.rigId', savedRigId);
      this.cfg.director.log('info', `Publisher generated new rigId: ${savedRigId}`);
    }

    this.rigId = savedRigId;

    const rcBaseUrl = String(
      this.cfg.director.settings['app.rcApiBaseUrl'] ?? DEFAULT_RC_BASE_URL,
    ).replace(/\/$/, '');
    const endpointUrl     = `${rcBaseUrl}/api/telemetry/events`;
    const batchIntervalMs = Number(
      this.cfg.director.settings['publisher.batchIntervalMs'] ?? DEFAULT_BATCH_INTERVAL_MS,
    );

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

    // Construct sub-orchestrators but do NOT activate them yet.
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

    // Seed the roster into both pipelines if it was set before start().
    if (this.currentRoster.size > 0) {
      const drivers = Array.from(this.currentRoster.values());
      this.sessionPublisher.updateRoster(drivers);
      this.driverPublisher.updateRoster(drivers);
    }

    this.running = true;

    // If iRacing was already connected before we started, fire IRACING_CONNECTED.
    if (this.connected) {
      this.dispatchLifecycleEvents(
        this.lifecycleDetector.onConnectionChange(true, this.lifecycleCtx()),
      );
    }

    // 1Hz heartbeat
    this.heartbeatTimer = setInterval(() => this.tickHeartbeat(), HEARTBEAT_INTERVAL_MS);

    this.cfg.director.log('info', 'Publisher infrastructure started');
  }

  /**
   * Activate both pipelines with the current raceSessionId.
   * Called when bindSession fires and we are connected, or when we connect
   * after being armed.
   *
   * Note: Driver Publisher activation will be separated from Session Publisher
   * in DIR-3 (opt-in flow). For DIR-2 both pipelines start together on bind.
   */
  private startSessionPipeline(): void {
    if (!this.running || !this.sessionPublisher || !this.driverPublisher) return;

    const sessionEnabled = this.cfg.director.settings['publisher.session.enabled'] !== false;
    if (sessionEnabled) {
      this.sessionPublisher.activate(this.raceSessionId, this.rigId);
    }

    // Driver Publisher only activates via bindSession on Director Loop rigs
    // when the operator has opted in (publisher.driver.enabled = true).
    // On driver-only rigs it activates via registerDriver() instead.
    if (this.cfg.director.settings['publisher.driver.enabled'] === true) {
      this.driverPublisher.activate(this.raceSessionId, this.rigId);
    }

    // Seed roster into both pipelines.
    if (this.currentRoster.size > 0) {
      const drivers = Array.from(this.currentRoster.values());
      this.sessionPublisher.updateRoster(drivers);
      this.driverPublisher.updateRoster(drivers);
    }

    // PUBLISHER_HELLO — signals RC to create the checkin record.
    this.dispatchLifecycleEvents(this.lifecycleDetector.onActivate(this.lifecycleCtx()));

    this.cfg.director.log('info', `Publisher pipelines started for raceSessionId=${this.raceSessionId}`);
  }

  /** Stop both pipelines and the transport. Called by deactivate(). */
  private stopAll(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.armedSessionId = null;

    // Deactivate sub-orchestrators so they stop processing frames.
    this.sessionPublisher?.deactivate();
    this.driverPublisher?.deactivate();
    this.sessionPublisher = null;
    this.driverPublisher  = null;

    if (this.transport) {
      // PUBLISHER_GOODBYE — enqueue before stopping so it ships in the final flush.
      if (this.raceSessionId !== '') {
        this.dispatchLifecycleEvents(this.lifecycleDetector.onDeactivate(this.lifecycleCtx()));
      }
      void this.transport.stop();
      this.transport = null;
    }

    this.running = false;
    this.raceSessionId = '';
    this.cfg.director.log('info', 'Publisher orchestrator stopped');
  }

  // -------------------------------------------------------------------------
  // Internal helpers
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
      rigId: this.rigId,
      pipelines: {
        session: {
          active:         this.sessionPublisher?.isActive       ?? false,
          eventsEnqueued: this.sessionPublisher?.eventsEnqueued ?? 0,
        },
        driver: {
          active:         this.driverPublisher?.isActive        ?? false,
          eventsEnqueued: this.driverPublisher?.eventsEnqueued  ?? 0,
        },
      },
    });
  }

  private lifecycleCtx(): LifecycleDetectorContext {
    return {
      rigId:         this.rigId,
      raceSessionId: this.raceSessionId,
      version:       this.cfg.version,
    };
  }
}
