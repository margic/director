/**
 * incident-stint-detector.ts — Issue #98
 *
 * Incident accounting and stint milestone events:
 *
 *   TEAM_INCIDENT_POINT    — PlayerCarTeamIncidentCount increments
 *   INCIDENT_LIMIT_WARNING — team incident count crosses 50%/75%/90% of
 *                            IncidentLimit (one-shot per threshold per session)
 *   STINT_MILESTONE        — player car laps-into-stint crosses 25%/50%/75%
 *                            of estimatedStintLaps (one-shot per milestone
 *                            per stint; only active when estimatedStintLaps > 0)
 *
 * Note: STINT_BEST_LAP is emitted by lap-performance-detector.ts (#100).
 *
 * Design: pure-ish function — mutates only state.firedIncidentWarnings and
 * per-car stintStartLap / firedStintMilestones. Returns events to enqueue.
 *
 * Stint tracking reset: fires when the player car exits pit road
 * (carIdxOnPitRoad true→false) — stintStartLap and firedStintMilestones are
 * reset at that moment so subsequent laps count from the fresh pit exit.
 */

import type { TelemetryFrame, SessionState } from './session-state';
import { getOrCreateCarState, buildEvent, carRefFromRoster } from './session-state';
import type { PublisherEvent } from './event-types';

/** Team incident thresholds for INCIDENT_LIMIT_WARNING (in percent). */
export const INCIDENT_LIMIT_THRESHOLDS = [50, 75, 90] as const;

/** Stint milestone percentages for STINT_MILESTONE. */
export const STINT_MILESTONE_PERCENTS = [25, 50, 75] as const;

export interface IncidentStintContext {
  publisherCode: string;
  raceSessionId: string;
  /** iRacing DriverInfo.DriverCarIdx — required for STINT_MILESTONE. */
  playerCarIdx?: number;
  /**
   * Estimated total laps for this stint — used to compute milestone thresholds.
   * Pass 0 or omit to disable STINT_MILESTONE.
   */
  estimatedStintLaps?: number;
}

// ---------------------------------------------------------------------------
// detectIncidentsAndMilestones
// ---------------------------------------------------------------------------

export function detectIncidentsAndMilestones(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: IncidentStintContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  if (prev === null) return events;

  const opts = { raceSessionId: ctx.raceSessionId, publisherCode: ctx.publisherCode, frame: curr };
  const playerCarIdx      = ctx.playerCarIdx ?? 0;
  const estimatedStintLaps = ctx.estimatedStintLaps ?? 0;

  // -------------------------------------------------------------------------
  // TEAM_INCIDENT_POINT — PlayerCarTeamIncidentCount delta
  // -------------------------------------------------------------------------
  if (curr.teamIncidentCount > prev.teamIncidentCount) {
    const delta = curr.teamIncidentCount - prev.teamIncidentCount;
    events.push(buildEvent(
      'TEAM_INCIDENT_POINT',
      carRefFromRoster(state, playerCarIdx),
      {
        incidentPoints:      delta,
        totalIncidentPoints: curr.teamIncidentCount,
      },
      opts,
    ));
  }

  // -------------------------------------------------------------------------
  // INCIDENT_LIMIT_WARNING — one-shot per threshold per session
  // Evaluated whenever teamIncidentCount changes OR incidentLimit is non-zero.
  // -------------------------------------------------------------------------
  if (curr.incidentLimit > 0) {
    for (const thresholdPct of INCIDENT_LIMIT_THRESHOLDS) {
      if (!state.firedIncidentWarnings.has(thresholdPct)) {
        const crossingCount = Math.ceil(curr.incidentLimit * thresholdPct / 100);
        if (curr.teamIncidentCount >= crossingCount) {
          state.firedIncidentWarnings.add(thresholdPct);
          events.push(buildEvent(
            'INCIDENT_LIMIT_WARNING',
            carRefFromRoster(state, playerCarIdx),
            {
              thresholdPercent: thresholdPct,
              currentCount:     curr.teamIncidentCount,
              incidentLimit:    curr.incidentLimit,
            },
            opts,
          ));
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Stint reset — player car exits pit road (onPitRoad true→false)
  // -------------------------------------------------------------------------
  const cs = getOrCreateCarState(state, playerCarIdx);
  const prevOnPit = prev.carIdxOnPitRoad[playerCarIdx] !== 0;
  const currOnPit = curr.carIdxOnPitRoad[playerCarIdx] !== 0;

  if (prevOnPit && !currOnPit) {
    cs.stintStartLap       = curr.carIdxLapCompleted[playerCarIdx];
    cs.firedStintMilestones = new Set();
  }

  // -------------------------------------------------------------------------
  // STINT_MILESTONE — player only, requires estimatedStintLaps > 0
  // -------------------------------------------------------------------------
  if (estimatedStintLaps > 0) {
    const currLaps           = curr.carIdxLapCompleted[playerCarIdx];
    const stintLapsCompleted = currLaps - cs.stintStartLap;

    for (const milestonePct of STINT_MILESTONE_PERCENTS) {
      if (!cs.firedStintMilestones.has(milestonePct)) {
        const threshold = (estimatedStintLaps * milestonePct) / 100;
        if (stintLapsCompleted >= threshold) {
          cs.firedStintMilestones.add(milestonePct);
          events.push(buildEvent(
            'STINT_MILESTONE',
            carRefFromRoster(state, playerCarIdx),
            {
              milestonePercent:  milestonePct,
              lapsCompleted:     stintLapsCompleted,
              estimatedStintLaps,
            },
            opts,
          ));
        }
      }
    }
  }

  return events;
}
