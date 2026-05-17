/**
 * gap-trend-detector.ts — Issue #153
 *
 * Emits GAP_CLOSING / GAP_OPENING for the player car based on the rolling
 * gap windows maintained by RaceStateAggregator.
 *
 * Trigger:
 *   - GAP_CLOSING: gap < 3.0s AND closingRate >= 0.3 s/lap, sustained 2 frames
 *   - GAP_OPENING: gap < 3.0s AND closingRate <= -0.3 s/lap, sustained 2 frames
 *   - Cooldown 30 s per direction before re-emitting in the same direction.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { buildEvent, carRefFromRoster, getOrCreateCarState, estimateSameClassGap } from '../session-state';
import type { PublisherEvent } from '../event-types';

export const GAP_TREND_GAP_THRESHOLD_SEC = 3.0;
export const GAP_TREND_RATE_THRESHOLD_SEC_PER_LAP = 0.3;
export const GAP_TREND_COOLDOWN_SEC = 30;

let unsetPlayerCarIdxWarned = false;

export interface GapTrendContext {
  rigId: string;
  raceSessionId: string;
  /** Required — driver-pipeline detectors are scoped to the player car only. */
  playerCarIdx: number;
  /**
   * Per-car class id map (carIdx → CarClassID). When provided, gap-ahead is
   * computed from same-class lapDistPct rather than CarIdxF2Time, avoiding
   * cross-class prototype-traffic interference in multi-class sessions.
   */
  carClassByCarIdx?: Map<number, number>;
}

export function detectGapTrend(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: GapTrendContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  if (ctx.playerCarIdx < 0) {
    if (!unsetPlayerCarIdxWarned) {
      unsetPlayerCarIdxWarned = true;
      // eslint-disable-next-line no-console
      console.warn('[gap-trend-detector] playerCarIdx unset; skipping');
    }
    return events;
  }
  if (prev === null) return events;

  const cs = getOrCreateCarState(state, ctx.playerCarIdx);
  const opts = { raceSessionId: ctx.raceSessionId, rigId: ctx.rigId, frame: curr };

  // ---- Ahead ----
  // Prefer same-class gap (lapDistPct-based) when class data is available to
  // avoid CarIdxF2Time pollution from prototype traffic in multi-class sessions.
  const [gapAhead, sameClassAheadIdx] = findSameClassAheadGap(curr, ctx.playerCarIdx, state, ctx.carClassByCarIdx);
  if (
    gapAhead > 0
    && gapAhead < GAP_TREND_GAP_THRESHOLD_SEC
    && cs.recentGapToAhead.length >= 2
  ) {
    const rate = cs.closingRateToAhead;
    const direction =
      rate >= GAP_TREND_RATE_THRESHOLD_SEC_PER_LAP ? 'closing'
      : rate <= -GAP_TREND_RATE_THRESHOLD_SEC_PER_LAP ? 'opening'
      : 'none';
    if (direction !== 'none') {
      const cooldownOk =
        curr.sessionTime - state.lastGapTrendEmittedAt.ahead >= GAP_TREND_COOLDOWN_SEC
        || state.lastGapTrendDirection.ahead !== direction;
      if (cooldownOk) {
        // Use same-class car ahead if found, otherwise fall back to overall position.
        const targetCarIdx = sameClassAheadIdx >= 0 ? sameClassAheadIdx : findCarAhead(curr, ctx.playerCarIdx);
        const playerRef = carRefFromRoster(state, ctx.playerCarIdx);
        const targetRef = targetCarIdx >= 0 ? carRefFromRoster(state, targetCarIdx) : undefined;
        if (playerRef && targetRef) {
          const type = direction === 'closing' ? 'GAP_CLOSING' : 'GAP_OPENING';
          events.push(buildEvent(
            type,
            playerRef,
            { targetCar: targetRef, gapSec: round3(gapAhead), closingRateSecPerLap: round3(rate), direction: 'ahead' },
            opts,
          ));
          state.lastGapTrendEmittedAt.ahead = curr.sessionTime;
          state.lastGapTrendDirection.ahead = direction;
        }
      }
    }
  }

  // ---- Behind ----
  const gapBehindWindow = cs.recentGapToBehind;
  if (gapBehindWindow.length >= 2) {
    const gapBehind = gapBehindWindow[gapBehindWindow.length - 1];
    if (gapBehind > 0 && gapBehind < GAP_TREND_GAP_THRESHOLD_SEC) {
      const rate = cs.closingRateToBehind;
      const direction =
        rate >= GAP_TREND_RATE_THRESHOLD_SEC_PER_LAP ? 'closing'
        : rate <= -GAP_TREND_RATE_THRESHOLD_SEC_PER_LAP ? 'opening'
        : 'none';
      if (direction !== 'none') {
        const cooldownOk =
          curr.sessionTime - state.lastGapTrendEmittedAt.behind >= GAP_TREND_COOLDOWN_SEC
          || state.lastGapTrendDirection.behind !== direction;
        if (cooldownOk) {
          const playerPos = curr.carIdxPosition[ctx.playerCarIdx];
          const targetCarIdx = findCarAtPosition(curr, playerPos + 1);
          const playerRef = carRefFromRoster(state, ctx.playerCarIdx);
          const targetRef = targetCarIdx >= 0 ? carRefFromRoster(state, targetCarIdx) : undefined;
          if (playerRef && targetRef) {
            const type = direction === 'closing' ? 'GAP_CLOSING' : 'GAP_OPENING';
            events.push(buildEvent(
              type,
              playerRef,
              { targetCar: targetRef, gapSec: round3(gapBehind), closingRateSecPerLap: round3(rate), direction: 'behind' },
              opts,
            ));
            state.lastGapTrendEmittedAt.behind = curr.sessionTime;
            state.lastGapTrendDirection.behind = direction;
          }
        }
      }
    }
  }

  return events;
}

/**
 * Returns [gapSec, leaderCarIdx] for the same-class car immediately ahead of
 * the player (by class position). Falls back to F2Time and overall-position
 * car-ahead when class data is unavailable.
 */
function findSameClassAheadGap(
  curr: TelemetryFrame,
  playerCarIdx: number,
  state: SessionState,
  carClassByCarIdx?: Map<number, number>,
): [number, number] {
  if (carClassByCarIdx && carClassByCarIdx.size > 0) {
    const playerClassId  = carClassByCarIdx.get(playerCarIdx);
    const playerClassPos = curr.carIdxClassPosition[playerCarIdx];
    if (playerClassId !== undefined && playerClassPos > 1) {
      for (const [cIdx] of state.knownRoster) {
        if (carClassByCarIdx.get(cIdx) === playerClassId
            && curr.carIdxClassPosition[cIdx] === playerClassPos - 1) {
          const gap = estimateSameClassGap(curr, playerCarIdx, cIdx);
          return gap < 999 ? [gap, cIdx] : [-1, -1];
        }
      }
    }
    return [-1, -1]; // player is class leader
  }
  // Fallback: F2Time
  return [curr.carIdxF2Time[playerCarIdx], -1];
}

function findCarAhead(frame: TelemetryFrame, playerCarIdx: number): number {
  const playerPos = frame.carIdxPosition[playerCarIdx];
  if (playerPos <= 1) return -1;
  return findCarAtPosition(frame, playerPos - 1);
}

function findCarAtPosition(frame: TelemetryFrame, position: number): number {
  for (let i = 0; i < frame.carIdxPosition.length; i++) {
    if (frame.carIdxPosition[i] === position) return i;
  }
  return -1;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
