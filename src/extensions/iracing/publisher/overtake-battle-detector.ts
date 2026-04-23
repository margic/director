/**
 * overtake-battle-detector.ts — Issue #87
 *
 * Tier 1 on-track passes and battle state machine. Detects:
 *
 *   OVERTAKE        — CarIdxPosition swap between frames, both off pit road
 *   BATTLE_ENGAGED  — gap (CarIdxF2Time) < 1.0s sustained across 2 consecutive
 *                     frames; key added to activeBattles
 *   BATTLE_BROKEN   — gap > 2.0s for 3+ consecutive frames; key removed
 *
 * Tier 2 additions (OVERTAKE_FOR_LEAD, OVERTAKE_FOR_CLASS, BATTLE_CLOSING,
 * LAPPED_TRAFFIC_AHEAD, BEING_LAPPED, STOPPED_ON_TRACK) are deferred to #97.
 *
 * Design: pure-ish function — mutates activeBattles & carStates.
 * Caller is responsible for resetting state on SESSION_LOADED.
 */

import type { TelemetryFrame, SessionState, BattleState } from './session-state';
import { getOrCreateCarState, battleKey } from './session-state';
import type { PublisherEvent } from './event-types';
import { buildEvent } from './session-state';

const CAR_COUNT = 64;

/** Gap below which a battle is considered engaged (seconds). */
const BATTLE_ENGAGE_GAP_SEC  = 1.0;
/** Gap above which a battle starts the broken countdown. */
const BATTLE_BROKEN_GAP_SEC  = 2.0;
/** Consecutive frames above BATTLE_BROKEN_GAP_SEC before BATTLE_BROKEN fires. */
const BATTLE_BROKEN_FRAMES   = 3;
/** Initial status before the second sub-threshold frame confirms engagement. */
const STATUS_CLOSING  = 'CLOSING' as const;
const STATUS_ENGAGED  = 'ENGAGED' as const;

export interface OvertakeBattleDetectorContext {
  publisherCode: string;
  raceSessionId: string;
}

// ---------------------------------------------------------------------------
// detectOvertakeAndBattle
// ---------------------------------------------------------------------------

export function detectOvertakeAndBattle(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: OvertakeBattleDetectorContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  if (prev === null) {
    // No baseline — initialise positions and return
    for (let i = 0; i < CAR_COUNT; i++) {
      const cs = getOrCreateCarState(state, i);
      cs.position = curr.carIdxPosition[i];
    }
    return events;
  }

  const opts = { raceSessionId: ctx.raceSessionId, publisherCode: ctx.publisherCode, frame: curr };

  // -------------------------------------------------------------------------
  // Step 1: Build reverse-lookup from position → carIdx for BOTH frames.
  // Only include cars with a valid position (> 0) that are not in the pits.
  // -------------------------------------------------------------------------
  const prevPosMap = new Map<number, number>(); // position → carIdx (prev)
  const currPosMap = new Map<number, number>(); // position → carIdx (curr)

  for (let i = 0; i < CAR_COUNT; i++) {
    const pp = prev.carIdxPosition[i];
    const cp = curr.carIdxPosition[i];
    if (pp > 0) prevPosMap.set(pp, i);
    if (cp > 0) currPosMap.set(cp, i);
  }

  // -------------------------------------------------------------------------
  // Step 2: Overtake detection
  //
  // For each car that moved forward (position decreased), check if the car
  // that previously held that position swapped with it — and both cars were
  // off pit road in both frames. This is a "clean swap" pattern.
  // -------------------------------------------------------------------------
  const reported = new Set<string>(); // avoid double-reporting for the same pass

  for (let i = 0; i < CAR_COUNT; i++) {
    const cs        = getOrCreateCarState(state, i);
    const prevPos   = cs.position;     // position from last frame (or 0 if new)
    const currPos   = curr.carIdxPosition[i];

    if (currPos <= 0 || prevPos <= 0) continue;       // car not active
    if (currPos >= prevPos) continue;                  // no forward movement
    if (curr.carIdxOnPitRoad[i] !== 0) continue;      // overtaking car is on pit road
    if (prev.carIdxOnPitRoad[i] !== 0) continue;      // was on pit road before

    // Who was at currPos in the previous frame?
    const displaced = prevPosMap.get(currPos);
    if (displaced === undefined) continue;

    // Confirm the displaced car now occupies the position we vacated
    const displacedCurrPos = curr.carIdxPosition[displaced];
    if (displacedCurrPos !== prevPos) continue;        // not a clean swap

    // Both cars must have been off pit road in both frames
    if (curr.carIdxOnPitRoad[displaced] !== 0) continue;
    if (prev.carIdxOnPitRoad[displaced] !== 0) continue;

    const key = battleKey(i, displaced);
    if (reported.has(key)) continue;
    reported.add(key);

    events.push(buildEvent(
      'OVERTAKE',
      { carIdx: i, carNumber: '', driverName: '' },
      {
        overtakingCarIdx: i,
        overtakenCarIdx:  displaced,
        newPosition:      currPos,
        lap:              curr.carIdxLapCompleted[i],
        lapDistPct:       curr.carIdxLapDistPct[i],
      },
      opts,
    ));
  }

  // -------------------------------------------------------------------------
  // Step 3: Battle state machine
  //
  // For each car with a valid position, look at the car directly ahead.
  // Update or create BattleState keyed by battleKey(chaser, leader).
  // -------------------------------------------------------------------------
  for (let i = 0; i < CAR_COUNT; i++) {
    const currPos = curr.carIdxPosition[i];
    if (currPos <= 1) continue;                        // car is leading (no one ahead)
    if (curr.carIdxOnPitRoad[i] !== 0) continue;      // skip pit-road cars

    const leaderIdx = currPosMap.get(currPos - 1);
    if (leaderIdx === undefined) continue;
    if (curr.carIdxOnPitRoad[leaderIdx] !== 0) continue;

    const gap = curr.carIdxF2Time[i];
    if (gap < 0) continue;                             // iRacing returns -1 when invalid

    const key     = battleKey(i, leaderIdx);
    const battle  = state.activeBattles.get(key);

    if (gap < BATTLE_ENGAGE_GAP_SEC) {
      if (!battle) {
        // First sub-threshold frame → CLOSING (latch)
        state.activeBattles.set(key, {
          chaserCarIdx:          i,
          leaderCarIdx:          leaderIdx,
          status:                STATUS_CLOSING,
          gapSec:                gap,
          previousGapSec:        gap,
          closingRateSecPerLap:  0,
          engagedAt:             curr.sessionTime,
          brokenFrames:          0,
        } satisfies BattleState);
      } else if (battle.status === STATUS_CLOSING) {
        // Second consecutive sub-threshold frame → ENGAGED
        const closingRate = battle.previousGapSec - gap; // positive = closing
        battle.status               = STATUS_ENGAGED;
        battle.closingRateSecPerLap = closingRate;
        battle.brokenFrames         = 0;
        battle.previousGapSec       = battle.gapSec;
        battle.gapSec               = gap;

        events.push(buildEvent(
          'BATTLE_ENGAGED',
          { carIdx: i, carNumber: '', driverName: '' },
          {
            chaserCarIdx:          i,
            leaderCarIdx:          leaderIdx,
            gapSec:                gap,
            closingRateSecPerLap:  closingRate,
            status:                STATUS_ENGAGED,
          },
          opts,
        ));
      } else {
        // Already ENGAGED — keep stats fresh, reset broken counter
        battle.closingRateSecPerLap = battle.previousGapSec - gap;
        battle.previousGapSec       = battle.gapSec;
        battle.gapSec               = gap;
        battle.brokenFrames         = 0;
      }
    } else if (battle) {
      if (gap > BATTLE_BROKEN_GAP_SEC) {
        battle.brokenFrames++;
        battle.gapSec = gap;

        if (battle.brokenFrames >= BATTLE_BROKEN_FRAMES && battle.status === STATUS_ENGAGED) {
          events.push(buildEvent(
            'BATTLE_BROKEN',
            { carIdx: i, carNumber: '', driverName: '' },
            {
              chaserCarIdx:          battle.chaserCarIdx,
              leaderCarIdx:          battle.leaderCarIdx,
              gapSec:                gap,
              closingRateSecPerLap:  battle.closingRateSecPerLap,
              status:                'BROKEN',
            },
            opts,
          ));
          state.activeBattles.delete(key);
        }
      } else {
        // Gap between 1.0s–2.0s: not engaging, not broken — reset broken counter
        battle.brokenFrames         = 0;
        battle.previousGapSec       = battle.gapSec;
        battle.gapSec               = gap;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Update carState positions for next call
  // -------------------------------------------------------------------------
  for (let i = 0; i < CAR_COUNT; i++) {
    const cs  = getOrCreateCarState(state, i);
    cs.position = curr.carIdxPosition[i];
  }

  return events;
}
