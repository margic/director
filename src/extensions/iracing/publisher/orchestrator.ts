/**
 * orchestrator.ts — DIR-4
 *
 * Top-level publisher orchestrator. Owns:
 *   - The single PublisherTransport instance (shared by both pipelines)
 *   - Lifecycle events (PUBLISHER_HELLO / HEARTBEAT / GOODBYE,
 *     IRACING_CONNECTED / IRACING_DISCONNECTED)
 *   - Roster cache (pushed to both sub-orchestrators on update — S5)
 *   - Routing of telemetry frames to SessionPublisherOrchestrator and
 *     DriverPublisherOrchestrator
 *   - Session bind / release lifecycle (DIR-2)
 *   - Config migration of legacy keys on startup (DIR-2+3+4 / S3)
 *   - Auto-generated rigId (DIR-3)
 *   - publisher.scope: 'session' | 'driver' | 'both' (DIR-4)
 *
 * Activation model (DIR-2/3/4):
 *   - activate()         → starts transport, heartbeat, lifecycle infra;
 *                          generates rigId if absent; migrates legacy config.
 *                          Does NOT start either sub-pipeline on its own.
 *   - bindSession(id)    → activates pipelines based on publisher.scope:
 *                            'session' → SessionPublisher only (default)
 *                            'driver'  → DriverPublisher only
 *                            'both'    → both (dev/demo only — logs warning)
 *                          If iRacing is not yet connected, the id is "armed"
 *                          and the pipelines start when the connection arrives.
 *   - releaseSession()   → stops both pipelines, sends PUBLISHER_GOODBYE,
 *                          flushes remaining events. Transport stays live.
 *   - registerDriver(id) → Driver-only rig flow: calls the Race Control
 *                          register endpoint, persists publisher.scope='driver',
 *                          and activates the Driver Publisher on success.
 *   - deactivate()       → stops everything (both pipelines + transport).
 *
 * Single-transport invariant: exactly one PublisherTransport instance exists
 * for the lifetime of this orchestrator. Tests must assert this.
 */

import { randomUUID } from 'crypto';
import { PublisherTransport, type TransportStatus } from './transport';
import { EventEnricher } from './enricher/event-enricher';
import { EnrichingTransport } from './enricher/enriching-transport';
import { createProvider, type EnricherSettings } from './enricher/factory';
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
// Types
// ---------------------------------------------------------------------------

/**
 * Determines which sub-pipeline(s) activate on bindSession / registerDriver.
 *   'session' — Director Loop rig: SessionPublisher only (default).
 *   'driver'  — Driver rig in Publisher Mode: DriverPublisher only.
 *   'both'    — Reserved for development / single-rig demos (logs a warning).
 */
export type PublisherScope = 'session' | 'driver' | 'both';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_RC_BASE_URL       = 'https://simracecenter.com';
const DEFAULT_BATCH_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS     = 30_000;

/** Legacy config keys removed in DIR-2, DIR-3, and DIR-4 (S3 migration). */
const LEGACY_KEYS = [
  'publisher.enabled',
  'publisher.publisherCode',
  'publisher.raceSessionId',
  'publisher.identityDisplayName',
  'publisher.session.enabled',
  'publisher.driver.enabled',
] as const;

// ---------------------------------------------------------------------------
// PublisherOrchestrator
// ---------------------------------------------------------------------------

export class PublisherOrchestrator {
  /** Single transport instance — shared by both pipelines. Non-null while running. */
  private transport: PublisherTransport | null = null;

  /** Optional LLM enricher (#183). Null when `publisher.enricher.provider` is
   *  unset/`'disabled'` — the default. When non-null, the transport above
   *  is an `EnrichingTransport` that forwards every event to it. */
  private enricher: EventEnricher | null = null;

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
   * Activates pipeline(s) based on publisher.scope:
   *   'session' (default) → SessionPublisher only.
   *   'driver'            → DriverPublisher only.
   *   'both'              → both (dev/demo).
   *
   * Pass null or empty string to release the session (identical semantics to
   * releaseSession()).
   */
  bindSession(raceSessionId: string | null): void {
    if (!raceSessionId) {
      this.releaseSession('bindSession-null');
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
   *
   * @param reason  Optional caller tag — recorded in the log and surfaced via
   *                the `iracing.publisherStopped` event so the operator can
   *                see *why* the pipeline deactivated. Investigation aid for
   *                silent-stop bugs (the publisher going quiet mid-race
   *                without an obvious cause).
   */
  releaseSession(reason: string = 'unspecified'): void {
    const previousRaceSessionId = this.raceSessionId;
    const wasArmed = this.armedSessionId !== null;
    this.armedSessionId = null;
    if (!this.sessionPublisher?.isActive && !this.driverPublisher?.isActive) {
      // Nothing was active — still log at info level so we capture a no-op
      // release for forensic timelines (helps reconstruct silent-stop bugs).
      if (wasArmed || previousRaceSessionId) {
        this.cfg.director.log(
          'info',
          `Publisher releaseSession (no-op, no active pipeline) — reason='${reason}' previousRaceSessionId='${previousRaceSessionId}' wasArmed=${wasArmed}`,
        );
      }
      return;
    }

    // Capture stack trace so we can identify the call site if the operator
    // reports a silent stop. Constructing an Error solely for `.stack` is
    // intentional — there's no other portable way in Node.js to get a
    // formatted stack at an arbitrary point. Logged via console.log because
    // director.log only takes a single-line string.
    const callerStack = new Error('releaseSession call site').stack ?? '';
    this.cfg.director.log(
      'info',
      `Publisher releaseSession called — reason='${reason}' raceSessionId='${previousRaceSessionId}'`,
    );
    // Single console line keeps log streams parseable while preserving the
    // stack for post-mortem analysis.
    console.log(`[publisher-orchestrator] releaseSession stack:\n${callerStack}`);

    // PUBLISHER_GOODBYE — enqueue before flush so it ships in the final batch.
    this.dispatchLifecycleEvents(this.lifecycleDetector.onDeactivate(this.lifecycleCtx()));

    this.sessionPublisher?.deactivate();
    this.driverPublisher?.deactivate();

    // Flush remaining events asynchronously. The transport stays live.
    if (this.transport) {
      void this.transport.flush();
    }

    this.raceSessionId = '';
    this.cfg.director.log('info', `Publisher session released (reason='${reason}')`);

    // Surface the deactivation to the renderer / UI so the operator can see
    // when (and why) the pipeline went silent. This is the missing signal
    // that made the original bug invisible during a live race.
    this.cfg.director.emitEvent('iracing.publisherStopped', {
      raceSessionId: previousRaceSessionId,
      rigId:         this.rigId,
      reason,
      timestamp:     this.nowFn(),
    });
  }

  /**
   * Hot-switch the publisher rig mode (DIR-4).
   *
   * Persists `publisher.scope` and, if a session is bound and iRacing is
   * connected, restarts the publisher pipeline(s) so the new scope takes
   * effect immediately:
   *   1. Deactivates any currently-active sub-orchestrators.
   *   2. Re-runs the equivalent of `startSessionPipeline()` against the
   *      bound `raceSessionId` with the new scope.
   *   3. The transport stays live across the transition; PUBLISHER_HELLO is
   *      re-emitted by `startSessionPipeline()`.
   *
   * Invalid scopes are rejected (logs a warning, no state change).
   */
  setScope(scope: PublisherScope): void {
    if (scope !== 'session' && scope !== 'driver' && scope !== 'both') {
      this.cfg.director.log('warn', `Publisher setScope: invalid scope '${String(scope)}' — ignoring`);
      return;
    }

    const currentScope = (this.cfg.director.settings['publisher.scope'] ?? 'session') as PublisherScope;

    // Persist the new scope (in settings and on disk) before any pipeline work.
    this.cfg.director.settings['publisher.scope'] = scope;
    this.cfg.director.saveSetting?.('publisher.scope', scope);

    if (currentScope === scope) {
      this.cfg.director.log('info', `Publisher scope unchanged (${scope}) — no restart`);
      return;
    }

    // If we're not running, or no session is bound, or iRacing isn't connected,
    // there's no live pipeline to restart — the new scope will take effect on
    // the next bindSession()/onConnectionChange() path.
    if (!this.running || !this.raceSessionId || !this.connected) {
      this.cfg.director.log('info', `Publisher scope set to '${scope}' (no active pipeline to restart)`);
      return;
    }

    this.cfg.director.log('info', `Publisher scope changing '${currentScope}' → '${scope}' — restarting pipelines`);

    // Stop any currently active sub-orchestrators. Do NOT emit PUBLISHER_GOODBYE
    // here — the rig is still bound to the same session, just switching modes.
    this.sessionPublisher?.deactivate();
    this.driverPublisher?.deactivate();

    // Re-activate per the new scope. startSessionPipeline reads
    // publisher.scope from settings, which we just updated.
    this.startSessionPipeline();
  }

  /**
   * Hot-toggle the Session Publisher pipeline.
   * Persists the setting and immediately starts/stops the pipeline if a
   * session is bound and iRacing is connected.
   *
   * @deprecated DIR-4: superseded by setScope(). Kept for backward compatibility
   *             of legacy intent handlers; UI no longer calls this.
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
      carClassByCarIdx:    meta.carClassByCarIdx,
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
        // Persist scope before activating so the setting is in place if the
        // app restarts mid-session (DIR-4).
        this.cfg.director.saveSetting?.('publisher.scope', 'driver');
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
    // No session bound — heartbeat would carry an empty raceSessionId and be
    // meaningless to Race Control. Skip until bindSession() fires.
    if (!this.raceSessionId) return;
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
   * DIR-4: migrates two-flag model (publisher.driver/session.enabled) to
   * publisher.scope.
   */
  private migrateConfig(): void {
    const settings = this.cfg.director.settings;
    const legacyDisplayName = settings['publisher.identityDisplayName'];
    if (legacyDisplayName !== undefined) {
      if (!settings['publisher.driver.displayName']) {
        this.cfg.director.saveSetting?.('publisher.driver.displayName', legacyDisplayName);
      }
    }

    // Migrate two-flag model → publisher.scope (DIR-4).
    // Only write the new key if it is not already present.
    if (settings['publisher.scope'] === undefined) {
      const driverEnabled  = settings['publisher.driver.enabled'];
      const sessionEnabled = settings['publisher.session.enabled'];
      let scope: PublisherScope;
      if (driverEnabled === true && sessionEnabled === true) {
        scope = 'both';
      } else if (driverEnabled === true && sessionEnabled === false) {
        scope = 'driver';
      } else {
        scope = 'session';
      }
      this.cfg.director.saveSetting?.('publisher.scope', scope);
      this.cfg.director.log('info', `Publisher config migration: set publisher.scope='${scope}'`);
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
    // When the enricher is configured, we wrap the transport so every enqueued
    // event is also fed to the LLM clustering stage. Default = disabled = no overhead.
    const enricherSettings = this.cfg.director.settings['publisher.enricher'] as
      | EnricherSettings
      | undefined;
    const enricherProvider = createProvider(enricherSettings, this.cfg.fetchFn);
    if (enricherProvider.enabled) {
      this.enricher = new EventEnricher({
        provider: enricherProvider,
        emitMetaEvent: (ev) => this.transport?.enqueue(ev),
        log: (level, msg, meta) =>
          this.cfg.director.log(level === 'debug' ? 'info' : level, `enricher: ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`),
        raceSessionId: this.raceSessionId,
        rigId: this.rigId,
        tokenBudgetCap: Number(
          this.cfg.director.settings['publisher.enricher.tokenBudget'] ?? 100_000,
        ),
        callTimeoutMs: Number(
          this.cfg.director.settings['publisher.enricher.timeoutMs'] ?? 5000,
        ),
      });
      this.transport = new EnrichingTransport({
        endpointUrl,
        batchIntervalMs,
        getAuthToken:   () => this.cfg.director.getAuthToken(),
        onStatusChange: (s) => this.onTransportStatus(s),
        fetchFn:        this.cfg.fetchFn,
        enricher:       this.enricher,
      });
      this.cfg.director.log('info', `Publisher enricher enabled (provider=${enricherProvider.name})`);
    } else {
      this.transport = new PublisherTransport({
        endpointUrl,
        batchIntervalMs,
        getAuthToken:   () => this.cfg.director.getAuthToken(),
        onStatusChange: (s) => this.onTransportStatus(s),
        fetchFn:        this.cfg.fetchFn,
      });
    }
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

    // 30s heartbeat. NOTE: This timer runs in the iRacing extension's
    // utilityProcess (see src/main/extension-host) — a separate Node.js
    // process, NOT a renderer BrowserWindow. setInterval here is therefore
    // NOT subject to background/throttling that affects minimised renderer
    // windows. If heartbeats stop arriving in production, the cause is
    // upstream (releaseSession() called, raceSessionId cleared, transport
    // backoff) — not timer throttling. See `releaseSession` for caller-tag
    // logging that helps diagnose silent stops.
    this.heartbeatTimer = setInterval(() => this.tickHeartbeat(), HEARTBEAT_INTERVAL_MS);

    this.cfg.director.log('info', 'Publisher infrastructure started');
  }

  /**
   * Activate pipelines with the current raceSessionId based on publisher.scope.
   * Called when bindSession fires and we are connected, or when we connect
   * after being armed.
   *
   *   'session' (default) → activate SessionPublisher only.
   *   'driver'            → activate DriverPublisher only.
   *   'both'              → activate both (dev/demo only — logs a warning).
   */
  private startSessionPipeline(): void {
    if (!this.running || !this.sessionPublisher || !this.driverPublisher) return;

    const scope = (this.cfg.director.settings['publisher.scope'] ?? 'session') as PublisherScope;

    if (scope === 'both') {
      this.cfg.director.log('warn', `Publisher scope=both — activating both pipelines (dev/demo only, not for production)`);
    }

    if (scope === 'session' || scope === 'both') {
      this.sessionPublisher.activate(this.raceSessionId, this.rigId);
    }

    if (scope === 'driver' || scope === 'both') {
      this.driverPublisher.activate(this.raceSessionId, this.rigId);
    }

    // Seed roster into active pipelines.
    if (this.currentRoster.size > 0) {
      const drivers = Array.from(this.currentRoster.values());
      if (scope === 'session' || scope === 'both') this.sessionPublisher.updateRoster(drivers);
      if (scope === 'driver'  || scope === 'both') this.driverPublisher.updateRoster(drivers);
    }

    // PUBLISHER_HELLO — signals RC to create the checkin record.
    this.dispatchLifecycleEvents(this.lifecycleDetector.onActivate(this.lifecycleCtx()));

    this.cfg.director.log('info', `Publisher pipeline(s) started for raceSessionId=${this.raceSessionId} scope=${scope}`);
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
