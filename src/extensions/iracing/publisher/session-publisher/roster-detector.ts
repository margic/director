/**
 * roster-detector.ts — DIR-1
 *
 * Session-pipeline slice of driver roster tracking.
 * Emits ROSTER_UPDATED when the driver roster provided via context differs
 * from the last known snapshot stored in session state.
 *
 * Extracted from driver-swap-roster-detector.ts during DIR-1 refactoring.
 * DRIVER_SWAP_COMPLETED / DRIVER_SWAP_INITIATED belong to the driver-publisher
 * pipeline and live in driver-publisher/driver-swap-detector.ts.
 *
 * Seeding call (knownRoster is empty) does NOT emit an event — it just
 * initialises the baseline.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { carRefFromRoster, buildEvent } from '../session-state';
import type { PublisherEvent, PublisherCarRef } from '../event-types';

export interface RosterDetectorContext {
  publisherCode: string;
  raceSessionId: string;
  /**
   * Current full roster as parsed from the latest SessionInfo YAML.
   * Pass undefined to skip ROSTER_UPDATED detection this frame.
   */
  currentRoster?: Map<number, PublisherCarRef>;
  /** iRacing DriverInfo.DriverCarIdx — used for the event car ref. */
  playerCarIdx?: number;
}

// ---------------------------------------------------------------------------
// detectRosterUpdate
// ---------------------------------------------------------------------------

export function detectRosterUpdate(
  _prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: RosterDetectorContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  if (ctx.currentRoster === undefined) return events;

  const opts = { raceSessionId: ctx.raceSessionId, publisherCode: ctx.publisherCode, frame: curr };
  const current  = ctx.currentRoster;
  const previous = state.knownRoster;
  const playerCarIdx = ctx.playerCarIdx ?? 0;

  if (previous.size === 0 && current.size > 0) {
    // First-ever roster seed — just store it without emitting.
    state.knownRoster = new Map(current);
    return events;
  }

  if (previous.size > 0) {
    const added:   PublisherCarRef[] = [];
    const removed: PublisherCarRef[] = [];

    for (const [idx, ref] of current) {
      if (!previous.has(idx)) added.push(ref);
    }
    for (const [idx, ref] of previous) {
      if (!current.has(idx)) removed.push(ref);
    }

    if (added.length > 0 || removed.length > 0) {
      state.knownRoster = new Map(current);
      const rosterCar = carRefFromRoster(state, playerCarIdx);
      if (rosterCar) {
        events.push(buildEvent(
          'ROSTER_UPDATED',
          rosterCar,
          { added, removed },
          opts,
        ));
      }
    }
  }

  return events;
}
