import { describe, it, expect } from 'vitest';
import {
  makeFrame,
  cloneFrame,
  makeFrameSequence,
  SessionStateEnum,
  FlagBits,
  TrackSurface,
  CAR_COUNT,
  withOvertake,
  withPitEntry,
  withPitStall,
  withPitExit,
  withOffTrack,
  withBackOnTrack,
  withLapCompleted,
  withSessionFlags,
  withSessionState,
  withNewSession,
  withIncidentPoint,
  withFuelLevel,
  withBattleGap,
  withRaceGreen,
  withRaceCheckered,
  scenarioA,
  scenarioB,
  scenarioC,
  scenarioD,
} from './frame-fixtures';

// ---------------------------------------------------------------------------
// makeFrame
// ---------------------------------------------------------------------------

describe('makeFrame — defaults', () => {
  it('produces all per-car typed arrays of length 64', () => {
    const f = makeFrame();
    expect(f.carIdxPosition.length).toBe(CAR_COUNT);
    expect(f.carIdxClassPosition.length).toBe(CAR_COUNT);
    expect(f.carIdxOnPitRoad.length).toBe(CAR_COUNT);
    expect(f.carIdxTrackSurface.length).toBe(CAR_COUNT);
    expect(f.carIdxLastLapTime.length).toBe(CAR_COUNT);
    expect(f.carIdxBestLapTime.length).toBe(CAR_COUNT);
    expect(f.carIdxLapCompleted.length).toBe(CAR_COUNT);
    expect(f.carIdxLapDistPct.length).toBe(CAR_COUNT);
    expect(f.carIdxF2Time.length).toBe(CAR_COUNT);
    expect(f.carIdxSessionFlags.length).toBe(CAR_COUNT);
  });

  it('uses correct typed array constructors', () => {
    const f = makeFrame();
    expect(f.carIdxPosition).toBeInstanceOf(Int32Array);
    expect(f.carIdxClassPosition).toBeInstanceOf(Int32Array);
    expect(f.carIdxOnPitRoad).toBeInstanceOf(Uint8Array);
    expect(f.carIdxTrackSurface).toBeInstanceOf(Int32Array);
    expect(f.carIdxLastLapTime).toBeInstanceOf(Float32Array);
    expect(f.carIdxBestLapTime).toBeInstanceOf(Float32Array);
    expect(f.carIdxLapCompleted).toBeInstanceOf(Int32Array);
    expect(f.carIdxLapDistPct).toBeInstanceOf(Float32Array);
    expect(f.carIdxF2Time).toBeInstanceOf(Float32Array);
    expect(f.carIdxSessionFlags).toBeInstanceOf(Int32Array);
  });

  it('fills carIdxTrackSurface with OnTrack (1) by default', () => {
    const f = makeFrame();
    expect(Array.from(f.carIdxTrackSurface).every(v => v === TrackSurface.OnTrack)).toBe(true);
  });

  it('defaults sessionState to Racing', () => {
    expect(makeFrame().sessionState).toBe(SessionStateEnum.Racing);
  });

  it('defaults sessionFlags to Green', () => {
    expect(makeFrame().sessionFlags).toBe(FlagBits.Green);
  });

  it('defaults sessionUniqueId to 1', () => {
    expect(makeFrame().sessionUniqueId).toBe(1);
  });
});

describe('makeFrame — scalar overrides', () => {
  it('respects sessionTick, sessionTime, sessionUniqueId overrides', () => {
    const f = makeFrame({ sessionTick: 9999, sessionTime: 500, sessionUniqueId: 42 });
    expect(f.sessionTick).toBe(9999);
    expect(f.sessionTime).toBe(500);
    expect(f.sessionUniqueId).toBe(42);
  });

  it('respects fuel overrides', () => {
    const f = makeFrame({ fuelLevel: 10, fuelLevelPct: 0.1 });
    expect(f.fuelLevel).toBeCloseTo(10);
    expect(f.fuelLevelPct).toBeCloseTo(0.1);
  });

  it('respects incident count overrides', () => {
    const f = makeFrame({ playerIncidentCount: 3, teamIncidentCount: 5, incidentLimit: 25 });
    expect(f.playerIncidentCount).toBe(3);
    expect(f.teamIncidentCount).toBe(5);
    expect(f.incidentLimit).toBe(25);
  });
});

describe('makeFrame — per-car overrides', () => {
  it('applies position and classPosition to the correct slot', () => {
    const f = makeFrame({ cars: [{ carIdx: 0, position: 1, classPosition: 1 }] });
    expect(f.carIdxPosition[0]).toBe(1);
    expect(f.carIdxClassPosition[0]).toBe(1);
  });

  it('sets onPitRoad true (1) for the specified car', () => {
    const f = makeFrame({ cars: [{ carIdx: 5, onPitRoad: true }] });
    expect(f.carIdxOnPitRoad[5]).toBe(1);
    expect(f.carIdxOnPitRoad[0]).toBe(0); // others untouched
  });

  it('sets trackSurface to PitStall', () => {
    const f = makeFrame({ cars: [{ carIdx: 2, trackSurface: TrackSurface.PitStall }] });
    expect(f.carIdxTrackSurface[2]).toBe(TrackSurface.PitStall);
  });

  it('sets trackSurface to OffTrack (-1)', () => {
    const f = makeFrame({ cars: [{ carIdx: 3, trackSurface: TrackSurface.OffTrack }] });
    expect(f.carIdxTrackSurface[3]).toBe(-1);
  });

  it('sets lapDistPct and f2Time', () => {
    const f = makeFrame({ cars: [{ carIdx: 1, lapDistPct: 0.75, f2Time: 1.2 }] });
    expect(f.carIdxLapDistPct[1]).toBeCloseTo(0.75, 2);
    expect(f.carIdxF2Time[1]).toBeCloseTo(1.2, 1);
  });

  it('sets lapsCompleted, lastLapTime, bestLapTime', () => {
    const f = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 7, lastLapTime: 90.5, bestLapTime: 89.1 }] });
    expect(f.carIdxLapCompleted[0]).toBe(7);
    expect(f.carIdxLastLapTime[0]).toBeCloseTo(90.5, 0);
    expect(f.carIdxBestLapTime[0]).toBeCloseTo(89.1, 0);
  });

  it('ignores car overrides with carIdx outside 0–63', () => {
    expect(() => makeFrame({ cars: [{ carIdx: 64, position: 1 }] })).not.toThrow();
    expect(() => makeFrame({ cars: [{ carIdx: -1, position: 1 }] })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// cloneFrame
// ---------------------------------------------------------------------------

describe('cloneFrame', () => {
  it('produces a deep copy — mutating original does not affect clone', () => {
    const original = makeFrame({ cars: [{ carIdx: 0, position: 1 }] });
    const clone = cloneFrame(original);
    original.carIdxPosition[0] = 99;
    expect(clone.carIdxPosition[0]).toBe(1);
  });

  it('produces a deep copy — mutating clone does not affect original', () => {
    const original = makeFrame({ cars: [{ carIdx: 0, position: 1 }] });
    const clone = cloneFrame(original);
    clone.carIdxPosition[0] = 99;
    expect(original.carIdxPosition[0]).toBe(1);
  });

  it('copies all scalar fields', () => {
    const f = makeFrame({ sessionTick: 500, fuelLevel: 20, playerIncidentCount: 2 });
    const c = cloneFrame(f);
    expect(c.sessionTick).toBe(500);
    expect(c.fuelLevel).toBeCloseTo(20);
    expect(c.playerIncidentCount).toBe(2);
  });

  it('clones every per-car typed array', () => {
    const f = makeFrame();
    const c = cloneFrame(f);
    for (const key of ['carIdxPosition','carIdxClassPosition','carIdxOnPitRoad','carIdxTrackSurface',
                       'carIdxLastLapTime','carIdxBestLapTime','carIdxLapCompleted',
                       'carIdxLapDistPct','carIdxF2Time','carIdxSessionFlags'] as const) {
      expect(c[key]).not.toBe(f[key]); // different buffer reference
      expect(c[key].length).toBe(f[key].length);
    }
  });
});

// ---------------------------------------------------------------------------
// makeFrameSequence
// ---------------------------------------------------------------------------

describe('makeFrameSequence', () => {
  it('returns base frame as element [0]', () => {
    const base = makeFrame();
    const seq = makeFrameSequence(base, []);
    expect(seq[0]).toBe(base);
    expect(seq.length).toBe(1);
  });

  it('produces one extra frame per transition', () => {
    const base = makeFrame();
    const seq = makeFrameSequence(base, [withSessionState(SessionStateEnum.Checkered), withRaceCheckered()]);
    expect(seq.length).toBe(3);
  });

  it('each frame is independent (cloned)', () => {
    const base = makeFrame({ cars: [{ carIdx: 0, position: 1 }] });
    const [f0, f1] = makeFrameSequence(base, [withOvertake(1, 0)]);
    expect(f0.carIdxPosition[0]).toBe(1);
    expect(f1.carIdxPosition[0]).toBe(0); // swapped
  });
});

// ---------------------------------------------------------------------------
// Transition helpers — cover Tier 1 events
// ---------------------------------------------------------------------------

describe('withOvertake', () => {
  it('swaps positions of the two cars', () => {
    const base = makeFrame({ cars: [{ carIdx: 0, position: 1 }, { carIdx: 1, position: 2 }] });
    const next = withOvertake(1, 0)(base);
    expect(next.carIdxPosition[0]).toBe(2); // was 1, now 2
    expect(next.carIdxPosition[1]).toBe(1); // was 2, now 1
  });

  it('advances tick and time', () => {
    const base = makeFrame();
    const next = withOvertake(0, 1)(base);
    expect(next.sessionTick).toBeGreaterThan(base.sessionTick);
    expect(next.sessionTime).toBeGreaterThan(base.sessionTime);
  });

  it('does not mutate the previous frame', () => {
    const base = makeFrame({ cars: [{ carIdx: 0, position: 1 }, { carIdx: 1, position: 2 }] });
    withOvertake(1, 0)(base);
    expect(base.carIdxPosition[0]).toBe(1);
  });
});

describe('withPitEntry', () => {
  it('sets onPitRoad to 1 for the car', () => {
    const base = makeFrame();
    const next = withPitEntry(2)(base);
    expect(next.carIdxOnPitRoad[2]).toBe(1);
  });

  it('sets trackSurface to ApproachingPits', () => {
    const next = withPitEntry(2)(makeFrame());
    expect(next.carIdxTrackSurface[2]).toBe(TrackSurface.ApproachingPits);
  });
});

describe('withPitStall', () => {
  it('sets trackSurface to PitStall', () => {
    const next = withPitStall(0)(makeFrame());
    expect(next.carIdxTrackSurface[0]).toBe(TrackSurface.PitStall);
  });
});

describe('withPitExit', () => {
  it('clears onPitRoad and restores OnTrack', () => {
    const base = makeFrame({ cars: [{ carIdx: 0, onPitRoad: true, trackSurface: TrackSurface.PitStall }] });
    const next = withPitExit(0)(base);
    expect(next.carIdxOnPitRoad[0]).toBe(0);
    expect(next.carIdxTrackSurface[0]).toBe(TrackSurface.OnTrack);
  });

  it('updates position when provided', () => {
    const base = makeFrame({ cars: [{ carIdx: 0, onPitRoad: true, position: 2 }] });
    const next = withPitExit(0, 5)(base);
    expect(next.carIdxPosition[0]).toBe(5);
  });
});

describe('withOffTrack', () => {
  it('sets trackSurface to OffTrack (-1)', () => {
    const next = withOffTrack(3)(makeFrame());
    expect(next.carIdxTrackSurface[3]).toBe(TrackSurface.OffTrack);
  });

  it('leaves other cars unchanged', () => {
    const base = makeFrame({ cars: [{ carIdx: 0, trackSurface: TrackSurface.OnTrack }] });
    const next = withOffTrack(3)(base);
    expect(next.carIdxTrackSurface[0]).toBe(TrackSurface.OnTrack);
  });
});

describe('withBackOnTrack', () => {
  it('restores trackSurface to OnTrack after off-track', () => {
    const base = makeFrame({ cars: [{ carIdx: 3, trackSurface: TrackSurface.OffTrack }] });
    const next = withBackOnTrack(3)(base);
    expect(next.carIdxTrackSurface[3]).toBe(TrackSurface.OnTrack);
  });
});

describe('withLapCompleted', () => {
  it('increments lapsCompleted for the car', () => {
    const base = makeFrame({ cars: [{ carIdx: 0, lapsCompleted: 5 }] });
    const next = withLapCompleted(0, 90.1)(base);
    expect(next.carIdxLapCompleted[0]).toBe(6);
  });

  it('sets lastLapTime', () => {
    const next = withLapCompleted(0, 90.1)(makeFrame());
    expect(next.carIdxLastLapTime[0]).toBeCloseTo(90.1, 0);
  });

  it('updates bestLapTime when new lap is faster', () => {
    const base = makeFrame({ cars: [{ carIdx: 0, bestLapTime: 91.0 }] });
    const next = withLapCompleted(0, 89.5)(base);
    expect(next.carIdxBestLapTime[0]).toBeCloseTo(89.5, 0);
  });

  it('does not update bestLapTime when new lap is slower', () => {
    const base = makeFrame({ cars: [{ carIdx: 0, bestLapTime: 89.0 }] });
    const next = withLapCompleted(0, 91.0)(base);
    expect(next.carIdxBestLapTime[0]).toBeCloseTo(89.0, 0);
  });

  it('sets bestLapTime from zero when recording first lap', () => {
    const base = makeFrame({ cars: [{ carIdx: 0, bestLapTime: 0 }] });
    const next = withLapCompleted(0, 90.0)(base);
    expect(next.carIdxBestLapTime[0]).toBeCloseTo(90.0, 0);
  });
});

describe('withSessionFlags', () => {
  it('sets the sessionFlags bitmask', () => {
    const next = withSessionFlags(FlagBits.YellowFullCourse)(makeFrame());
    expect(next.sessionFlags).toBe(FlagBits.YellowFullCourse);
  });
});

describe('withSessionState', () => {
  it('transitions session state', () => {
    const next = withSessionState(SessionStateEnum.Checkered)(makeFrame());
    expect(next.sessionState).toBe(SessionStateEnum.Checkered);
  });
});

describe('withNewSession', () => {
  it('changes sessionUniqueId', () => {
    const base = makeFrame({ sessionUniqueId: 1 });
    const next = withNewSession(2)(base);
    expect(next.sessionUniqueId).toBe(2);
  });

  it('resets sessionTick and sessionTime to 0', () => {
    const base = makeFrame({ sessionTick: 5000, sessionTime: 900 });
    const next = withNewSession(2)(base);
    expect(next.sessionTick).toBe(0);
    expect(next.sessionTime).toBe(0);
  });
});

describe('withIncidentPoint', () => {
  it('increments playerIncidentCount by 1', () => {
    const base = makeFrame({ playerIncidentCount: 2 });
    const next = withIncidentPoint()(base);
    expect(next.playerIncidentCount).toBe(3);
  });
});

describe('withFuelLevel', () => {
  it('updates fuelLevel and fuelLevelPct', () => {
    const next = withFuelLevel(5, 0.05)(makeFrame());
    expect(next.fuelLevel).toBeCloseTo(5);
    expect(next.fuelLevelPct).toBeCloseTo(0.05, 2);
  });
});

describe('withBattleGap', () => {
  it('sets f2Time for the chaser car', () => {
    const next = withBattleGap(1, 0.6)(makeFrame());
    expect(next.carIdxF2Time[1]).toBeCloseTo(0.6, 1);
  });
});

describe('withRaceGreen', () => {
  it('sets Racing state and Green flag', () => {
    const base = makeFrame({ sessionState: SessionStateEnum.ParadeLaps, sessionFlags: 0 });
    const next = withRaceGreen()(base);
    expect(next.sessionState).toBe(SessionStateEnum.Racing);
    expect(next.sessionFlags).toBe(FlagBits.Green);
  });
});

describe('withRaceCheckered', () => {
  it('sets Checkered state and Checkered flag', () => {
    const next = withRaceCheckered()(makeFrame());
    expect(next.sessionState).toBe(SessionStateEnum.Checkered);
    expect(next.sessionFlags).toBe(FlagBits.Checkered);
  });
});

// ---------------------------------------------------------------------------
// Pre-built scenarios
// ---------------------------------------------------------------------------

describe('scenarioA', () => {
  it('has 4 cars at positions 1–4', () => {
    const f = scenarioA();
    expect(f.carIdxPosition[0]).toBe(1);
    expect(f.carIdxPosition[1]).toBe(2);
    expect(f.carIdxPosition[2]).toBe(3);
    expect(f.carIdxPosition[3]).toBe(4);
  });

  it('car 1 is within battle range of car 0 (f2Time < 1.0s)', () => {
    const f = scenarioA();
    expect(f.carIdxF2Time[1]).toBeLessThan(1.0);
  });

  it('all cars are on-track', () => {
    const f = scenarioA();
    for (let i = 0; i < 4; i++) {
      expect(f.carIdxOnPitRoad[i]).toBe(0);
      expect(f.carIdxTrackSurface[i]).toBe(TrackSurface.OnTrack);
    }
  });
});

describe('scenarioB', () => {
  it('car 1 is in the pit stall', () => {
    const f = scenarioB();
    expect(f.carIdxOnPitRoad[1]).toBe(1);
    expect(f.carIdxTrackSurface[1]).toBe(TrackSurface.PitStall);
  });

  it('has low fuel (< 20%)', () => {
    const f = scenarioB();
    expect(f.fuelLevelPct).toBeLessThan(0.2);
  });
});

describe('scenarioC', () => {
  it('has full-course yellow flags', () => {
    const f = scenarioC();
    expect(f.sessionFlags & FlagBits.Yellow).toBeTruthy();
    expect(f.sessionFlags & FlagBits.Caution).toBeTruthy();
  });

  it('car 2 is off-track', () => {
    const f = scenarioC();
    expect(f.carIdxTrackSurface[2]).toBe(TrackSurface.OffTrack);
  });
});

describe('scenarioD', () => {
  it('has white flag (last lap)', () => {
    const f = scenarioD();
    expect(f.sessionFlags).toBe(FlagBits.White);
  });

  it('can transition to checkered', () => {
    const [_white, checkered] = makeFrameSequence(scenarioD(), [withRaceCheckered()]);
    expect(checkered.sessionState).toBe(SessionStateEnum.Checkered);
    expect(checkered.sessionFlags).toBe(FlagBits.Checkered);
  });
});

// ---------------------------------------------------------------------------
// Tier-1 event coverage — at least one transition per event type
// ---------------------------------------------------------------------------

describe('Tier-1 event transition coverage', () => {
  const base = scenarioA();

  it('PIT_ENTRY — withPitEntry produces onPitRoad transition', () => {
    const [prev, next] = makeFrameSequence(base, [withPitEntry(0)]);
    expect(prev.carIdxOnPitRoad[0]).toBe(0);
    expect(next.carIdxOnPitRoad[0]).toBe(1);
  });

  it('PIT_EXIT — withPitExit clears onPitRoad', () => {
    const [,, after] = makeFrameSequence(base, [withPitEntry(0), withPitExit(0)]);
    expect(after.carIdxOnPitRoad[0]).toBe(0);
  });

  it('OFF_TRACK — withOffTrack triggers OffTrack surface', () => {
    const [prev, next] = makeFrameSequence(base, [withOffTrack(2)]);
    expect(prev.carIdxTrackSurface[2]).toBe(TrackSurface.OnTrack);
    expect(next.carIdxTrackSurface[2]).toBe(TrackSurface.OffTrack);
  });

  it('BACK_ON_TRACK — withBackOnTrack restores OnTrack surface', () => {
    const [, , back] = makeFrameSequence(base, [withOffTrack(2), withBackOnTrack(2)]);
    expect(back.carIdxTrackSurface[2]).toBe(TrackSurface.OnTrack);
  });

  it('INCIDENT_POINT — withIncidentPoint increments count', () => {
    const [prev, next] = makeFrameSequence(makeFrame({ playerIncidentCount: 1 }), [withIncidentPoint()]);
    expect(next.playerIncidentCount).toBe(prev.playerIncidentCount + 1);
  });

  it('OVERTAKE — withOvertake swaps positions', () => {
    const [prev, next] = makeFrameSequence(base, [withOvertake(1, 0)]);
    expect(prev.carIdxPosition[1]).toBe(2);
    expect(next.carIdxPosition[1]).toBe(1);
  });

  it('BATTLE_ENGAGED — withBattleGap sets gap < 1.0s', () => {
    const [, next] = makeFrameSequence(base, [withBattleGap(2, 0.7)]);
    expect(next.carIdxF2Time[2]).toBeLessThan(1.0);
  });

  it('LAP_COMPLETED — withLapCompleted increments lapsCompleted', () => {
    const [prev, next] = makeFrameSequence(base, [withLapCompleted(0, 90.2)]);
    expect(next.carIdxLapCompleted[0]).toBe(prev.carIdxLapCompleted[0] + 1);
  });

  it('FLAG_GREEN — withSessionFlags(Green) sets green flag', () => {
    const [, next] = makeFrameSequence(scenarioC(), [withSessionFlags(FlagBits.Green)]);
    expect(next.sessionFlags).toBe(FlagBits.Green);
  });

  it('FLAG_YELLOW_FULL_COURSE — withSessionFlags(YellowFullCourse)', () => {
    const [, next] = makeFrameSequence(base, [withSessionFlags(FlagBits.YellowFullCourse)]);
    expect(next.sessionFlags & FlagBits.Yellow).toBeTruthy();
  });

  it('FLAG_WHITE — withSessionFlags(White)', () => {
    const [, next] = makeFrameSequence(base, [withSessionFlags(FlagBits.White)]);
    expect(next.sessionFlags).toBe(FlagBits.White);
  });

  it('SESSION_LOADED — withNewSession changes sessionUniqueId', () => {
    const [prev, next] = makeFrameSequence(base, [withNewSession(2)]);
    expect(next.sessionUniqueId).not.toBe(prev.sessionUniqueId);
  });

  it('RACE_GREEN — withRaceGreen sets Racing + Green', () => {
    const start = makeFrame({ sessionState: SessionStateEnum.ParadeLaps });
    const [, next] = makeFrameSequence(start, [withRaceGreen()]);
    expect(next.sessionState).toBe(SessionStateEnum.Racing);
    expect(next.sessionFlags).toBe(FlagBits.Green);
  });

  it('RACE_CHECKERED — withRaceCheckered sets Checkered + Checkered flag', () => {
    const [, next] = makeFrameSequence(scenarioD(), [withRaceCheckered()]);
    expect(next.sessionState).toBe(SessionStateEnum.Checkered);
    expect(next.sessionFlags).toBe(FlagBits.Checkered);
  });

  it('SESSION_ENDED — CoolDown state via withSessionState', () => {
    const [, next] = makeFrameSequence(base, [withSessionState(SessionStateEnum.CoolDown)]);
    expect(next.sessionState).toBe(SessionStateEnum.CoolDown);
  });
});
