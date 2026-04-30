/**
 * session-publisher/orchestrator.ts — DIR-1
 *
 * SessionPublisherOrchestrator
 *
 * Owns all session-level detectors:
 *   session-lifecycle, flags, lap-completed, overtake/battle, position changes,
 *   environment, roster, session/class best laps, session type changes.
 *
 * Design constraints (DIR-1):
 *   - Does NOT own a transport. Receives a reference to the shared
 *     PublisherTransport from the top-level orchestrator at construction.
 *   - Does NOT emit lifecycle events (PUBLISHER_HELLO / HEARTBEAT / GOODBYE,
 *     IRACING_CONNECTED / DISCONNECTED) — those are top-level concerns.
 *   - Activates lazily: constructed once, activated/deactivated independently
 *     of the DriverPublisherOrchestrator.
 *   - publisherCode / raceSessionId are passed in at activate() time; the
 *     context strings are refreshed on each session bind (DIR-2).
 */

import type { PublisherTransport } from '../transport';
import { detectSessionLifecycle } from './session-lifecycle-detector';
import { detectFlags } from './flag-detector';
import { detectLapCompleted } from './lap-completed-detector';
import { detectOvertakeAndBattle } from './overtake-battle-detector';
import { detectSessionLapPerformance } from './lap-performance-session';
import { detectSessionTypeChange } from './session-type-detector';
import { detectRosterUpdate } from './roster-detector';
import { detectEnvironment } from './environment-detector';
import { detectPolishFlags } from './polish-flag-detector';
import {
  createSessionState,
  type SessionState,
  type TelemetryFrame,
} from '../session-state';
import type { PublisherEvent, PublisherCarRef } from '../event-types';

export interface SessionPublisherConfig {
  /** Shared transport owned by the top-level orchestrator. */
  transport: PublisherTransport;
  /** Callback to forward events to the renderer. */
  emitEvent: (event: string, payload: any) => void;
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export class SessionPublisherOrchestrator {
  private state: SessionState | null = null;
  private prevFrame: TelemetryFrame | null = null;
  private active = false;

  // Session context — set at activate() / resetForSession()
  private publisherCode = '';
  private raceSessionId = '';

  // YAML-sourced metadata
  private carClassByCarIdx: Map<number, number> = new Map();
  private carClassShortNames: Map<number, string> = new Map();
  private currentSessionType = '';
  private carNumberByCarIdx: Map<number, string> = new Map();

  // Roster (owned by top-level, pushed here via updateRoster())
  private currentRoster: Map<number, PublisherCarRef> = new Map();
  /** Player carIdx — needed for the roster event car-ref. */
  private playerCarIdx: number | undefined = undefined;

  /** Running count of events enqueued by this pipeline (for status reporting). */
  private _eventsEnqueued = 0;

  constructor(private readonly cfg: SessionPublisherConfig) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Activate the session publisher for a given session.
   * Safe to call when already active — resets state to the new session.
   */
  activate(raceSessionId: string, publisherCode: string): void {
    if (this.active && this.raceSessionId === raceSessionId) return;
    this.raceSessionId = raceSessionId;
    this.publisherCode = publisherCode;
    this.resetState();
    this.active = true;
    this.cfg.log('info', `SessionPublisher activated for raceSessionId=${raceSessionId}`);
  }

  /** Deactivate — no more frames are processed until activate() is called again. */
  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.state = null;
    this.prevFrame = null;
    this.cfg.log('info', 'SessionPublisher deactivated');
  }

  /** Reset detector state for a new session (called by activate and on session change). */
  resetState(): void {
    this.state = null;
    this.prevFrame = null;
  }

  /** True when the session publisher is processing frames. */
  get isActive(): boolean {
    return this.active;
  }

  /** Running count of events this pipeline has enqueued into the transport. */
  get eventsEnqueued(): number {
    return this._eventsEnqueued;
  }

  /**
   * Process one telemetry frame.
   * Called by the top-level orchestrator on every poll tick when active.
   */
  onTelemetryFrame(frame: TelemetryFrame): void {
    if (!this.active) return;

    if (!this.state) {
      this.state = createSessionState(this.raceSessionId, frame.sessionUniqueId);
      // Seed roster into state so detectors can look up car refs immediately.
      this.state.knownRoster = new Map(this.currentRoster);
    }

    const ctx = { publisherCode: this.publisherCode, raceSessionId: this.raceSessionId };
    const events: PublisherEvent[] = [];

    events.push(...detectSessionLifecycle(this.prevFrame, frame, this.state, ctx));
    events.push(...detectFlags(this.prevFrame, frame, this.state, ctx));
    events.push(...detectLapCompleted(this.prevFrame, frame, this.state, ctx));
    events.push(...detectOvertakeAndBattle(this.prevFrame, frame, this.state, ctx));
    events.push(...detectSessionLapPerformance(this.prevFrame, frame, this.state, {
      ...ctx,
      carClassByCarIdx:   this.carClassByCarIdx,
      carClassShortNames: this.carClassShortNames,
    }));
    if (this.currentSessionType !== '') {
      events.push(...detectSessionTypeChange(frame, this.state, {
        ...ctx,
        sessionType: this.currentSessionType,
      }));
    }
    events.push(...detectRosterUpdate(this.prevFrame, frame, this.state, {
      ...ctx,
      playerCarIdx:  this.playerCarIdx,
      currentRoster: this.currentRoster.size > 0 ? this.currentRoster : undefined,
    }));
    events.push(...detectEnvironment(this.prevFrame, frame, this.state, ctx));
    events.push(...detectPolishFlags(this.prevFrame, frame, this.state, {
      ...ctx,
      carNumberByCarIdx: this.carNumberByCarIdx.size > 0 ? this.carNumberByCarIdx : undefined,
    }));

    this.dispatchEvents(events);

    if (events.some((e) => e.type === 'SESSION_LOADED')) {
      this.state = createSessionState(this.raceSessionId, frame.sessionUniqueId);
      this.prevFrame = null;
    } else {
      this.prevFrame = frame;
    }
  }

  setSessionMetadata(meta: {
    playerCarIdx?: number;
    carClassByCarIdx?: Map<number, number>;
    carClassShortNames?: Map<number, string>;
    sessionType?: string;
    carNumberByCarIdx?: Map<number, string>;
  }): void {
    if (meta.playerCarIdx !== undefined)  this.playerCarIdx = meta.playerCarIdx;
    if (meta.carClassByCarIdx)            this.carClassByCarIdx = meta.carClassByCarIdx;
    if (meta.carClassShortNames)          this.carClassShortNames = meta.carClassShortNames;
    if (meta.sessionType !== undefined)   this.currentSessionType = meta.sessionType;
    if (meta.carNumberByCarIdx)           this.carNumberByCarIdx = meta.carNumberByCarIdx;
  }

  /** Called by the top-level orchestrator when the roster is refreshed. */
  updateRoster(drivers: PublisherCarRef[]): void {
    this.currentRoster = new Map(drivers.map((d) => [d.carIdx, d]));
    // Keep the live SessionState in sync so carRefFromRoster() reflects the
    // latest roster on every frame without waiting for the next detect call.
    if (this.state) {
      this.state.knownRoster = new Map(this.currentRoster);
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private dispatchEvents(events: PublisherEvent[]): void {
    if (events.length === 0) return;
    for (const ev of events) {
      this.cfg.transport.enqueue(ev);
      this._eventsEnqueued++;
      this.cfg.emitEvent('iracing.publisherEventEmitted', {
        type:      ev.type,
        carIdx:    ev.car?.carIdx,
        timestamp: ev.timestamp,
        pipeline:  'session',
      });
    }
  }
}
