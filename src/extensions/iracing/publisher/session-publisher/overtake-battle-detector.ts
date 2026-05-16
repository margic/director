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

import type { TelemetryFrame, SessionState, BattleState } from '../session-state';
import { getOrCreateCarState, battleKey, carRefFromRoster } from '../session-state';
import type { PublisherEvent } from '../event-types';
import { buildEvent } from '../session-state';

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
/** Exit threshold: latch is only released once the pair is this far apart (#196 hysteresis). */
const TRAFFIC_EXIT_GAP_SEC = 3.5;
/** Consecutive frames above TRAFFIC_EXIT_GAP_SEC before releasing the traffic latch. */
const TRAFFIC_EXIT_MIN_FRAMES = 2;
/** Consecutive session seconds without lapDistPct movement required before
 * STOPPED_ON_TRACK fires. */
const STOPPED_ON_TRACK_MIN_DURATION_SEC = 2.0;
/** Minimum lapDistPct change between frames considered "moving" (fraction). */
const STOPPED_MOVEMENT_EPSILON = 0.0005;

/** Initial status before the second sub-threshold frame confirms engagement. */
const STATUS_CLOSING  = 'CLOSING' as const;
const STATUS_ENGAGED  = 'ENGAGED' as const;

export interface OvertakeBattleDetectorContext {
  rigId: string;
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

  const opts = { raceSessionId: ctx.raceSessionId, rigId: ctx.rigId, frame: curr };

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

    const overtakeCar   = carRefFromRoster(state, i);
    const overtakenCar  = carRefFromRoster(state, displaced);
    if (!overtakeCar || !overtakenCar) continue;

    const currClassPos = curr.carIdxClassPosition[i];
    const overtakePayload = {
      overtakingCarIdx: i,
      overtakenCar,
      newPosition:      currPos,
      lap:              curr.carIdxLapCompleted[i],
      lapDistPct:       curr.carIdxLapDistPct[i],
      classPosition:    currClassPos,
      forPosition:      currPos,
      gapAfterSec:      Math.max(0, curr.carIdxF2Time[i]),
    };

    events.push(buildEvent('OVERTAKE', overtakeCar, overtakePayload, opts));

    // Tier 2 (#97): OVERTAKE_FOR_LEAD — the pass is for the overall session lead.
    if (currPos === 1) {
      events.push(buildEvent('OVERTAKE_FOR_LEAD', overtakeCar, overtakePayload, opts));
    }

    // Tier 2 (#97): OVERTAKE_FOR_CLASS — chaser just took the class lead.
    const prevClassPos = prev.carIdxClassPosition[i];
    if (currClassPos === 1 && prevClassPos > 1) {
      events.push(buildEvent('OVERTAKE_FOR_CLASS', overtakeCar, overtakePayload, opts));
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

        const engagedCar = carRefFromRoster(state, i);
        const leaderCarRef = carRefFromRoster(state, leaderIdx);
        if (engagedCar && leaderCarRef) {
          const leaderPos = curr.carIdxPosition[leaderIdx];
          const engagedPayload = {
            chaserCar:            engagedCar,
            leaderCar:            leaderCarRef,
            gapSec:               gap,
            closingRateSecPerLap: closingRate,
            status:               STATUS_ENGAGED,
            role:                 'engager' as const,
            forPosition:          leaderPos,
          };
          // Engager perspective (chaser is the envelope car)
          events.push(buildEvent('BATTLE_ENGAGED', engagedCar, engagedPayload, opts));
          // Engaged perspective (leader is the envelope car)
          events.push(buildEvent('BATTLE_ENGAGED', leaderCarRef, {
            ...engagedPayload,
            role: 'engaged' as const,
          }, opts));
        }
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
          const closingCar = carRefFromRoster(state, i);
          const closingLeaderRef = carRefFromRoster(state, leaderIdx);
          if (closingCar && closingLeaderRef) {
            const closingLeaderPos = curr.carIdxPosition[leaderIdx];
            const closingPayload = {
              chaserCar:            closingCar,
              leaderCar:            closingLeaderRef,
              gapSec:               gap,
              closingRateSecPerLap: closingRatePerLap,
              status:               'CLOSING' as const,
              role:                 'engager' as const,
              forPosition:          closingLeaderPos,
            };
            events.push(buildEvent('BATTLE_CLOSING', closingCar, closingPayload, opts));
            events.push(buildEvent('BATTLE_CLOSING', closingLeaderRef, {
              ...closingPayload,
              role: 'engaged' as const,
            }, opts));
            battle.closingAnnounced     = true;
            battle.closingRateSecPerLap = closingRatePerLap;
          }
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
        const brokenCar     = carRefFromRoster(state, i);
        const brokenChaser  = carRefFromRoster(state, battle.chaserCarIdx);
        const brokenLeader  = carRefFromRoster(state, battle.leaderCarIdx);
        if (brokenCar && brokenChaser && brokenLeader) {
          const brokenLeaderPos = curr.carIdxPosition[battle.leaderCarIdx];
          const brokenPayload = {
            chaserCar:            brokenChaser,
            leaderCar:            brokenLeader,
            gapSec:               gap,
            closingRateSecPerLap: battle.closingRateSecPerLap,
            status:               'BROKEN' as const,
            role:                 'engager' as const,
            forPosition:          brokenLeaderPos,
          };
          events.push(buildEvent('BATTLE_BROKEN', brokenChaser, brokenPayload, opts));
          events.push(buildEvent('BATTLE_BROKEN', brokenLeader, {
            ...brokenPayload,
            role: 'engaged' as const,
          }, opts));
        }
        state.activeBattles.delete(key);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Cross-lap physical proximity — LAPPED_TRAFFIC_AHEAD / BEING_LAPPED
  //
  // carIdxF2Time cannot be used here: for cars on different laps it equals
  // ≈ lap_difference × lap_time (80–90 s), always above any reasonable
  // proximity threshold.  Instead we compare carIdxLapDistPct positions
  // directly and convert the fractional-track gap to seconds via the last
  // known lap time (FALLBACK_LAP_TIME_SEC when unavailable).
  //
  // The position-adjacent scan (currPos − 1) also cannot work: when being
  // lapped the lapping car is many positions ahead in race order, not just
  // one.  An O(n²) scan over all on-track pairs finds every cross-lap pair.
  //
  // For each qualifying pair we fire:
  //   LAPPED_TRAFFIC_AHEAD — from the lapper's perspective (more laps)
  //   BEING_LAPPED         — from the lapped car's perspective (fewer laps)
  //
  // Latched per pair via state.trafficAnnouncements using prefixed keys:
  //   'la:<pairKey>'  — LAPPED_TRAFFIC_AHEAD announced (entered)
  //   'bl:<pairKey>'  — BEING_LAPPED announced (entered)
  //
  // #196 hysteresis: latches are only released after TRAFFIC_EXIT_MIN_FRAMES
  // consecutive frames above TRAFFIC_EXIT_GAP_SEC (not TRAFFIC_PROXIMITY_GAP_SEC).
  // A 'exited' event is emitted when the latch releases.
  //
  // #196 pre-green guard: Step 4 and Step 5 are skipped before RACE_GREEN.
  // -------------------------------------------------------------------------
  if (state.raceGreenFired) {
    const seenTrafficPairs = new Set<string>();

    for (let i = 0; i < CAR_COUNT; i++) {
      if (curr.carIdxPosition[i] <= 0) continue;
      if (curr.carIdxOnPitRoad[i] !== 0) continue;
      const lapI = curr.carIdxLapCompleted[i];
      const pctI = curr.carIdxLapDistPct[i];

      for (let j = i + 1; j < CAR_COUNT; j++) {
        if (curr.carIdxPosition[j] <= 0) continue;
        if (curr.carIdxOnPitRoad[j] !== 0) continue;
        const lapJ = curr.carIdxLapCompleted[j];

        // Only interested in cars on different laps.
        if (lapI === lapJ) continue;

        const pctJ = curr.carIdxLapDistPct[j];

        // Physical track gap as a fraction of the lap, normalised to [−0.5, 0.5]
        // so that the start/finish line wrap-around is handled correctly.
        let physDiff = pctI - pctJ;
        if (physDiff >  0.5) physDiff -= 1.0;
        if (physDiff < -0.5) physDiff += 1.0;

        // Convert fractional gap to approximate seconds using the last known
        // lap time (fall back to FALLBACK_LAP_TIME_SEC when unavailable).
        const lapRef =
          curr.carIdxLastLapTime[i] > 0 ? curr.carIdxLastLapTime[i] :
          curr.carIdxLastLapTime[j] > 0 ? curr.carIdxLastLapTime[j] :
          FALLBACK_LAP_TIME_SEC;
        const gapSec = Math.abs(physDiff) * lapRef;

        // Determine which car is lapping (more completed laps) and which is
        // being lapped (fewer completed laps).
        const lapperIdx = lapI > lapJ ? i : j;
        const lappedIdx  = lapI > lapJ ? j : i;

        const pairKey = battleKey(lapperIdx, lappedIdx);
        const laKey   = `la:${pairKey}`;
        const blKey   = `bl:${pairKey}`;

        // Approximate distance in metres at a nominal 50 m/s racing pace.
        const approxDistanceMeters = Math.round(gapSec * 50);

        if (gapSec <= TRAFFIC_PROXIMITY_GAP_SEC) {
          seenTrafficPairs.add(laKey);
          seenTrafficPairs.add(blKey);
          // Reset any exit-hysteresis counter since the pair is within range again.
          state.trafficExitFrames.delete(laKey);
          state.trafficExitFrames.delete(blKey);

          // LAPPED_TRAFFIC_AHEAD — fired from the lapper's perspective.
          if (!state.trafficAnnouncements.has(laKey)) {
            const lapperCar = carRefFromRoster(state, lapperIdx);
            const lappedCar = carRefFromRoster(state, lappedIdx);
            if (lapperCar && lappedCar) {
              events.push(buildEvent(
                'LAPPED_TRAFFIC_AHEAD',
                lapperCar,
                { lappedCar, distanceMeters: approxDistanceMeters, state: 'entered', kind: 'edge' },
                opts,
              ));
              state.trafficAnnouncements.set(laKey, 'LAPPED_AHEAD');
            }
          }

          // BEING_LAPPED — fired from the lapped car's perspective.
          if (!state.trafficAnnouncements.has(blKey)) {
            const lappedCar  = carRefFromRoster(state, lappedIdx);
            const lappingCar = carRefFromRoster(state, lapperIdx);
            if (lappedCar && lappingCar) {
              events.push(buildEvent(
                'BEING_LAPPED',
                lappedCar,
                { lappingCar, distanceMeters: approxDistanceMeters, state: 'entered', kind: 'edge' },
                opts,
              ));
              state.trafficAnnouncements.set(blKey, 'BEING_LAPPED');
            }
          }
        }
        // If gapSec > TRAFFIC_EXIT_GAP_SEC the hysteresis cleanup below handles exit.
      }
    }

    // -----------------------------------------------------------------------
    // Hysteresis-based exit: release latches that have been above the exit
    // threshold for TRAFFIC_EXIT_MIN_FRAMES consecutive frames.
    // -----------------------------------------------------------------------
    for (const [key] of Array.from(state.trafficAnnouncements.entries())) {
      if (seenTrafficPairs.has(key)) continue; // still within enter range — keep

      const n = (state.trafficExitFrames.get(key) ?? 0) + 1;
      if (n >= TRAFFIC_EXIT_MIN_FRAMES) {
        // Emit an 'exited' edge event before releasing the latch.
        const isLa = key.startsWith('la:');
        const pairKeyRaw = key.slice(3);
        const [aStr, bStr] = pairKeyRaw.split('-');
        const lapperIdx2 = isLa ? parseInt(aStr, 10) : parseInt(bStr, 10);
        const lappedIdx2 = isLa ? parseInt(bStr, 10) : parseInt(aStr, 10);

        if (isLa) {
          const lapperCar = carRefFromRoster(state, lapperIdx2);
          const lappedCar = carRefFromRoster(state, lappedIdx2);
          if (lapperCar && lappedCar) {
            events.push(buildEvent(
              'LAPPED_TRAFFIC_AHEAD',
              lapperCar,
              { lappedCar, distanceMeters: 0, state: 'exited', kind: 'edge' },
              opts,
            ));
          }
        } else {
          const lappedCar  = carRefFromRoster(state, lappedIdx2);
          const lappingCar = carRefFromRoster(state, lapperIdx2);
          if (lappedCar && lappingCar) {
            events.push(buildEvent(
              'BEING_LAPPED',
              lappedCar,
              { lappingCar, distanceMeters: 0, state: 'exited', kind: 'edge' },
              opts,
            ));
          }
        }

        state.trafficAnnouncements.delete(key);
        state.trafficExitFrames.delete(key);
      } else {
        state.trafficExitFrames.set(key, n);
      }
    }

    // -------------------------------------------------------------------------
    // Step 5: STOPPED_ON_TRACK (#97)
    //
    // A car is considered stopped when its lapDistPct has not changed by more
    // than STOPPED_MOVEMENT_EPSILON AND it is off pit road. Once that state has
    // persisted for STOPPED_ON_TRACK_MIN_DURATION_SEC, fire once on entry and
    // once on exit. Pre-green guard: only runs after raceGreenFired.
    // -------------------------------------------------------------------------
    for (let i = 0; i < CAR_COUNT; i++) {
      const cs = getOrCreateCarState(state, i);
      const onPit = curr.carIdxOnPitRoad[i] !== 0;
      const currPos = curr.carIdxPosition[i];

      if (onPit || currPos <= 0) {
        if (cs.isStoppedOnTrack) {
          // Car entered pit road — emit exit
          const stoppedCar = carRefFromRoster(state, i);
          if (stoppedCar) {
            events.push(buildEvent(
              'STOPPED_ON_TRACK',
              stoppedCar,
              {
                lapDistPct:         cs.lapDistPct,
                stoppedDurationSec: cs.stoppedStartSessionTime !== null
                  ? curr.sessionTime - cs.stoppedStartSessionTime : 0,
                state: 'exited',
                kind:  'edge',
              },
              opts,
            ));
          }
        }
        cs.stoppedStartSessionTime = null;
        cs.isStoppedOnTrack = false;
        continue;
      }

      const prevPct = prev.carIdxLapDistPct[i];
      const currPct = curr.carIdxLapDistPct[i];
      const moved   = Math.abs(currPct - prevPct) > STOPPED_MOVEMENT_EPSILON;

      if (moved) {
        if (cs.isStoppedOnTrack) {
          // Car started moving — emit exited edge
          const stoppedCar = carRefFromRoster(state, i);
          if (stoppedCar) {
            events.push(buildEvent(
              'STOPPED_ON_TRACK',
              stoppedCar,
              {
                lapDistPct:         currPct,
                stoppedDurationSec: cs.stoppedStartSessionTime !== null
                  ? curr.sessionTime - cs.stoppedStartSessionTime : 0,
                state: 'exited',
                kind:  'edge',
              },
              opts,
            ));
          }
          cs.isStoppedOnTrack = false;
        }
        cs.stoppedStartSessionTime = null;
        continue;
      }

      if (cs.stoppedStartSessionTime === null) {
        cs.stoppedStartSessionTime = prev.sessionTime;
      }

      const stoppedFor = curr.sessionTime - cs.stoppedStartSessionTime;
      if (stoppedFor >= STOPPED_ON_TRACK_MIN_DURATION_SEC && !cs.isStoppedOnTrack) {
        const stoppedCar = carRefFromRoster(state, i);
        if (stoppedCar) {
          cs.isStoppedOnTrack = true;
          events.push(buildEvent(
            'STOPPED_ON_TRACK',
            stoppedCar,
            {
              lapDistPct:         currPct,
              stoppedDurationSec: stoppedFor,
              state: 'entered',
              kind:  'edge',
            },
            opts,
          ));
        }
      }
    }
  } // end if (state.raceGreenFired)

  // -------------------------------------------------------------------------
  // Step 4: Update carState positions for next call
  // -------------------------------------------------------------------------
  for (let i = 0; i < CAR_COUNT; i++) {
    const cs  = getOrCreateCarState(state, i);
    cs.position = curr.carIdxPosition[i];
  }

  return events;
}
