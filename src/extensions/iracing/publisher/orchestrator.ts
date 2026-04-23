/**
 * orchestrator.ts — Issue #106
 *
 * Wires the publisher transport and all Tier-1 detectors into the iRacing
 * extension lifecycle.
 *
 * Responsibilities:
 *   - Read publisher.* settings at start time (no runtime reactivity yet)
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
 *   - Heartbeat is a 1Hz timer that suppresses itself if any other event was
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
import {
  createSessionState,
  type SessionState,
  type TelemetryFrame,
} from './session-state';
import type { PublisherEvent } from './event-types';

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

const DEFAULT_ENDPOINT = 'https://simracecenter.com/api/telemetry/events';
const DEFAULT_BATCH_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 1000;

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
    events.push(...detectOvertakeAndBattle(this.prevFrame, frame, this.state, ctx));

    this.dispatchEvents(events);

    if (events.some((e) => e.type === 'SESSION_LOADED')) {
      this.state = createSessionState(this.raceSessionId, frame.sessionUniqueId);
      this.prevFrame = null;
    } else {
      this.prevFrame = frame;
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
    const endpointUrl = String(
      this.cfg.director.settings['publisher.endpointUrl'] ?? DEFAULT_ENDPOINT,
    );
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

  private lifecycleCtx(): LifecycleDetectorContext {
    return {
      publisherCode: this.publisherCode,
      raceSessionId: this.raceSessionId,
      version: this.cfg.version,
    };
  }
}
