/**
 * incident-stint-detector.test.ts — Issue #98
 *
 * Covers TEAM_INCIDENT_POINT, INCIDENT_LIMIT_WARNING, and STINT_MILESTONE.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  detectIncidentsAndMilestones,
  INCIDENT_LIMIT_THRESHOLDS,
  STINT_MILESTONE_PERCENTS,
  type IncidentStintContext,
} from '../driver-publisher/incident-stint-detector';
import { createSessionState, type SessionState } from '../session-state';
import { makeFrame, cloneFrame, withPitExit } from './frame-fixtures';

const CTX: IncidentStintContext = {
  rigId: 'rig-01',
  raceSessionId: 'rs-1',
  playerCarIdx:  0,
};

let state: SessionState;
beforeEach(() => { state = createSessionState('rs-1', 1); });

function detect(
  prev: ReturnType<typeof makeFrame> | null,
  curr: ReturnType<typeof makeFrame>,
  s = state,
  ctx = CTX,
) {
  return detectIncidentsAndMilestones(prev, curr, s, ctx);
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

describe('detectIncidentsAndMilestones — seeding', () => {
  it('returns no events on first (null prev) frame', () => {
    expect(detect(null, makeFrame())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TEAM_INCIDENT_POINT
// ---------------------------------------------------------------------------

describe('TEAM_INCIDENT_POINT', () => {
  it('fires when teamIncidentCount increments by 1', () => {
    const f0 = makeFrame({ teamIncidentCount: 0 });
    const f1 = cloneFrame(f0);
    f1.teamIncidentCount = 1;

    const events = detect(f0, f1);
    const ev = events.find(e => e.type === 'TEAM_INCIDENT_POINT');
    expect(ev).toBeDefined();
    expect(ev!.payload).toMatchObject({ incidentPoints: 1, totalIncidentPoints: 1 });
  });

  it('fires with correct delta for multi-point incident', () => {
    const f0 = makeFrame({ teamIncidentCount: 2 });
    const f1 = cloneFrame(f0);
    f1.teamIncidentCount = 6; // +4x

    const events = detect(f0, f1);
    const ev = events.find(e => e.type === 'TEAM_INCIDENT_POINT');
    expect(ev!.payload).toMatchObject({ incidentPoints: 4, totalIncidentPoints: 6 });
  });

  it('does NOT fire when teamIncidentCount is unchanged', () => {
    const f0 = makeFrame({ teamIncidentCount: 3 });
    const f1 = cloneFrame(f0);
    const events = detect(f0, f1);
    expect(events.find(e => e.type === 'TEAM_INCIDENT_POINT')).toBeUndefined();
  });

  it('fires multiple times as count grows', () => {
    const f0 = makeFrame({ teamIncidentCount: 0 });
    const f1 = cloneFrame(f0); f1.teamIncidentCount = 2;
    const f2 = cloneFrame(f1); f2.teamIncidentCount = 4;

    expect(detect(f0, f1).find(e => e.type === 'TEAM_INCIDENT_POINT')).toBeDefined();
    expect(detect(f1, f2).find(e => e.type === 'TEAM_INCIDENT_POINT')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// INCIDENT_LIMIT_WARNING
// ---------------------------------------------------------------------------

describe('INCIDENT_LIMIT_WARNING', () => {
  const LIMIT = 17; // typical iRacing value

  it('fires at 50% threshold', () => {
    // 50% of 17 = 8.5 → ceiling = 9
    const f0 = makeFrame({ teamIncidentCount: 8, incidentLimit: LIMIT });
    const f1 = cloneFrame(f0); f1.teamIncidentCount = 9;
    const events = detect(f0, f1);
    const ev = events.find(e => e.type === 'INCIDENT_LIMIT_WARNING');
    expect(ev).toBeDefined();
    expect(ev!.payload).toMatchObject({ thresholdPercent: 50, currentCount: 9, incidentLimit: LIMIT });
    expect(state.firedIncidentWarnings.has(50)).toBe(true);
  });

  it('fires at 75% threshold', () => {
    state.firedIncidentWarnings.add(50); // already fired
    // 75% of 17 = 12.75 → ceiling = 13
    const f0 = makeFrame({ teamIncidentCount: 12, incidentLimit: LIMIT });
    const f1 = cloneFrame(f0); f1.teamIncidentCount = 13;
    const events = detect(f0, f1);
    const ev = events.find(e => e.type === 'INCIDENT_LIMIT_WARNING');
    expect(ev!.payload).toMatchObject({ thresholdPercent: 75 });
  });

  it('fires at 90% threshold', () => {
    state.firedIncidentWarnings.add(50);
    state.firedIncidentWarnings.add(75);
    // 90% of 17 = 15.3 → ceiling = 16
    const f0 = makeFrame({ teamIncidentCount: 15, incidentLimit: LIMIT });
    const f1 = cloneFrame(f0); f1.teamIncidentCount = 16;
    const events = detect(f0, f1);
    const ev = events.find(e => e.type === 'INCIDENT_LIMIT_WARNING');
    expect(ev!.payload).toMatchObject({ thresholdPercent: 90 });
  });

  it('fires exactly once per threshold even if count keeps rising', () => {
    const f0 = makeFrame({ teamIncidentCount: 8, incidentLimit: LIMIT });
    const f1 = cloneFrame(f0); f1.teamIncidentCount = 9;  // crosses 50%
    detect(f0, f1);
    expect(state.firedIncidentWarnings.has(50)).toBe(true);

    const f2 = cloneFrame(f1); f2.teamIncidentCount = 10;
    const events = detect(f1, f2);
    expect(events.filter(e => e.type === 'INCIDENT_LIMIT_WARNING' &&
      (e.payload as { thresholdPercent: number }).thresholdPercent === 50)).toHaveLength(0);
  });

  it('can fire multiple thresholds in a single step when count jumps', () => {
    // Jump straight past both 50% and 75%
    const f0 = makeFrame({ teamIncidentCount: 0, incidentLimit: LIMIT });
    const f1 = cloneFrame(f0); f1.teamIncidentCount = 15; // past 50% (9) and 75% (13)
    const events = detect(f0, f1);
    const warnings = events.filter(e => e.type === 'INCIDENT_LIMIT_WARNING');
    const pcts = warnings.map(e => (e.payload as { thresholdPercent: number }).thresholdPercent).sort();
    expect(pcts).toContain(50);
    expect(pcts).toContain(75);
  });

  it('does NOT fire when incidentLimit is 0 (unlimited)', () => {
    const f0 = makeFrame({ teamIncidentCount: 0, incidentLimit: 0 });
    const f1 = cloneFrame(f0); f1.teamIncidentCount = 99;
    const events = detect(f0, f1);
    expect(events.find(e => e.type === 'INCIDENT_LIMIT_WARNING')).toBeUndefined();
  });

  it('exported INCIDENT_LIMIT_THRESHOLDS contains 50, 75, 90', () => {
    expect([...INCIDENT_LIMIT_THRESHOLDS]).toEqual([50, 75, 90]);
  });
});

// ---------------------------------------------------------------------------
// STINT_MILESTONE
// ---------------------------------------------------------------------------

describe('STINT_MILESTONE', () => {
  const stintCtx = { ...CTX, estimatedStintLaps: 20 };

  it('fires at 25% (5 laps into a 20-lap stint)', () => {
    const f0 = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 0 }] });
    const f1 = cloneFrame(f0); f1.carIdxLapCompleted[0] = 5;
    const events = detect(f0, f1, state, stintCtx);
    const ev = events.find(e => e.type === 'STINT_MILESTONE');
    expect(ev).toBeDefined();
    expect(ev!.payload).toMatchObject({ milestonePercent: 25, lapsCompleted: 5, estimatedStintLaps: 20 });
  });

  it('fires at 50% (10 laps)', () => {
    state.carStates.get(0)?.firedStintMilestones.add(25) || // pre-seed 25 fired
      (state.carStates.set(0, { ...createSessionState('rs-1', 1).carStates.get(0)!, stintStartLap: 0, firedStintMilestones: new Set([25]) } as any));

    // Get or create car state and set milestone 25 as fired
    const cs = state.carStates.get(0);
    if (cs) cs.firedStintMilestones.add(25);

    const f0 = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 9 }] });
    const f1 = cloneFrame(f0); f1.carIdxLapCompleted[0] = 10;
    const events = detect(f0, f1, state, stintCtx);
    const milestones = events.filter(e => e.type === 'STINT_MILESTONE');
    expect(milestones.find(e => (e.payload as any).milestonePercent === 50)).toBeDefined();
  });

  it('fires at 75% (15 laps)', () => {
    // Seed carState so we can mark prior milestones as fired.
    const f0pre = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 0 }] });
    detect(null, f0pre, state, stintCtx); // no-op (prev=null) but forces getOrCreate if needed
    // Run one frame pair so getOrCreateCarState initialises the slot.
    const fpair = cloneFrame(f0pre);
    detect(f0pre, fpair, state, stintCtx);
    // Mark 25 and 50 as already fired so only 75 is pending.
    const cs = state.carStates.get(0)!;
    cs.firedStintMilestones.add(25);
    cs.firedStintMilestones.add(50);

    const f0 = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 14 }] });
    const f1 = cloneFrame(f0); f1.carIdxLapCompleted[0] = 15;
    const events = detect(f0, f1, state, stintCtx);
    const ev75 = events.find(e => e.type === 'STINT_MILESTONE' && (e.payload as any).milestonePercent === 75);
    expect(ev75).toBeDefined();
  });

  it('fires each milestone exactly once per stint', () => {
    const f0 = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 4 }] });
    const f1 = cloneFrame(f0); f1.carIdxLapCompleted[0] = 5;
    const first  = detect(f0, f1, state, stintCtx);
    expect(first.filter(e => e.type === 'STINT_MILESTONE' && (e.payload as any).milestonePercent === 25)).toHaveLength(1);

    const f2 = cloneFrame(f1);
    const second = detect(f1, f2, state, stintCtx);
    expect(second.filter(e => e.type === 'STINT_MILESTONE' && (e.payload as any).milestonePercent === 25)).toHaveLength(0);
  });

  it('resets milestones after pit exit — next stint counts from 0', () => {
    // Pre-fire all milestones in a fake stint
    const cs = state.carStates.set(0, {
      position: 0, classPosition: 0, onPitRoad: true, trackSurface: 4,
      lastLapTime: 0, bestLapTime: 0, lapsCompleted: 20, lapDistPct: 0,
      stintBestLapTime: 0, sessionFlags: 0, pitEntryLap: null, pitEntryPosition: null,
      pitStallArrivalTime: null, fuelLevelOnPitEntry: null, offTrackFrames: 0,
      stoppedFrames: 0, isStoppedOnTrack: false, stoppedStartSessionTime: null,
      pitStallArrivalFuelLevel: null, onOutLap: false, pitExitLapsCompleted: null,
      stintStartLap: 0, firedStintMilestones: new Set([25, 50, 75]),
    });

    // Pit exit frame
    const f0 = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 20 }] });
    f0.carIdxOnPitRoad[0] = 1; // was on pit road
    const f1 = withPitExit(0)(f0); // now exits pit road

    detect(f0, f1, state, stintCtx);

    const csAfter = state.carStates.get(0)!;
    expect(csAfter.firedStintMilestones.size).toBe(0);
    expect(csAfter.stintStartLap).toBe(f1.carIdxLapCompleted[0]);
  });

  it('does NOT fire when estimatedStintLaps is 0 or not provided', () => {
    const noLapsCtx = { ...CTX }; // no estimatedStintLaps
    const f0 = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 0 }] });
    const f1 = cloneFrame(f0); f1.carIdxLapCompleted[0] = 100;
    const events = detect(f0, f1, state, noLapsCtx);
    expect(events.find(e => e.type === 'STINT_MILESTONE')).toBeUndefined();
  });

  it('exported STINT_MILESTONE_PERCENTS contains 25, 50, 75', () => {
    expect([...STINT_MILESTONE_PERCENTS]).toEqual([25, 50, 75]);
  });
});
