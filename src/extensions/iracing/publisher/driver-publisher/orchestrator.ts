/**
 * driver-publisher/orchestrator.ts — DIR-1
 *
 * DriverPublisherOrchestrator
 *
 * Owns all driver-level detectors — events authoritative only from the
 * player's own rig:
 *   identity resolution, pit/incidents, pit-stop detail, fuel,
 *   lap performance (personal/stint best, degradation),
 *   incident/stint milestones, player physics, driver swap completion.
 *
 * Design constraints (DIR-1):
 *   - Does NOT own a transport. Receives a reference to the shared
 *     PublisherTransport from the top-level orchestrator at construction.
 *   - Does NOT emit lifecycle events (PUBLISHER_HELLO / HEARTBEAT / GOODBYE,
 *     IRACING_CONNECTED / DISCONNECTED) — those are top-level concerns.
 *   - Activates lazily: constructed once, activated/deactivated independently
 *     of the SessionPublisherOrchestrator.
 *   - publisherCode / raceSessionId are passed in at activate() time; context
 *     strings are refreshed on each session bind (DIR-2).
 *   - initiateDriverSwap() is called by the top-level orchestrator when the
 *     operator triggers a swap from the UI.
 */

import type { PublisherTransport } from '../transport';
import { detectPitAndIncidents } from './pit-incident-detector';
import { detectPitStopDetail } from './pit-stop-detail-detector';
import { detectIncidentsAndMilestones } from './incident-stint-detector';
import { detectDriverSwap } from './driver-swap-detector';
import { detectDriverLapPerformance } from './lap-performance-driver';
import { detectPlayerPhysics } from './player-physics-detector';
import { buildIdentityEvents } from './identity-event-builder';
import { IdentityOverrideService } from './identity-override';
import {
  createSessionState,
  buildEvent,
  carRefFromRoster,
  type SessionState,
  type TelemetryFrame,
} from '../session-state';
import type { PublisherEvent, PublisherCarRef } from '../event-types';

export interface DriverPublisherConfig {
  /** Shared transport owned by the top-level orchestrator. */
  transport: PublisherTransport;
  /** Callback to forward events to the renderer. */
  emitEvent: (event: string, payload: any) => void;
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export class DriverPublisherOrchestrator {
  private state: SessionState | null = null;
  private prevFrame: TelemetryFrame | null = null;
  private active = false;

  // Session context — set at activate() / reset
  private publisherCode = '';
  private raceSessionId = '';

  // YAML-sourced metadata
  private playerCarIdx: number | undefined = undefined;
  private estimatedStintLaps = 0;
  private carNumberByCarIdx: Map<number, string> = new Map();
  private identityDisplayName = '';
  private iracingUserName = '';

  // Roster (owned by top-level, pushed here via updateRoster())
  private currentRoster: Map<number, PublisherCarRef> = new Map();

  // Identity tracking
  private readonly identity = new IdentityOverrideService();

  /** Latest frame — used when building events from operator actions. */
  private lastFrame: TelemetryFrame | null = null;
  /** Last-emitted pit road state — for operator state change events. */
  private lastPlayerOnPitRoad = false;

  constructor(private readonly cfg: DriverPublisherConfig) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Activate the driver publisher for a given session.
   * Safe to call when already active — resets state to the new session.
   */
  activate(raceSessionId: string, publisherCode: string): void {
    if (this.active && this.raceSessionId === raceSessionId) return;
    this.raceSessionId = raceSessionId;
    this.publisherCode = publisherCode;
    this.resetState();
    this.active = true;
    this.cfg.log('info', `DriverPublisher activated for raceSessionId=${raceSessionId}`);
  }

  /** Deactivate — no more frames are processed until activate() is called again. */
  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.state = null;
    this.prevFrame = null;
    this.cfg.log('info', 'DriverPublisher deactivated');
  }

  /** Reset detector state for a new session. */
  resetState(): void {
    this.state = null;
    this.prevFrame = null;
    this.identity.reset();
    this.lastPlayerOnPitRoad = false;
  }

  /** True when the driver publisher is processing frames. */
  get isActive(): boolean {
    return this.active;
  }

  /**
   * Process one telemetry frame.
   * Called by the top-level orchestrator on every poll tick when active.
   */
  onTelemetryFrame(frame: TelemetryFrame): void {
    if (!this.active) return;

    if (!this.state) {
      this.state = createSessionState(this.raceSessionId, frame.sessionUniqueId);
      this.state.knownRoster = new Map(this.currentRoster);
    }

    const ctx = { publisherCode: this.publisherCode, raceSessionId: this.raceSessionId };
    const events: PublisherEvent[] = [];

    // Identity — resolve on every frame; only emits on first resolve or change.
    if (this.iracingUserName) {
      const identityResult = this.identity.resolve(this.iracingUserName, this.identityDisplayName);
      if (identityResult.kind !== 'unchanged' && this.playerCarIdx !== undefined) {
        events.push(...buildIdentityEvents(identityResult, frame, this.state, {
          ...ctx,
          playerCarIdx: this.playerCarIdx,
        }));
      }
    }

    events.push(...detectPitAndIncidents(this.prevFrame, frame, this.state, ctx));
    events.push(...detectPitStopDetail(this.prevFrame, frame, this.state, {
      ...ctx,
      playerCarIdx: this.playerCarIdx,
    }));
    events.push(...detectDriverLapPerformance(this.prevFrame, frame, this.state, {
      ...ctx,
      playerCarIdx: this.playerCarIdx,
    }));
    events.push(...detectIncidentsAndMilestones(this.prevFrame, frame, this.state, {
      ...ctx,
      playerCarIdx:        this.playerCarIdx,
      estimatedStintLaps:  this.estimatedStintLaps,
    }));
    events.push(...detectDriverSwap(this.prevFrame, frame, this.state, {
      ...ctx,
      playerCarIdx: this.playerCarIdx,
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
      this.cfg.emitEvent('iracing.publisherOperatorState', {
        playerOnPitRoad:  nowOnPit,
        driverSwapPending: swapPending,
      });
    }

    if (events.some((e) => e.type === 'SESSION_LOADED')) {
      this.state = createSessionState(this.raceSessionId, frame.sessionUniqueId);
      this.prevFrame = null;
    } else {
      this.prevFrame = frame;
    }
    this.lastFrame = frame;
  }

  setSessionMetadata(meta: {
    playerCarIdx?: number;
    estimatedStintLaps?: number;
    carNumberByCarIdx?: Map<number, string>;
    iracingUserName?: string;
    identityDisplayName?: string;
  }): void {
    if (meta.playerCarIdx !== undefined)         this.playerCarIdx = meta.playerCarIdx;
    if (meta.estimatedStintLaps !== undefined)   this.estimatedStintLaps = meta.estimatedStintLaps;
    if (meta.carNumberByCarIdx)                  this.carNumberByCarIdx = meta.carNumberByCarIdx;
    if (meta.iracingUserName !== undefined)      this.iracingUserName = meta.iracingUserName;
    if (meta.identityDisplayName !== undefined)  this.identityDisplayName = meta.identityDisplayName;
  }

  /** Called by the top-level orchestrator when the roster is refreshed. */
  updateRoster(drivers: PublisherCarRef[]): void {
    this.currentRoster = new Map(drivers.map((d) => [d.carIdx, d]));
    if (this.state) {
      this.state.knownRoster = new Map(this.currentRoster);
    }
  }

  /**
   * Initiates a driver swap — called by the top-level orchestrator when the
   * operator clicks the UI button while the player car is in the pits.
   * Immediately emits DRIVER_SWAP_INITIATED; the next pit exit emits
   * DRIVER_SWAP_COMPLETED (via detectDriverSwap on subsequent frames).
   */
  initiateDriverSwap(outgoingDriverId: string, incomingDriverId: string, incomingDriverName: string): void {
    if (!this.active || !this.state || !this.lastFrame) return;

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
        {
          raceSessionId: this.raceSessionId,
          publisherCode: this.publisherCode,
          frame: this.lastFrame,
        },
      );
      this.dispatchEvents([event]);
    }

    this.cfg.emitEvent('iracing.publisherOperatorState', {
      playerOnPitRoad:   this.lastPlayerOnPitRoad,
      driverSwapPending: true,
    });
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private dispatchEvents(events: PublisherEvent[]): void {
    if (events.length === 0) return;
    for (const ev of events) {
      this.cfg.transport.enqueue(ev);
      this.cfg.emitEvent('iracing.publisherEventEmitted', {
        type:      ev.type,
        carIdx:    ev.car?.carIdx,
        timestamp: ev.timestamp,
        pipeline:  'driver',
      });
    }
  }
}
