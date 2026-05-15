/**
 * overall-position-detector.ts
 *
 * Emits OVERALL_POSITION_GAIN / OVERALL_POSITION_LOSS for the player car when
 * carIdxPosition changes, with 2-frame hysteresis via the overallPositionHistory
 * window populated by RaceStateAggregator.
 *
 * Complements CLASS_POSITION_GAIN/LOSS (#154) — these events capture EVERY
 * overall position change the player experiences regardless of car class.
 * This is the primary signal for the AI agent when the player is being passed
 * (e.g. while stopped on track) or makes a recovery move.
 *
 * The OVERALL_POSITION_LOSS payload includes the overtaking car reference when
 * the cause is an on-track pass, so the AI agent knows exactly who did it.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { buildEvent, carRefFromRoster, getOrCreateCarState } from '../session-state';
import type { PublisherEvent } from '../event-types';

const CAR_COUNT = 64;

export interface OverallPositionContext {
  rigId: string;
  raceSessionId: string;
  playerCarIdx: number;
}

let unsetPlayerCarIdxWarned = false;

export function detectOverallPositionChange(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: OverallPositionContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];

  if (ctx.playerCarIdx < 0) {
    if (!unsetPlayerCarIdxWarned) {
      unsetPlayerCarIdxWarned = true;
      // eslint-disable-next-line no-console
      console.warn('[overall-position-detector] playerCarIdx unset; skipping');
    }
    return events;
  }

  if (prev === null) return events;

  const cs = getOrCreateCarState(state, ctx.playerCarIdx);
  const newPos = curr.carIdxPosition[ctx.playerCarIdx];
  if (newPos <= 0) return events;

  // 2-frame hysteresis — position must be stable for at least 2 samples.
  const hist = cs.overallPositionHistory;
  if (hist.length < 2) return events;
  const lastTwo = hist.slice(-2);
  if (lastTwo[0] !== newPos || lastTwo[1] !== newPos) return events;

  const previousEmitted =
    state.lastEmittedOverallPosition > 0
      ? state.lastEmittedOverallPosition
      : prev.carIdxPosition[ctx.playerCarIdx];

  if (previousEmitted === newPos || previousEmitted <= 0) {
    if (state.lastEmittedOverallPosition === 0) state.lastEmittedOverallPosition = newPos;
    return events;
  }

  const playerRef = carRefFromRoster(state, ctx.playerCarIdx);
  if (!playerRef) return events;

  // Pit-cycle heuristic: player was on or transitioning through pit road.
  const reason: 'overtake' | 'pit_cycle' | 'other' =
    curr.carIdxOnPitRoad[ctx.playerCarIdx] !== 0 ||
    prev.carIdxOnPitRoad[ctx.playerCarIdx] !== 0
      ? 'pit_cycle'
      : 'overtake';

  const type = newPos < previousEmitted ? 'OVERALL_POSITION_GAIN' : 'OVERALL_POSITION_LOSS';

  // For OVERALL_POSITION_LOSS via overtake, identify which car now occupies
  // the player's previous position (the car that just passed them).
  let overtakingCar = undefined;
  if (type === 'OVERALL_POSITION_LOSS' && reason === 'overtake') {
    for (let i = 0; i < CAR_COUNT; i++) {
      if (i === ctx.playerCarIdx) continue;
      if (
        curr.carIdxPosition[i] === previousEmitted &&
        curr.carIdxOnPitRoad[i] === 0
      ) {
        overtakingCar = carRefFromRoster(state, i);
        break;
      }
    }
  }

  events.push(buildEvent(
    type,
    playerRef,
    { previousPosition: previousEmitted, newPosition: newPos, reason, overtakingCar },
    { raceSessionId: ctx.raceSessionId, rigId: ctx.rigId, frame: curr },
  ));
  state.lastEmittedOverallPosition = newPos;

  return events;
}
