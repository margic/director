/**
 * cluster-detector.ts — Issue #183
 *
 * Pure clustering logic over the publisher's event stream. The enricher
 * feeds every emitted `PublisherEvent` into `ingest()`; the detector keeps
 * sliding windows internally and returns zero or more `ClusterRequest`s
 * each call. No I/O, no async — easy to test deterministically.
 *
 * Three cluster kinds:
 *   - incident : ≥3 INCIDENT_EVENT_TYPES events within `INCIDENT_WINDOW_SEC`
 *   - battle   : continuous focus block ≥ `BATTLE_MIN_SEC` ending when focus
 *                drops or its window times out
 *   - stint    : on PIT_ENTRY — emits all events of the stint just ended
 */

import type { PublisherEvent } from '../event-types';
import type { ClusterRequest } from './provider';
import { INCIDENT_EVENT_TYPES } from './provider';

/** Sliding window for incident clustering (seconds, sessionTime units). */
export const INCIDENT_WINDOW_SEC = 10;
/** Min number of incident-weight events required to trigger one incident cluster. */
export const INCIDENT_MIN_COUNT = 3;
/** Min duration of a sustained focus block (seconds). */
export const BATTLE_MIN_SEC = 30;
/** Focus value above which a battle is considered "engaged". */
export const BATTLE_FOCUS_THRESHOLD = 0.7;
/** Cooldown between successive incident clusters (seconds). Prevents repeats from the same burst. */
export const INCIDENT_COOLDOWN_SEC = 5;

/**
 * Optional per-tick context. The enricher only needs `competitiveFocus` to
 * decide battle clustering — derived metrics live on `DriverState.derived`.
 */
export interface ClusterContext {
  /** Current competitive-focus score (0–1). Provided by the caller — usually
   *  read from `driverState.derived.competitiveFocus` once per tick. */
  competitiveFocus?: number;
  /** sessionTime (s) — used to time-out an open battle window if `competitiveFocus`
   *  hasn't been updated for a while. */
  now?: number;
}

interface BattleWindow {
  startTime: number;
  events: PublisherEvent[];
}

interface StintAccumulator {
  startTime: number;
  events: PublisherEvent[];
}

export class ClusterDetector {
  private readonly recentIncidents: PublisherEvent[] = [];
  private lastIncidentEmitEnd = -Infinity;
  private battle: BattleWindow | null = null;
  private stint: StintAccumulator = { startTime: 0, events: [] };

  /**
   * Feed one event + optional context. Returns 0+ clusters that became
   * "ready" as a result of this ingest.
   */
  ingest(ev: PublisherEvent, ctx: ClusterContext = {}): ClusterRequest[] {
    const out: ClusterRequest[] = [];

    // ---- Incident clustering ------------------------------------------------
    if (INCIDENT_EVENT_TYPES.has(ev.type)) {
      this.recentIncidents.push(ev);
      // Drop anything older than the window.
      const cutoff = ev.sessionTime - INCIDENT_WINDOW_SEC;
      while (this.recentIncidents.length > 0 && this.recentIncidents[0].sessionTime < cutoff) {
        this.recentIncidents.shift();
      }
      const sinceLast = ev.sessionTime - this.lastIncidentEmitEnd;
      if (this.recentIncidents.length >= INCIDENT_MIN_COUNT && sinceLast >= INCIDENT_COOLDOWN_SEC) {
        const cluster: ClusterRequest = {
          kind: 'incident',
          startTime: this.recentIncidents[0].sessionTime,
          endTime: ev.sessionTime,
          events: [...this.recentIncidents],
        };
        out.push(cluster);
        this.lastIncidentEmitEnd = ev.sessionTime;
        this.recentIncidents.length = 0;
      }
    }

    // ---- Stint accumulation ------------------------------------------------
    // Every event belongs to the current stint until PIT_ENTRY closes it.
    this.stint.events.push(ev);
    if (ev.type === 'PIT_ENTRY') {
      const cluster: ClusterRequest = {
        kind: 'stint',
        startTime: this.stint.startTime,
        endTime: ev.sessionTime,
        events: this.stint.events,
      };
      out.push(cluster);
      this.stint = { startTime: ev.sessionTime, events: [] };
    }

    // ---- Battle clustering -------------------------------------------------
    const focus = ctx.competitiveFocus;
    if (typeof focus === 'number') {
      if (focus >= BATTLE_FOCUS_THRESHOLD) {
        if (!this.battle) {
          this.battle = { startTime: ev.sessionTime, events: [ev] };
        } else {
          this.battle.events.push(ev);
        }
      } else if (this.battle) {
        const dur = ev.sessionTime - this.battle.startTime;
        if (dur >= BATTLE_MIN_SEC) {
          out.push({
            kind: 'battle',
            startTime: this.battle.startTime,
            endTime: ev.sessionTime,
            events: this.battle.events,
          });
        }
        this.battle = null;
      }
    }

    return out;
  }

  /**
   * Test/teardown helper — flush any open battle window.
   */
  flushBattle(now: number): ClusterRequest | null {
    if (!this.battle) return null;
    const dur = now - this.battle.startTime;
    const events = this.battle.events;
    const startTime = this.battle.startTime;
    this.battle = null;
    if (dur < BATTLE_MIN_SEC) return null;
    return { kind: 'battle', startTime, endTime: now, events };
  }
}
