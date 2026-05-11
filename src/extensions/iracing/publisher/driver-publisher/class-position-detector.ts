/**
 * class-position-detector.ts — Issue #154
 *
 * Emits CLASS_POSITION_GAIN / CLASS_POSITION_LOSS for the player car when
 * the iRacing CarIdxClassPosition value changes, with 2-frame hysteresis
 * via the classPositionHistory window populated by RaceStateAggregator.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { buildEvent, carRefFromRoster, getOrCreateCarState } from '../session-state';
import type { PublisherEvent } from '../event-types';

export interface ClassPositionContext {
  rigId: string;
  raceSessionId: string;
  playerCarIdx: number;
}

let unsetPlayerCarIdxWarned = false;

export function detectClassPositionChange(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: ClassPositionContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  if (ctx.playerCarIdx < 0) {
    if (!unsetPlayerCarIdxWarned) {
      unsetPlayerCarIdxWarned = true;
      // eslint-disable-next-line no-console
      console.warn('[class-position-detector] playerCarIdx unset; skipping');
    }
    return events;
  }
  if (prev === null) return events;

  const cs = getOrCreateCarState(state, ctx.playerCarIdx);
  const newPos = curr.carIdxClassPosition[ctx.playerCarIdx];
  if (newPos <= 0) return events;

  // Hysteresis — require the new position observed for the last 2 samples.
  const hist = cs.classPositionHistory;
  if (hist.length < 2) return events;
  const lastTwo = hist.slice(-2);
  if (lastTwo[0] !== newPos || lastTwo[1] !== newPos) return events;

  const previousEmitted =
    state.lastEmittedClassPosition > 0
      ? state.lastEmittedClassPosition
      : prev.carIdxClassPosition[ctx.playerCarIdx];

  if (previousEmitted === newPos || previousEmitted <= 0) {
    if (state.lastEmittedClassPosition === 0) state.lastEmittedClassPosition = newPos;
    return events;
  }

  const playerRef = carRefFromRoster(state, ctx.playerCarIdx);
  if (!playerRef) return events;

  // Pit-cycle reason heuristic: position changed while the player or the
  // displaced car was on pit road within the last frame.
  const reason: 'overtake' | 'pit_cycle' | 'other' =
    prev.carIdxOnPitRoad[ctx.playerCarIdx] !== curr.carIdxOnPitRoad[ctx.playerCarIdx]
      ? 'pit_cycle'
      : 'overtake';

  const type = newPos < previousEmitted ? 'CLASS_POSITION_GAIN' : 'CLASS_POSITION_LOSS';
  events.push(buildEvent(
    type,
    playerRef,
    {
      previousClassPos: previousEmitted,
      newClassPos: newPos,
      carClassId: playerRef.carClassId ?? 0,
      carClassShortName: playerRef.carClassShortName ?? '',
      reason,
    },
    { raceSessionId: ctx.raceSessionId, rigId: ctx.rigId, frame: curr },
  ));
  state.lastEmittedClassPosition = newPos;

  return events;
}
