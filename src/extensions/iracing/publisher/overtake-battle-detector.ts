/**
 * overtake-battle-detector.ts — Issues #87, #97
 *
 * Tier 1 on-track passes and battle state machine. Detects:
 *
 *   OVERTAKE        — CarIdxPosition swap between frames, both off pit road
 *   BATTLE_ENGAGED  — gap (CarIdxF2Time) < 1.0s sustained across 2 consecutive
 *                     frames; key added to activeBattles
 *   BATTLE_BROKEN   — gap > 2.0s for 3+ consecutive frames; key removed
 *
 * Tier 2 extensions (#97):
 *
 *   OVERTAKE_FOR_LEAD    — OVERTAKE where newPosition === 1 (session leader)
 *   OVERTAKE_FOR_CLASS   — OVERTAKE where CarIdxClassPosition transitions to 1
 *   BATTLE_CLOSING       — gap in (1.0s, 2.0s] and closing ≥ 0.2s/lap; fires
 *                          once per closing trend per battle pair
 *   LAPPED_TRAFFIC_AHEAD — chaser is ≤ ~2s behind a slower car (fewer laps)
 *   BEING_LAPPED         — chaser is ≤ ~2s behind a car with MORE laps
 *   STOPPED_ON_TRACK     — car off pit road with no lapDistPct movement for > 2s
 *
 * Design: pure-ish function — mutates activeBattles, carStates, trafficAnnouncements.
 * Caller is responsible for resetting state on SESSION_LOADED.
 */

import type { TelemetryFrame, SessionState, BattleState } from './session-state';
import { getOrCreateCarState, battleKey, carRefFromRoster } from './session-state';
import type { PublisherEvent } from './event-types';
import { buildEvent } from './session-state';

const CAR_COUNT = 64;

/** Gap below which a battle is considered engaged (seconds). */
const BATTLE_ENGAGE_GAP_SEC  = 1.0;
/** Gap above which a battle starts the broken countdown. */
const BATTLE_BROKEN_GAP_SEC  = 2.0;
/** Consecutive frames above BATTLE_BROKEN_GAP_SEC before BATTLE_BROKEN fires. */
const BATTLE_BROKEN_FRAMES   = 3;
/** Per-lap closing rate (seconds) threshold for BATTLE_CLOSING. */
const CLOSING_RATE_PER_LAP_THRESHOLD = 0.2;
/** Fallback lap time (s) when CarIdxLastLapTime is not yet known. */
const FALLBACK_LAP_TIME_SEC = 90;
/** Gap (seconds of CarIdxF2Time) below which a chaser is treated as "at"
 * another car for lapped-traffic purposes. Roughly 100m at 50 m/s (~180 kph). */
const TRAFFIC_PROXIMITY_GAP_SEC = 2.0;
/** Consecutive session seconds without lapDistPct movement required before
 * STOPPED_ON_TRACK fires. */
const STOPPED_ON_TRACK_MIN_DURATION_SEC = 2.0;
/** Minimum lapDistPct change between frames considered "moving" (fraction). */
const STOPPED_MOVEMENT_EPSILON = 0.0005;

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

    const overtakePayload = {
      overtakingCarIdx: i,
      overtakenCarIdx:  displaced,
      newPosition:      currPos,
      lap:              curr.carIdxLapCompleted[i],
      lapDistPct:       curr.carIdxLapDistPct[i],
    };

    events.push(buildEvent(
      'OVERTAKE',
      carRefFromRoster(state, i),
      overtakePayload,
      opts,
    ));

    // Tier 2 (#97): OVERTAKE_FOR_LEAD — the pass is for the overall session lead.
    if (currPos === 1) {
      events.push(buildEvent(
        'OVERTAKE_FOR_LEAD',
        carRefFromRoster(state, i),
        overtakePayload,
        opts,
      ));
    }

    // Tier 2 (#97): OVERTAKE_FOR_CLASS — chaser just took the class lead.
    // We emit this in addition to OVERTAKE_FOR_LEAD so a "lead for overall and
    // class" pass produces all three (OVERTAKE, OVERTAKE_FOR_LEAD, OVERTAKE_FOR_CLASS).
    const prevClassPos = prev.carIdxClassPosition[i];
    const currClassPos = curr.carIdxClassPosition[i];
    if (currClassPos === 1 && prevClassPos > 1) {
      events.push(buildEvent(
        'OVERTAKE_FOR_CLASS',
        carRefFromRoster(state, i),
        overtakePayload,
        opts,
      ));
    }
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
          closingAnnounced:      false,
        } satisfies BattleState);
      } else if (battle.status === STATUS_CLOSING) {
        // Second consecutive sub-threshold frame → ENGAGED
        const closingRate = battle.previousGapSec - gap; // positive = closing
        battle.status               = STATUS_ENGAGED;
        battle.closingRateSecPerLap = closingRate;
        battle.brokenFrames         = 0;
        battle.previousGapSec       = battle.gapSec;
        battle.gapSec               = gap;
        battle.closingAnnounced     = false;

        events.push(buildEvent(
          'BATTLE_ENGAGED',
          carRefFromRoster(state, i),
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
    } else if (gap <= BATTLE_BROKEN_GAP_SEC) {
      // Gap is in the (1.0s, 2.0s] band — BATTLE_CLOSING territory (#97).
      // Compute closing rate per lap and emit once when it crosses the threshold.
      if (battle) {
        const dropSec = battle.previousGapSec - gap; // positive = closing
        const lapRef  = curr.carIdxLastLapTime[i] > 0 ? curr.carIdxLastLapTime[i] : FALLBACK_LAP_TIME_SEC;
        const sessionDt = Math.max(curr.sessionTime - prev.sessionTime, 0.001);
        const closingRatePerLap = (dropSec / sessionDt) * lapRef;

        if (
          !battle.closingAnnounced &&
          dropSec > 0 &&
          closingRatePerLap >= CLOSING_RATE_PER_LAP_THRESHOLD
        ) {
          events.push(buildEvent(
            'BATTLE_CLOSING',
            carRefFromRoster(state, i),
            {
              chaserCarIdx:          i,
              leaderCarIdx:          leaderIdx,
              gapSec:                gap,
              closingRateSecPerLap:  closingRatePerLap,
              status:                'CLOSING',
            },
            opts,
          ));
          battle.closingAnnounced     = true;
          battle.closingRateSecPerLap = closingRatePerLap;
        }

        battle.brokenFrames   = 0;
        battle.previousGapSec = battle.gapSec;
        battle.gapSec         = gap;
      }
    } else if (battle) {
      // Gap > 2.0s — drifting apart. Clear the closing announcement so a
      // future re-closing trend can emit BATTLE_CLOSING again.
      battle.closingAnnounced = false;
      battle.brokenFrames++;
      battle.gapSec = gap;

      if (battle.brokenFrames >= BATTLE_BROKEN_FRAMES && battle.status === STATUS_ENGAGED) {
        events.push(buildEvent(
          'BATTLE_BROKEN',
          carRefFromRoster(state, i),
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
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Lapped-traffic detection (#97)
  //
  // For each car i with a car immediately ahead (leaderIdx), compare
  // carIdxLapCompleted. If i is within TRAFFIC_PROXIMITY_GAP_SEC of leaderIdx:
  //   - leaderIdx has fewer laps → LAPPED_TRAFFIC_AHEAD (i catching slower car)
  //   - leaderIdx has more laps   → BEING_LAPPED (i is about to be lapped)
  // Latched per pair via state.trafficAnnouncements; cleared when gap grows
  // past threshold or laps equalise.
  // -------------------------------------------------------------------------
  const seenTrafficPairs = new Set<string>();
  for (let i = 0; i < CAR_COUNT; i++) {
    const currPos = curr.carIdxPosition[i];
    if (currPos <= 1) continue;
    if (curr.carIdxOnPitRoad[i] !== 0) continue;

    const leaderIdx = currPosMap.get(currPos - 1);
    if (leaderIdx === undefined) continue;
    if (curr.carIdxOnPitRoad[leaderIdx] !== 0) continue;

    const gap = curr.carIdxF2Time[i];
    if (gap < 0 || gap > TRAFFIC_PROXIMITY_GAP_SEC) continue;

    const chaserLap = curr.carIdxLapCompleted[i];
    const leaderLap = curr.carIdxLapCompleted[leaderIdx];
    if (chaserLap === leaderLap) continue;

    const pairKey = battleKey(i, leaderIdx);
    seenTrafficPairs.add(pairKey);
    const existing = state.trafficAnnouncements.get(pairKey);

    // Approximate distance in metres from F2Time. We don't have vehicle speed
    // in the frame, so we report a rough figure based on a nominal 50 m/s
    // racing pace. Good enough for highlights/UI.
    const approxDistanceMeters = Math.round(gap * 50);

    if (leaderLap < chaserLap) {
      // The car ahead is a lapped car — chaser is catching lapped traffic.
      if (existing !== 'LAPPED_AHEAD') {
        events.push(buildEvent(
          'LAPPED_TRAFFIC_AHEAD',
          carRefFromRoster(state, i),
          {
            targetCarIdx:    leaderIdx,
            targetCarNumber: state.knownRoster.get(leaderIdx)?.carNumber ?? '',
            distanceMeters:  approxDistanceMeters,
          },
          opts,
        ));
        state.trafficAnnouncements.set(pairKey, 'LAPPED_AHEAD');
      }
    } else if (leaderLap > chaserLap) {
      // The car ahead has MORE laps — chaser is about to be lapped.
      if (existing !== 'BEING_LAPPED') {
        events.push(buildEvent(
          'BEING_LAPPED',
          carRefFromRoster(state, i),
          {
            targetCarIdx:    leaderIdx,
            targetCarNumber: state.knownRoster.get(leaderIdx)?.carNumber ?? '',
            distanceMeters:  approxDistanceMeters,
          },
          opts,
        ));
        state.trafficAnnouncements.set(pairKey, 'BEING_LAPPED');
      }
    }
  }

  // Clear traffic announcements for pairs that are no longer close/out-of-lap.
  for (const pairKey of Array.from(state.trafficAnnouncements.keys())) {
    if (!seenTrafficPairs.has(pairKey)) {
      state.trafficAnnouncements.delete(pairKey);
    }
  }

  // -------------------------------------------------------------------------
  // Step 5: STOPPED_ON_TRACK (#97)
  //
  // A car is considered stopped when its lapDistPct has not changed by more
  // than STOPPED_MOVEMENT_EPSILON AND it is off pit road. Once that state has
  // persisted for STOPPED_ON_TRACK_MIN_DURATION_SEC, fire the event once.
  // -------------------------------------------------------------------------
  for (let i = 0; i < CAR_COUNT; i++) {
    const cs = getOrCreateCarState(state, i);
    const onPit = curr.carIdxOnPitRoad[i] !== 0;
    const currPos = curr.carIdxPosition[i];

    if (onPit || currPos <= 0) {
      cs.stoppedStartSessionTime = null;
      cs.isStoppedOnTrack = false;
      continue;
    }

    const prevPct = prev.carIdxLapDistPct[i];
    const currPct = curr.carIdxLapDistPct[i];
    const moved   = Math.abs(currPct - prevPct) > STOPPED_MOVEMENT_EPSILON;

    if (moved) {
      cs.stoppedStartSessionTime = null;
      cs.isStoppedOnTrack = false;
      continue;
    }

    if (cs.stoppedStartSessionTime === null) {
      // The car was not moving between prev and curr, so the stop began at
      // prev.sessionTime at the latest. Seed from prev so the duration check
      // below includes the window we've just observed.
      cs.stoppedStartSessionTime = prev.sessionTime;
    }

    const stoppedFor = curr.sessionTime - cs.stoppedStartSessionTime;
    if (stoppedFor >= STOPPED_ON_TRACK_MIN_DURATION_SEC && !cs.isStoppedOnTrack) {
      cs.isStoppedOnTrack = true;
      events.push(buildEvent(
        'STOPPED_ON_TRACK',
        carRefFromRoster(state, i),
        {
          lapDistPct:         currPct,
          stoppedDurationSec: stoppedFor,
        },
        opts,
      ));
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
